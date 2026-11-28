import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertCodeModeAccepted, driveSession, NODE_SESSION_FS, seedTrust, sessionEnv, stripAnsi, unseedTrust } from "./session";
import type { PtyProcess, PtySpawnOptions, PtyTerminal, SessionDeps, SessionRequest } from "./types";

const SESSION = "5d1c2b3a-4f5e-4a6b-8c7d-9e0f1a2b3c4d";
const ESC = String.fromCharCode(27);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PROMPT = { type: "user", message: { role: "user", content: "do the task" } };
const TOOL_CALL = {
  type: "assistant",
  message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: {} }] },
};
const TOOL_RESULT = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] } };
const REPLY = { type: "assistant", message: { id: "m2", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } };
const TURN_DURATION = { type: "system", subtype: "turn_duration", durationMs: 1000, messageCount: 4 };
const COST_STATE = { type: "cost-state", totalCostUSD: 0.1 };

function place(): { root: string; tree: string; request: SessionRequest } {
  const root = mkdtempSync(join(tmpdir(), "forge-eval-session-"));
  roots.push(root);
  const tree = join(root, "tree");
  mkdirSync(tree);
  mkdirSync(join(root, "projects"));
  const request: SessionRequest = {
    argv: ["claude", "do the task", "--session-id", SESSION],
    tree,
    sessionId: SESSION,
    projectsDir: join(root, "projects"),
    claudeJson: join(root, "claude.json"),
    codeMode: false,
    timeoutMs: 20 * 60_000,
    screenLog: join(root, "cache", "r1", "task-1.pty.log"),
  };
  return { root, tree, request };
}

function append(request: SessionRequest, ...records: object[]): void {
  const path = join(request.projectsDir, "-tree", `${request.sessionId}.jsonl`);
  mkdirSync(join(path, ".."), { recursive: true });
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  writeFileSync(path, before + records.map((record) => JSON.stringify(record) + "\n").join(""), "utf-8");
}

/** A clock that runs each scheduled step once the time it names has passed. */
function fakeClock(steps: [number, () => void][] = []): SessionDeps["clock"] & { at: (ms: number, step: () => void) => void } {
  let now = 0;
  const pending = [...steps];
  return {
    now: () => now,
    sleep: (ms) => {
      now += ms;
      for (const step of pending.filter(([at]) => at <= now)) {
        pending.splice(pending.indexOf(step), 1);
        step[1]();
      }
      return Promise.resolve();
    },
    at: (ms, step) => {
      pending.push([ms, step]);
    },
  };
}

interface FakePty {
  spawn: SessionDeps["spawn"];
  options: () => PtySpawnOptions;
  argv: () => string[];
  writes: { at: number; data: string }[];
  kills: string[];
  emit: (text: string) => void;
  exit: (code: number) => void;
  closed: () => boolean;
}

/** A PTY whose process exits on `/exit` and on the signals `honours` names. */
function fakePty(clock: SessionDeps["clock"], honours: { exit: boolean; term: boolean } = { exit: true, term: true }): FakePty {
  let spawned: { argv: string[]; options: PtySpawnOptions } | undefined;
  let finish: (code: number) => void = () => {};
  let closed = false;
  const writes: { at: number; data: string }[] = [];
  const kills: string[] = [];
  const terminal: PtyTerminal = {
    write: (data) => {
      writes.push({ at: clock.now(), data });
      if (data === "/exit\r" && honours.exit) finish(0);
      return data.length;
    },
    close: () => {
      closed = true;
    },
  };
  const exited = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const process: PtyProcess = {
    terminal,
    exited,
    kill: (signal) => {
      kills.push(signal);
      if (signal === "SIGKILL" || honours.term) finish(signal === "SIGKILL" ? 137 : 143);
    },
  };
  return {
    spawn: (argv, options) => {
      spawned = { argv, options };
      return process;
    },
    options: () => spawned?.options ?? expect.unreachable("never spawned"),
    argv: () => spawned?.argv ?? expect.unreachable("never spawned"),
    writes,
    kills,
    emit: (text) => spawned?.options.terminal.data(terminal, new TextEncoder().encode(text)),
    exit: (code) => finish(code),
    closed: () => closed,
  };
}

function deps(clock: SessionDeps["clock"], pty: FakePty, env: Record<string, string> = {}): SessionDeps {
  return { clock, spawn: pty.spawn, fs: NODE_SESSION_FS, env };
}

describe("driveSession()", () => {
  it("types /exit once the turn has settled and the transcript has held still for 5 s, and reports a settled exit", async () => {
    const { request } = place();
    const clock = fakeClock([[3_000, () => append(request, PROMPT, REPLY, TURN_DURATION, COST_STATE)]]);
    const pty = fakePty(clock);
    const result = await driveSession(request, deps(clock, pty));
    expect(result).toEqual({ settled: true, exitCode: 0, timedOut: false, stalled: null });
    expect(pty.writes).toEqual([{ at: 8_000, data: "/exit\r" }]);
    expect(pty.kills).toEqual([]);
    expect(pty.closed()).toBe(true);
  });

  it("settles on an end_turn reply when no turn_duration record follows it", async () => {
    const { request } = place();
    const clock = fakeClock([[1_000, () => append(request, PROMPT, REPLY)]]);
    const pty = fakePty(clock);
    expect((await driveSession(request, deps(clock, pty))).settled).toBe(true);
    expect(pty.writes.map((write) => write.data)).toEqual(["/exit\r"]);
  });

  it("restarts the quiet window each time a transcript file changes, a subagent's included", async () => {
    const { request } = place();
    const subagent = join(request.projectsDir, "-tree", SESSION, "subagents", "agent-a.jsonl");
    const clock = fakeClock([
      [1_000, () => append(request, PROMPT, REPLY, TURN_DURATION)],
      [4_000, () => append(request, COST_STATE)],
      [
        7_000,
        () => {
          mkdirSync(join(subagent, ".."), { recursive: true });
          writeFileSync(subagent, JSON.stringify(REPLY) + "\n", "utf-8");
        },
      ],
    ]);
    const pty = fakePty(clock);
    await driveSession(request, deps(clock, pty));
    expect(pty.writes).toEqual([{ at: 12_000, data: "/exit\r" }]);
  });

  it("waits out a pending tool call, however long it runs, rather than calling it a stall", async () => {
    const { request } = place();
    const clock = fakeClock([
      [1_000, () => append(request, PROMPT, TOOL_CALL)],
      [300_000, () => append(request, TOOL_RESULT, REPLY, TURN_DURATION)],
    ]);
    const pty = fakePty(clock);
    const result = await driveSession(request, deps(clock, pty));
    expect(result.stalled).toBeNull();
    expect(pty.writes).toEqual([{ at: 305_000, data: "/exit\r" }]);
  });

  it("does not settle on a turn_duration while a tool call is unanswered", async () => {
    const { request } = place();
    const clock = fakeClock([
      [1_000, () => append(request, PROMPT, TOOL_CALL, TURN_DURATION)],
      [20_000, () => append(request, TOOL_RESULT, REPLY)],
    ]);
    const pty = fakePty(clock);
    await driveSession(request, deps(clock, pty));
    expect(pty.writes).toEqual([{ at: 25_000, data: "/exit\r" }]);
  });

  it.each([
    ["trust", `${ESC}[1mDo you trust the files in this folder?${ESC}[0m`],
    ["permission", `Do${ESC}[1Cyou${ESC}[1Cwant${ESC}[1Cto${ESC}[1Cproceed?`],
  ])("kills the session as stalled when a %s dialog is on screen, and saves the screen as plain text", async (kind, screen) => {
    const { request } = place();
    const clock = fakeClock();
    const pty = fakePty(clock);
    clock.at(2_000, () => pty.emit(`${ESC}[2Jworking\n${screen}\n`));
    const result = await driveSession(request, deps(clock, pty));
    expect(result).toMatchObject({ settled: false, timedOut: false, stalled: `${kind} dialog on screen` });
    expect(pty.kills).toEqual(["SIGTERM"]);
    const saved = readFileSync(request.screenLog, "utf-8");
    expect(saved).toContain("working");
    expect(saved).not.toContain(ESC);
  });

  it("kills the session as stalled when no transcript has appeared after 60 s", async () => {
    const { request } = place();
    const clock = fakeClock();
    const pty = fakePty(clock);
    const result = await driveSession(request, deps(clock, pty));
    expect(result.stalled).toBe("no transcript after 60 s");
    expect(clock.now()).toBeLessThan(70_000);
    expect(existsSync(request.screenLog)).toBe(true);
  });

  it("kills the session as stalled after 120 s with no transcript change and no tool call pending", async () => {
    const { request } = place();
    const clock = fakeClock([[1_000, () => append(request, PROMPT)]]);
    const pty = fakePty(clock);
    const result = await driveSession(request, deps(clock, pty));
    expect(result.stalled).toBe("no progress for 120 s");
    expect(pty.writes).toEqual([]);
  });

  it("kills a session that outlives the task's timeout and reports it timed out, not stalled", async () => {
    const { request } = place();
    const clock = fakeClock([[1_000, () => append(request, PROMPT, TOOL_CALL)]]);
    const pty = fakePty(clock);
    const result = await driveSession({ ...request, timeoutMs: 30_000 }, deps(clock, pty));
    expect(result).toMatchObject({ settled: false, timedOut: true, stalled: null, exitCode: 143 });
    expect(pty.kills).toEqual(["SIGTERM"]);
    expect(existsSync(request.screenLog)).toBe(false);
  });

  it("sends SIGTERM and then SIGKILL when the session ignores /exit and SIGTERM, and still reports it settled", async () => {
    const { request } = place();
    const clock = fakeClock([[1_000, () => append(request, PROMPT, REPLY, TURN_DURATION)]]);
    const pty = fakePty(clock, { exit: false, term: false });
    const result = await driveSession(request, deps(clock, pty));
    expect(result).toEqual({ settled: true, exitCode: 137, timedOut: false, stalled: null });
    expect(pty.writes.map((write) => write.data)).toEqual(["/exit\r"]);
    expect(pty.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("reports a session that exited on its own before its turn settled, as neither settled nor stalled", async () => {
    const { request } = place();
    const clock = fakeClock([[1_000, () => append(request, PROMPT, TOOL_CALL)]]);
    const pty = fakePty(clock);
    clock.at(5_000, () => pty.exit(1));
    const result = await driveSession(request, deps(clock, pty));
    expect(result).toEqual({ settled: false, exitCode: 1, timedOut: false, stalled: null });
    expect(pty.writes).toEqual([]);
    expect(pty.kills).toEqual([]);
  });

  it("spawns the argv in the tree on a 200 × 50 PTY", async () => {
    const { request } = place();
    const clock = fakeClock([[1_000, () => append(request, PROMPT, REPLY)]]);
    const pty = fakePty(clock);
    await driveSession(request, deps(clock, pty));
    expect(pty.argv()).toEqual(request.argv);
    expect(pty.options()).toMatchObject({ cwd: request.tree, terminal: { cols: 200, rows: 50 } });
  });

  it("trusts the tree's real path in the global config before it spawns", async () => {
    const { root, tree, request } = place();
    const linked = join(root, "linked-tree");
    symlinkSync(tree, linked);
    const clock = fakeClock([[1_000, () => append(request, PROMPT, REPLY)]]);
    const pty = fakePty(clock);
    let trustedAtSpawn: unknown;
    await driveSession(
      { ...request, tree: linked },
      {
        ...deps(clock, pty),
        spawn: (argv, options) => {
          trustedAtSpawn = (
            JSON.parse(readFileSync(request.claudeJson, "utf-8")) as { projects: Record<string, { hasTrustDialogAccepted?: boolean }> }
          ).projects[realpathSync(tree)]?.hasTrustDialogAccepted;
          return pty.spawn(argv, options);
        },
      },
    );
    expect(trustedAtSpawn).toBe(true);
  });

  it("refuses the Code Mode arm, spawning nothing, when the user has not accepted Code Mode's caveats", async () => {
    const { request } = place();
    writeFileSync(request.claudeJson, JSON.stringify({ codeModeCaveatsAcceptedV1: false }), "utf-8");
    const clock = fakeClock();
    const pty = fakePty(clock);
    await expect(driveSession({ ...request, codeMode: true }, deps(clock, pty))).rejects.toThrow(/has not accepted Code Mode's caveats/);
    expect(() => pty.argv()).toThrow();
  });

  it("runs the Code Mode arm once the caveats are accepted, and never sets the acceptance itself", async () => {
    const { request } = place();
    const clock = fakeClock([[1_000, () => append(request, PROMPT, REPLY)]]);
    const pty = fakePty(clock);
    await expect(driveSession({ ...request, codeMode: true }, deps(clock, pty))).rejects.toThrow(/has not accepted/);
    expect(existsSync(request.claudeJson)).toBe(false);
    writeFileSync(request.claudeJson, JSON.stringify({ codeModeCaveatsAcceptedV1: true }), "utf-8");
    await driveSession({ ...request, codeMode: true }, deps(clock, pty));
    expect(pty.options().env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE).toBe("1");
  });
});

describe("sessionEnv()", () => {
  it("drops the markers that would make the driven session a child of this one, which saves no transcript", () => {
    const base = {
      PATH: "/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_SESSION_ID: "x",
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    };
    expect(sessionEnv(base, false)).toEqual({
      PATH: "/bin",
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
      TERM: "xterm-256color",
      DISABLE_AUTOUPDATER: "1",
    });
  });

  it("drops an inherited Code Mode opt-in for the off arm, and sets it for the on arm", () => {
    const base = { PATH: "/bin", CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1", UNSET: undefined };
    expect(sessionEnv(base, false)).toEqual({ PATH: "/bin", TERM: "xterm-256color", DISABLE_AUTOUPDATER: "1" });
    expect(sessionEnv(base, true)).toEqual({
      PATH: "/bin",
      CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1",
      TERM: "xterm-256color",
      DISABLE_AUTOUPDATER: "1",
    });
  });
});

describe("seedTrust() and unseedTrust()", () => {
  it("adds the trust flag under the tree's real path and removes the entry again, keeping every other key", () => {
    const { root, tree, request } = place();
    const linked = join(root, "linked-tree");
    symlinkSync(tree, linked);
    const other = { numStartups: 3, codeModeCaveatsAcceptedV1: true, projects: { "/elsewhere": { allowedTools: ["Read"] } } };
    writeFileSync(request.claudeJson, JSON.stringify(other), "utf-8");
    seedTrust(request.claudeJson, linked);
    const seeded = JSON.parse(readFileSync(request.claudeJson, "utf-8")) as typeof other & { projects: Record<string, unknown> };
    expect(seeded.projects[realpathSync(tree)]).toEqual({ hasTrustDialogAccepted: true });
    expect(seeded).toMatchObject(other);
    unseedTrust(request.claudeJson, linked);
    expect(JSON.parse(readFileSync(request.claudeJson, "utf-8"))).toEqual(other);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("creates the config when there is none, and leaves it untouched when the tree has no entry", () => {
    const { tree, request } = place();
    unseedTrust(request.claudeJson, tree);
    expect(existsSync(request.claudeJson)).toBe(false);
    seedTrust(request.claudeJson, tree);
    expect(JSON.parse(readFileSync(request.claudeJson, "utf-8"))).toEqual({ projects: { [realpathSync(tree)]: { hasTrustDialogAccepted: true } } });
  });

  it("refuses a config that is not a JSON object rather than overwriting it", () => {
    const { tree, request } = place();
    writeFileSync(request.claudeJson, "[]", "utf-8");
    expect(() => seedTrust(request.claudeJson, tree)).toThrow(/does not hold a JSON object/);
    expect(readFileSync(request.claudeJson, "utf-8")).toBe("[]");
  });
});

describe("assertCodeModeAccepted()", () => {
  it("passes only when codeModeCaveatsAcceptedV1 is true", () => {
    const { request } = place();
    expect(() => assertCodeModeAccepted(request.claudeJson)).toThrow(/has not accepted/);
    writeFileSync(request.claudeJson, JSON.stringify({ codeModeCaveatsAcceptedV1: "yes" }), "utf-8");
    expect(() => assertCodeModeAccepted(request.claudeJson)).toThrow(/has not accepted/);
    writeFileSync(request.claudeJson, JSON.stringify({ codeModeCaveatsAcceptedV1: true }), "utf-8");
    expect(() => assertCodeModeAccepted(request.claudeJson)).not.toThrow();
  });
});

describe("stripAnsi()", () => {
  it("turns a cursor-forward into the spaces it skips and drops colour, OSC and other escapes", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m${ESC}[3Cgap${ESC}]0;title${String.fromCharCode(7)}${ESC}[?25lend`)).toBe("red   gapend");
  });
});
