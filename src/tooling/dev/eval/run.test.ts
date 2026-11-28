import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DRIFTED, DRIFTED_WITH_ENTRY, ENTRY_PATCH, UNENTRY_PATCH } from "./changelog.fixture";
import {
  ALLOWED_TOOLS,
  checkTask,
  claudeArgv,
  INTERACTIVE_PERMISSION_MODE,
  interactiveArgv,
  runCalibration,
  runOnce,
  runRound,
  SESSION_BIN,
  SETTING_SOURCES,
} from "./run";
import { commitAll, readHead } from "./scaffold";
import { loadTask } from "./spec";
import { removeAll, SAMPLE_FILES, sampleSpec, writeTaskDir } from "./task.fixture";
import type { CheckoutHead, EvalEnv, EvalTask, RoundFile, SessionRequest } from "./types";
import { callsTo, fakeWorld, FIRING_DIFF, sessionRequests, SETTLED, statusFromDisk } from "./world.fixture";

const roots: string[] = [];
afterAll(() => removeAll(roots));

const HEAD: CheckoutHead = { checkout: "/checkout", sha: "f".repeat(40), changes: "" };

function world(): ReturnType<typeof fakeWorld> {
  const made = fakeWorld();
  roots.push(made.root);
  return made;
}

function task(id?: string, tree: EvalTask["tree"] = "forge"): EvalTask {
  const { root, dir } = writeTaskDir({ ...sampleSpec(id), tree }, SAMPLE_FILES);
  roots.push(root);
  return loadTask(dir);
}

function committedConsumerWorld(): ReturnType<typeof fakeWorld> {
  const w = world();
  mkdirSync(join(w.env.checkout, "tests", "fixtures", "workers-consumer"), { recursive: true });
  writeFileSync(join(w.env.checkout, "tests", "fixtures", "workers-consumer", "worker.ts"), "export {};\n", "utf-8");
  mkdirSync(join(w.env.evalsDir, "consumer-base"), { recursive: true });
  writeFileSync(join(w.env.evalsDir, "consumer-base", "package.json"), "{}\n", "utf-8");
  statusFromDisk(w);
  return w;
}

function consumerTemplates(w: ReturnType<typeof fakeWorld>): string[] {
  return existsSync(w.env.cacheDir) ? readdirSync(w.env.cacheDir).filter((name) => name.startsWith("consumer-")) : [];
}

function argAfter(args: readonly string[], flag: string): string {
  return args[args.indexOf(flag) + 1] ?? "";
}

function silentReviews(w: ReturnType<typeof fakeWorld>): void {
  const transcript = w.answers.transcript;
  w.answers.transcript = (sessionId, args) => (argAfter(args, "-p").startsWith("/warden-review ") ? "" : transcript(sessionId, args));
}

describe("claudeArgv()", () => {
  const argv = claudeArgv("do the task", { sessionId: "s-1", model: "opus", mcpConfig: "/r/mcp-forge.json" });

  it("names the session, so its transcript can be found afterwards", () => {
    expect(argAfter(argv, "--session-id")).toBe("s-1");
  });

  it("runs under the round's MCP config alone, so the user's servers — the ledger among them — are never loaded", () => {
    expect(argv).toContain("--strict-mcp-config");
    expect(argAfter(argv, "--mcp-config")).toBe("/r/mcp-forge.json");
  });

  it("accepts edits and allows exactly the listed tools, and never bypasses permissions", () => {
    expect(argAfter(argv, "--permission-mode")).toBe("acceptEdits");
    expect(argAfter(argv, "--allowedTools")).toBe(ALLOWED_TOOLS.join(","));
    expect(argv.join(" ")).not.toContain("bypassPermissions");
  });

  it("loads the user and project settings and never the local ones, which a linked worktree reads from the main checkout", () => {
    expect(argAfter(argv, "--setting-sources")).toBe("user,project");
    expect(SETTING_SOURCES).toEqual(["user", "project"]);
  });

  it("allows the warden MCP tools and none of the ledger's", () => {
    expect(ALLOWED_TOOLS.filter((tool) => tool.startsWith("mcp__"))).toHaveLength(7);
    expect(ALLOWED_TOOLS).toContain("mcp__warden__warden_check");
    expect(ALLOWED_TOOLS.some((tool) => tool.includes("ledger"))).toBe(false);
  });
});

describe("runOnce()", () => {
  it("runs the author with --strict-mcp-config, --session-id and an MCP config naming warden alone", () => {
    const w = world();
    runOnce(w.env, task(), "r1", 1, HEAD);
    const [author] = callsTo(w.spawn, "claude");
    expect(author).toContain("--strict-mcp-config");
    expect(argAfter(author ?? [], "--session-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(argAfter(author ?? [], "-p")).toBe("prompt.md\n");
    const config = readFileSync(argAfter(author ?? [], "--mcp-config"), "utf-8");
    expect(Object.keys((JSON.parse(config) as { mcpServers: object }).mcpServers)).toEqual(["warden"]);
    expect(config).not.toContain("ledger");
  });

  it("runs the author and the review under the user and project settings alone", () => {
    const w = world();
    runOnce(w.env, task(), "r1", 1, HEAD);
    const sessions = callsTo(w.spawn, "claude");
    expect(sessions).toHaveLength(2);
    for (const args of sessions) expect(argAfter(args, "--setting-sources")).toBe("user,project");
  });

  it("marks the record invalid, naming the review session, when the review produced no assistant turn", () => {
    const w = world();
    silentReviews(w);
    const record = runOnce(w.env, task(), "r1", 1, HEAD);
    const [, review] = callsTo(w.spawn, "claude");
    expect(record.invalid).toBe(`review session ${argAfter(review ?? [], "--session-id")} produced no assistant turn`);
    expect(record.review.assistantMessages).toBe(0);
    expect(record.traps).toEqual({ "node-import": "unreviewed", "co-location": "clean", "refusal-shape": "clean" });
  });

  it("leaves a record whose review answered valid", () => {
    expect(runOnce(world().env, task(), "r1", 1, HEAD).invalid).toBeNull();
  });

  it("never hands any spawned command bypassPermissions", () => {
    const w = world();
    runOnce(w.env, task(), "r1", 1, HEAD);
    runCalibration(w.env, task(), "r1", 1, HEAD);
    expect(w.spawn.mock.calls.flatMap(([, args]) => args).filter((arg) => arg.includes("bypassPermissions"))).toEqual([]);
  });

  it("reviews the author's commit in a fresh session with the findings suffix", () => {
    const w = world();
    runOnce(w.env, task(), "r1", 1, HEAD);
    const [author, review] = callsTo(w.spawn, "claude");
    const prompt = argAfter(review ?? [], "-p");
    expect(prompt).toMatch(/^\/warden-review 0{39}\d\^!\n/);
    expect(prompt).toContain("```json");
    expect(argAfter(review ?? [], "--session-id")).not.toBe(argAfter(author ?? [], "--session-id"));
  });

  it("reviews the same change the traps judge when the author commits its own work", () => {
    const w = world();
    let ownCommit = "";
    w.answers.claude = (args) => {
      if (argAfter(args, "-p") !== "prompt.md\n") return undefined;
      ownCommit = commitAll("/tree", "author's own", w.spawn);
      return undefined;
    };
    runOnce(w.env, task(), "r1", 1, HEAD);
    const [, review] = callsTo(w.spawn, "claude");
    const reviewed = /^\/warden-review (\w+)\^!/.exec(argAfter(review ?? [], "-p"))?.[1] ?? "";
    const [from, to] =
      callsTo(w.spawn, "git")
        .find((args) => args[0] === "diff")
        ?.slice(-2) ?? [];
    expect(ownCommit).not.toBe("");
    expect(to).toBe(reviewed);
    expect(w.parentOf(reviewed)).toBe(from);
    expect(from).not.toBe(ownCommit);
  });

  it("records the author's metrics, the review, verify:unit, acceptance and each trap's verdict", () => {
    const w = world();
    const record = runOnce(w.env, task(), "r1", 1, HEAD);
    expect(record).toMatchObject({ rep: 1, timedOut: false, reviewParseFailed: false, findings: 0, verifyUnit: true, accepted: true });
    expect(record.author.tokens).toEqual({ input: 5, cacheCreation: 50, cacheRead: 500, output: 7 });
    expect(record.traps).toEqual({ "node-import": "through", "co-location": "clean", "refusal-shape": "clean" });
  });

  it("runs verify:unit, then the traps, then acceptance", () => {
    const w = world();
    runOnce(w.env, task(), "r1", 1, HEAD);
    const order = w.spawn.mock.calls
      .map(([command, args]) => `${command} ${args.join(" ")}`)
      .filter((line) => /^bun run verify|^rg |^bun test/.test(line))
      .map((line) => line.split(" ").slice(0, 3).join(" "));
    expect(order).toEqual([
      "bun run verify:unit",
      "rg --no-config --line-number",
      "bun run verify",
      "bun test ./src/sample/refusal.accept.test.ts",
      "bun test ./src/sample/sample.accept.test.ts",
    ]);
  });

  it("saves the raw diff under the cache directory and removes the tree", () => {
    const w = world();
    runOnce(w.env, task(), "r1", 2, HEAD);
    expect(readFileSync(join(w.env.cacheDir, "r1", "sample-task-2.diff"), "utf-8")).toContain("node:fs");
    expect(existsSync(join(w.env.treesDir, "r1", "sample-task-2"))).toBe(false);
  });

  it("removes the tree when a session throws, and rethrows", () => {
    const w = world();
    w.answers.claude = () => ({ status: 1, stderr: "API error" });
    expect(() => runOnce(w.env, task(), "r1", 1, HEAD)).toThrow(/exited 1[\s\S]*API error/);
    expect(existsSync(join(w.env.treesDir, "r1", "sample-task-1"))).toBe(false);
    expect(callsTo(w.spawn, "git").some((args) => args[0] === "worktree" && args[1] === "remove")).toBe(true);
  });

  it("records a session that hit the wall clock as timed out rather than throwing", () => {
    const w = world();
    let sessions = 0;
    w.answers.claude = () => {
      sessions += 1;
      return sessions === 1 ? { status: null, error: Object.assign(new Error("spawnSync claude ETIMEDOUT"), { code: "ETIMEDOUT" }) } : undefined;
    };
    expect(runOnce(w.env, task(), "r1", 1, HEAD).timedOut).toBe(true);
  });
});

describe("runCalibration()", () => {
  it("reviews the reference with every plant applied, and judges each trap", () => {
    const w = world();
    w.answers.review =
      '```json\n[{"impact":"i","where":"src/sample/mod.ts:2","what":"w","exploitScenario":"e","preconditions":"none","fix":"f","chunkIds":[]}]\n```';
    const record = runCalibration(w.env, task(), "r1", 1, HEAD);
    const applied = callsTo(w.spawn, "git")
      .filter((args) => args[0] === "apply")
      .map((args) => args.at(-1)?.split("/").slice(-2).join("/"));
    expect(applied).toEqual([
      "bait/helper.patch",
      "sample-task/reference.patch",
      "plants/node-import.patch",
      "plants/co-location.patch",
      "plants/refusal-shape.patch",
    ]);
    expect(record.traps["node-import"]).toBe("caught");
    expect(existsSync(join(w.env.treesDir, "r1", "sample-task-1-calibration"))).toBe(false);
  });

  it("marks the record invalid and scores no trap through when the review produced no assistant turn", () => {
    const w = world();
    silentReviews(w);
    const record = runCalibration(w.env, task(), "r1", 1, HEAD);
    const [review] = callsTo(w.spawn, "claude");
    expect(record.invalid).toBe(`review session ${argAfter(review ?? [], "--session-id")} produced no assistant turn`);
    expect(Object.values(record.traps)).not.toContain("through");
    expect(record.traps["node-import"]).toBe("unreviewed");
  });
});

describe("runRound()", () => {
  it("refuses a dirty checkout before creating any tree", () => {
    const w = world();
    w.answers.dirty = " M src/app/mod.ts\n";
    expect(() => runRound(w.env, "r1", [task()], 1)).toThrow(/uncommitted changes/);
    expect(callsTo(w.spawn, "git").some((args) => args[0] === "worktree")).toBe(false);
    expect(callsTo(w.spawn, "claude")).toEqual([]);
  });

  it("refuses a round name that is not a safe file name", () => {
    expect(() => runRound(world().env, "../up", [task()], 1)).toThrow(/round/);
  });

  it("runs each rep with a calibration and writes the round file", () => {
    const w = world();
    const [path] = runRound(w.env, "r1", [task()], 2);
    expect(path).toBe(join(w.env.evalsDir, "results", "r1.json"));
    const round = JSON.parse(readFileSync(path ?? "", "utf-8")) as RoundFile;
    expect(round.settingSources).toEqual(["user", "project"]);
    expect(round.claudeVersion).toBe("2.1.400 (Claude Code)");
    expect(round.tasks["sample-task"]?.runs).toHaveLength(2);
    expect(round.tasks["sample-task"]?.calibration).toHaveLength(2);
    expect(callsTo(w.spawn, "claude").filter((args) => args[0] !== "--version")).toHaveLength(6);
    expect(readdirSync(join(w.env.treesDir, "r1")).filter((name) => !name.endsWith(".json"))).toEqual([]);
  });

  it("finishes a consumer task that follows a forge task, though the forge task's results are now in the checkout", () => {
    const w = committedConsumerWorld();
    const [path] = runRound(w.env, "r1", [task("a-forge"), task("b-consumer", "consumer")], 1);
    expect(w.answers.dirty).toContain("?? tests/evals/results/r1.json");
    const round = JSON.parse(readFileSync(path ?? "", "utf-8")) as { tasks: Record<string, unknown> };
    expect(Object.keys(round.tasks).sort()).toEqual(["a-forge", "b-consumer"]);
  });

  it("still refuses to pack a consumer template from a checkout with a change under src/", () => {
    const w = committedConsumerWorld();
    mkdirSync(join(w.env.checkout, "src"), { recursive: true });
    writeFileSync(join(w.env.checkout, "src", "mod.ts"), "export {};\n", "utf-8");
    expect(() => checkTask(w.env, task("b-consumer", "consumer"), readHead(w.env.checkout, w.spawn))).toThrow(
      /uncommitted changes[\s\S]*src\/mod\.ts/,
    );
    expect(consumerTemplates(w)).toEqual([]);
    expect(callsTo(w.spawn, "bun").some((args) => args[0] === "pm")).toBe(false);
  });
});

describe("checkTask()", () => {
  it("finds nothing wrong when the reference is clean and each plant fires its own trap", () => {
    const w = world();
    let planted: string | undefined;
    w.answers.failing = (command, args) => {
      if (command === "git" && args[0] === "apply") planted = /plants\/(.+)\.patch$/.exec(args.at(-1) ?? "")?.[1];
      if (command === "git" && args[0] === "reset" && args.includes("--hard")) planted = undefined;
      if (planted === "co-location") return command === "bun" && args[1] === "verify";
      if (planted === "refusal-shape") return command === "bun" && args[0] === "test";
      return false;
    };
    w.answers.diff = () => (planted === "node-import" ? FIRING_DIFF : "");
    expect(checkTask(w.env, task(), HEAD)).toEqual([]);
  });

  it("applies a reference whose changelog context another [Unreleased] entry has moved, and its plant still fires", () => {
    const w = world();
    const spec = { ...sampleSpec(), bait: [], traps: sampleSpec().traps.filter((trap) => trap.id === "refusal-shape") };
    const { root, dir } = writeTaskDir(spec, SAMPLE_FILES);
    roots.push(root);
    writeFileSync(join(dir, "reference.patch"), ENTRY_PATCH, "utf-8");
    writeFileSync(join(dir, "plants", "refusal-shape.patch"), UNENTRY_PATCH, "utf-8");
    const changelog = join(w.env.treesDir, "check", "sample-task", "CHANGELOG.md");
    w.answers.worktree = { "CHANGELOG.md": DRIFTED };
    w.answers.failing = (command, args) => {
      if (command === "git" && args[0] === "reset") writeFileSync(changelog, DRIFTED_WITH_ENTRY, "utf-8");
      return command === "bun" && args[0] === "test" && readFileSync(changelog, "utf-8") !== DRIFTED_WITH_ENTRY;
    };
    expect(checkTask(w.env, loadTask(dir), HEAD)).toEqual([]);
    expect(callsTo(w.spawn, "git").filter((args) => args[0] === "apply")).toContainEqual([
      "apply",
      "--whitespace=nowarn",
      "--exclude=CHANGELOG.md",
      join(dir, "reference.patch"),
    ]);
  });

  it("reports a plant that does not fire its own trap", () => {
    const w = world();
    w.answers.diff = () => "";
    expect(checkTask(w.env, task(), HEAD)).toContain("plant node-import does not fire its own trap");
  });

  it("reports a reference that does not apply, and stops there", () => {
    const w = world();
    w.answers.failing = (command, args) => command === "git" && args[0] === "apply" && args.at(-1)?.endsWith("reference.patch") === true;
    expect(checkTask(w.env, task(), HEAD)).toEqual(["reference.patch does not apply"]);
  });

  it("reports a trap that fires on the reference, a failing base tree and a rule that does not resolve", () => {
    const w = world();
    w.answers.failing = (command, args) =>
      command === "bun" && (args[1] === "verify:unit" || (args[1] === "read" && args[2] === "project:docs/TEST_RUNNERS.md#2"));
    const problems = checkTask(w.env, task(), HEAD);
    expect(problems).toContain("the base tree fails verify:unit");
    expect(problems).toContain("trap node-import fires on the reference");
    expect(problems).toContain("rule project:docs/TEST_RUNNERS.md#2 does not resolve");
    expect(existsSync(join(w.env.treesDir, "check", "sample-task"))).toBe(false);
  });
});

function interactive(w: ReturnType<typeof fakeWorld>, codeMode = false): EvalEnv {
  return { ...w.env, session: { kind: "interactive", codeMode } };
}

function isAuthor(request: SessionRequest): boolean {
  return request.argv[1] === "prompt.md\n";
}

function driverSays(result: Partial<typeof SETTLED>): { status: number; stdout: string } {
  return { status: 0, stdout: JSON.stringify({ ...SETTLED, ...result }) };
}

function authorUsesRepl(w: ReturnType<typeof fakeWorld>): void {
  const transcript = w.answers.transcript;
  w.answers.transcript = (sessionId, args) => {
    if (args[0] !== "prompt.md\n") return transcript(sessionId, args);
    const block = { type: "tool_use", id: `tu-${sessionId}`, name: "REPL", input: { code: "1" } };
    return JSON.stringify({ type: "assistant", message: { id: `msg-${sessionId}`, content: [block] } }) + "\n";
  };
}

describe("interactiveArgv()", () => {
  const argv = interactiveArgv("do the task", { sessionId: "s-1", model: "opus", mcpConfig: "/r/mcp-forge.json" });

  it("puts the prompt first, ahead of the variadic --allowedTools and --mcp-config, in the order a reviewer can read", () => {
    expect(argv).toEqual([
      "do the task",
      "--session-id",
      "s-1",
      "--model",
      "opus",
      "--setting-sources",
      "user,project",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      ALLOWED_TOOLS.join(","),
      "--strict-mcp-config",
      "--mcp-config",
      "/r/mcp-forge.json",
    ]);
  });

  it("refuses what is not allowed rather than asking, and never bypasses permissions", () => {
    expect(INTERACTIVE_PERMISSION_MODE).toBe("dontAsk");
    expect(argv).not.toContain("-p");
    expect(argv.join(" ")).not.toContain("bypassPermissions");
  });
});

describe("runOnce() and runCalibration() in an interactive round", () => {
  it("drives the author and the review through the session driver, spawning no headless claude", () => {
    const w = world();
    runOnce(interactive(w), task(), "r1", 1, HEAD);
    expect(callsTo(w.spawn, "claude")).toEqual([]);
    expect(callsTo(w.spawn, "bun").filter((args) => args[0] === SESSION_BIN)).toHaveLength(2);
    const [author, review] = sessionRequests(w.spawn);
    expect(author?.argv.slice(0, 2)).toEqual(["claude", "prompt.md\n"]);
    expect(review?.argv[1]).toMatch(/^\/warden-review 0{39}\d\^!\n/);
    expect(author?.codeMode).toBe(false);
    expect(author?.timeoutMs).toBe(20 * 60_000);
    expect(author?.screenLog).toBe(join(w.env.cacheDir, "r1", "sample-task-1.pty.log"));
    expect(review?.screenLog).toBe(join(w.env.cacheDir, "r1", "sample-task-1-review.pty.log"));
  });

  it("hands no spawned command bypassPermissions, in its arguments or on the driver's stdin", () => {
    const w = world();
    runOnce(interactive(w, true), task(), "r1", 1, HEAD);
    runCalibration(interactive(w, true), task(), "r1", 1, HEAD);
    const handed = w.spawn.mock.calls.flatMap(([, args, options]) => [...args, options.input ?? ""]);
    expect(handed.filter((text) => text.includes("bypassPermissions"))).toEqual([]);
    expect(sessionRequests(w.spawn).map((request) => request.codeMode)).toEqual([true, true, true]);
  });

  it("reads the reviewer's findings from the last reply in its transcript", () => {
    const w = world();
    w.answers.review =
      '```json\n[{"impact":"i","where":"src/sample/mod.ts:2","what":"w","exploitScenario":"e","preconditions":"none","fix":"f","chunkIds":[]}]\n```';
    expect(runCalibration(interactive(w), task(), "r1", 1, HEAD).traps["node-import"]).toBe("caught");
  });

  it("removes the tree's trust entry from the global config when the tree goes", () => {
    const w = world();
    runOnce(interactive(w), task(), "r1", 1, HEAD);
    expect(existsSync(join(w.env.treesDir, "r1", "sample-task-1"))).toBe(false);
    expect(JSON.parse(readFileSync(w.env.claudeJson, "utf-8"))).toEqual({ projects: {} });
  });

  it("removes the trust entry when a session throws, too", () => {
    const w = world();
    w.answers.session = () => ({ status: 1, stderr: "driver crashed" });
    expect(() => runOnce(interactive(w), task(), "r1", 1, HEAD)).toThrow(/session driver[\s\S]*exited 1[\s\S]*driver crashed/);
    expect(JSON.parse(readFileSync(w.env.claudeJson, "utf-8"))).toEqual({ projects: {} });
    expect(existsSync(join(w.env.treesDir, "r1", "sample-task-1"))).toBe(false);
  });

  it("marks the record invalid, rather than throwing, when the author stalled before writing a transcript", () => {
    const w = world();
    w.answers.session = (request) => {
      if (!isAuthor(request)) return undefined;
      rmSync(join(w.env.projectsDir, "-tree", `${request.sessionId}.jsonl`));
      return driverSays({ settled: false, exitCode: 143, stalled: "no transcript after 60 s" });
    };
    const record = runOnce(interactive(w), task(), "r1", 1, HEAD);
    const [author] = sessionRequests(w.spawn);
    expect(record.invalid).toBe(`author session ${author?.sessionId} stalled: no transcript after 60 s`);
    expect(record.author.assistantMessages).toBe(0);
  });

  it("marks the record invalid and scores no trap through when the review stalled", () => {
    const w = world();
    w.answers.session = (request) => (isAuthor(request) ? undefined : driverSays({ settled: false, stalled: "trust dialog on screen" }));
    const record = runOnce(interactive(w), task(), "r1", 1, HEAD);
    const [, review] = sessionRequests(w.spawn);
    expect(record.invalid).toBe(`review session ${review?.sessionId} stalled: trust dialog on screen`);
    expect(record.traps["node-import"]).toBe("unreviewed");
  });

  it("marks an off-arm run invalid when its transcript used REPL, and leaves an on-arm one valid", () => {
    const off = world();
    authorUsesRepl(off);
    const record = runOnce(interactive(off, false), task(), "r1", 1, HEAD);
    expect(record.invalid).toBe(`author session ${sessionRequests(off.spawn)[0]?.sessionId} used REPL with Code Mode off`);
    const on = world();
    authorUsesRepl(on);
    expect(runOnce(interactive(on, true), task(), "r1", 1, HEAD).invalid).toBeNull();
  });

  it("records a session the driver killed at the wall clock as timed out", () => {
    const w = world();
    w.answers.session = (request) => (isAuthor(request) ? driverSays({ settled: false, exitCode: 143, timedOut: true }) : undefined);
    expect(runOnce(interactive(w), task(), "r1", 1, HEAD).timedOut).toBe(true);
  });

  it("throws when claude exited with an error before its turn settled", () => {
    const w = world();
    w.answers.session = () => driverSays({ settled: false, exitCode: 1 });
    expect(() => runOnce(interactive(w), task(), "r1", 1, HEAD)).toThrow(/exited 1 before its turn settled/);
  });

  it("throws, naming the session, when the driver prints no result", () => {
    const w = world();
    w.answers.session = () => ({ status: 0, stdout: "" });
    expect(() => runOnce(interactive(w), task(), "r1", 1, HEAD)).toThrow(/session driver for [\w-]+ printed no result/);
  });
});

describe("runRound() records the surface it ran on", () => {
  it.each<[string, EvalEnv["session"], { mode: string; codeMode: boolean }]>([
    ["a headless round", undefined, { mode: "print", codeMode: false }],
    ["an interactive round with Code Mode off", { kind: "interactive", codeMode: false }, { mode: "interactive", codeMode: false }],
    ["an interactive round with Code Mode on", { kind: "interactive", codeMode: true }, { mode: "interactive", codeMode: true }],
  ])("as %s", (_label, session, recorded) => {
    const w = world();
    const env = session === undefined ? w.env : { ...w.env, session };
    const [path] = runRound(env, "r1", [task()], 1);
    expect(JSON.parse(readFileSync(path ?? "", "utf-8"))).toMatchObject(recorded);
  });
});
