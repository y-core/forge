import { afterAll, describe, expect, it, mock } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { execute } from "../../cli/execute";
import type { CliIO } from "../../cli/types";
import { createEvalCommand, defaultEvalEnv, listTaskIds } from "./commands";
import { serializeRound } from "./results";
import { roundFile, runRecord, taskResult } from "./round.fixture";
import { removeAll, SAMPLE_FILES, sampleSpec, writeTaskDir } from "./task.fixture";
import { callsTo, fakeWorld, sessionRequests } from "./world.fixture";

const roots: string[] = [];
afterAll(() => removeAll(roots));

function world(): ReturnType<typeof fakeWorld> {
  const made = fakeWorld();
  roots.push(made.root);
  return made;
}

class Exit extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function io(): CliIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (msg) => out.push(msg),
    stderr: (msg) => err.push(msg),
    exit: (code) => {
      throw new Exit(code);
    },
  };
}

async function exitCode(run: Promise<void>): Promise<number> {
  try {
    await run;
    return 0;
  } catch (error) {
    if (error instanceof Exit) return error.code;
    throw error;
  }
}

function writeRounds(w: ReturnType<typeof fakeWorld>, before: string, after: string): void {
  mkdirSync(join(w.env.evalsDir, "results"), { recursive: true });
  writeFileSync(join(w.env.evalsDir, "results", "a.json"), before, "utf-8");
  writeFileSync(join(w.env.evalsDir, "results", "b.json"), after, "utf-8");
}

function addTask(w: ReturnType<typeof fakeWorld>, id: string): void {
  const { root, dir } = writeTaskDir(sampleSpec(id), SAMPLE_FILES);
  roots.push(root);
  cpSync(dir, join(w.env.evalsDir, id), { recursive: true });
}

describe("eval compare", () => {
  it("exits 0 when no figure regressed", async () => {
    const w = world();
    const log = mock((_line: string) => {});
    writeRounds(w, serializeRound(roundFile("a")), serializeRound(roundFile("b")));
    expect(await exitCode(execute(createEvalCommand({ ...w.env, log }), ["compare", "a", "b"], io()))).toBe(0);
    expect(log.mock.calls.at(-1)?.[0]).toBe("no regression");
  });

  it("exits 1 when a figure regressed", async () => {
    const w = world();
    writeRounds(w, serializeRound(roundFile("a")), serializeRound(roundFile("b", { t: taskResult({ runs: [runRecord({ accepted: false })] }) })));
    expect(await exitCode(execute(createEvalCommand(w.env), ["compare", "a", "b"], io()))).toBe(1);
  });

  it("exits 1 on a respecced task, and 0 under --allow-respec", async () => {
    const w = world();
    writeRounds(w, serializeRound(roundFile("a")), serializeRound(roundFile("b", { t: taskResult({ specHash: "spec-2" }) })));
    expect(await exitCode(execute(createEvalCommand(w.env), ["compare", "a", "b"], io()))).toBe(1);
    expect(await exitCode(execute(createEvalCommand(w.env), ["compare", "a", "b", "--allow-respec"], io()))).toBe(0);
  });

  it("refuses a headless round against an interactive one, and compares them under --allow-mixed-mode", async () => {
    const w = world();
    writeRounds(w, serializeRound(roundFile("a")), serializeRound({ ...roundFile("b"), mode: "interactive" }));
    const streams = io();
    expect(await exitCode(execute(createEvalCommand(w.env), ["compare", "a", "b"], streams))).toBe(1);
    expect(streams.err.join("\n")).toContain("--allow-mixed-mode");
    expect(await exitCode(execute(createEvalCommand(w.env), ["compare", "a", "b", "--allow-mixed-mode"], io()))).toBe(0);
  });
});

describe("eval check", () => {
  it("spends no session, and exits 1 when a task has a problem", async () => {
    const w = world();
    addTask(w, "sample-task");
    const code = await exitCode(execute(createEvalCommand(w.env), ["check", "--task", "sample-task"], io()));
    expect(code).toBe(1);
    expect(w.spawn.mock.calls.some(([command]) => command === "claude")).toBe(false);
  });

  it("refuses to build a consumer template from a dirty checkout, and caches none under the sha", async () => {
    const w = world();
    const { root, dir } = writeTaskDir({ ...sampleSpec("consumer-task"), tree: "consumer" }, SAMPLE_FILES);
    roots.push(root);
    cpSync(dir, join(w.env.evalsDir, "consumer-task"), { recursive: true });
    w.answers.dirty = " M src/http/mod.ts\n";
    const streams = io();
    expect(await exitCode(execute(createEvalCommand(w.env), ["check", "--task", "consumer-task"], streams))).toBe(1);
    expect(streams.err.join("\n")).toContain("uncommitted changes");
    expect(existsSync(w.env.cacheDir) ? readdirSync(w.env.cacheDir).filter((name) => name.startsWith("consumer-")) : []).toEqual([]);
    expect(callsTo(w.spawn, "bun").some((args) => args[0] === "pm")).toBe(false);
  });

  it("refuses a task that does not exist", async () => {
    const w = world();
    const streams = io();
    expect(await exitCode(execute(createEvalCommand(w.env), ["check", "--task", "nope"], streams))).toBe(1);
    expect(streams.err.join("\n")).toContain("no eval task nope");
  });
});

describe("eval run", () => {
  it("refuses a dirty checkout without spending a session", async () => {
    const w = world();
    addTask(w, "sample-task");
    w.answers.dirty = " M package.json\n";
    const streams = io();
    expect(await exitCode(execute(createEvalCommand(w.env), ["run", "--round", "r1"], streams))).toBe(1);
    expect(w.spawn.mock.calls.some(([command]) => command === "claude")).toBe(false);
  });

  it("refuses a rep count that is not a whole number", async () => {
    const w = world();
    addTask(w, "sample-task");
    const streams = io();
    expect(await exitCode(execute(createEvalCommand(w.env), ["run", "--round", "r1", "--reps", "0"], streams))).toBe(1);
    expect(streams.err.join("\n")).toContain("--reps");
  });
});

describe("eval run --interactive", () => {
  it("drives every session through the PTY driver with Code Mode off unless asked, and records the round as interactive", async () => {
    const w = world();
    addTask(w, "sample-task");
    expect(await exitCode(execute(createEvalCommand(w.env), ["run", "--round", "r1", "--interactive"], io()))).toBe(0);
    expect(callsTo(w.spawn, "claude").filter((args) => args[0] !== "--version")).toEqual([]);
    expect(sessionRequests(w.spawn).map((request) => request.codeMode)).toEqual([false, false, false]);
    const round = JSON.parse(readFileSync(join(w.env.evalsDir, "results", "r1.json"), "utf-8")) as { mode: string; codeMode: boolean };
    expect(round).toMatchObject({ mode: "interactive", codeMode: false });
  });

  it("turns Code Mode on for --code-mode on", async () => {
    const w = world();
    addTask(w, "sample-task");
    expect(await exitCode(execute(createEvalCommand(w.env), ["run", "--round", "r1", "--interactive", "--code-mode", "on"], io()))).toBe(0);
    expect(sessionRequests(w.spawn).every((request) => request.codeMode)).toBe(true);
  });

  it.each([
    [["--code-mode", "on"], "--code-mode needs --interactive"],
    [["--interactive", "--code-mode", "maybe"], "--code-mode must be on or off, got maybe"],
  ])("refuses %p without spending a session", async (flags, message) => {
    const w = world();
    addTask(w, "sample-task");
    const streams = io();
    expect(await exitCode(execute(createEvalCommand(w.env), ["run", "--round", "r1", ...flags], streams))).toBe(1);
    expect(streams.err.join("\n")).toContain(message);
    expect(w.spawn.mock.calls.some(([command, args]) => command === "claude" || args[0]?.endsWith("session-bin.ts"))).toBe(false);
  });

  it("fails the round when claude --version changed while it ran", async () => {
    const w = world();
    addTask(w, "sample-task");
    w.answers.session = () => {
      w.answers.version = "2.1.401 (Claude Code)";
      return undefined;
    };
    const streams = io();
    expect(await exitCode(execute(createEvalCommand(w.env), ["run", "--round", "r1", "--interactive"], streams))).toBe(1);
    expect(streams.err.join("\n")).toContain("claude changed from 2.1.400 (Claude Code) to 2.1.401 (Claude Code) during the round");
  });
});

describe("listTaskIds()", () => {
  it("lists the directories holding a task.json, and skips consumer-base and results", () => {
    const w = world();
    addTask(w, "b-task");
    addTask(w, "a-task");
    mkdirSync(join(w.env.evalsDir, "consumer-base"));
    mkdirSync(join(w.env.evalsDir, "results"));
    expect(listTaskIds(w.env.evalsDir)).toEqual(["a-task", "b-task"]);
  });
});

describe("defaultEvalEnv()", () => {
  it("reads specs from this checkout's tests/evals and keeps trees and diffs outside it", () => {
    const env = defaultEvalEnv();
    expect(env.evalsDir).toBe(join(env.checkout, "tests", "evals"));
    expect(env.treesDir.startsWith(env.checkout)).toBe(false);
    expect(env.cacheDir.startsWith(env.checkout)).toBe(false);
  });
});
