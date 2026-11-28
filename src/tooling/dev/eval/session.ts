import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { findTranscripts, turnState } from "./transcript";
import type { PtyProcess, PtySpawn, SessionClock, SessionDeps, SessionFs, SessionRequest, SessionResult } from "./types";

const POLL_MS = 1_000;
const QUIET_MS = 5_000;
const FIRST_TRANSCRIPT_MS = 60_000;
const PROGRESS_MS = 120_000;
const EXIT_GRACE_MS = 10_000;
const TERM_GRACE_MS = 5_000;
const SCREEN_CHARS = 64 * 1024;
const DIALOG_WINDOW = 4_000;
const CODE_MODE = "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CURSOR_FORWARD = new RegExp(`${ESC}\\[(\\d*)C`, "g");
const ANSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-_]`, "g");

const DIALOGS: readonly (readonly [string, RegExp])[] = [
  ["trust", /Do you trust the files in this folder|Is this a project you created or one you trust/i],
  ["permission", /Do you want to (?:proceed|make this edit|create|allow)/i],
];

/** The file system `driveSession` and the trust helpers use unless a test injects another. */
export const NODE_SESSION_FS: SessionFs = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf-8"),
  write: (path, text) => writeFileSync(path, text, "utf-8"),
  rename: renameSync,
  realpath: (path) => realpathSync(path),
  stamp: (path) => {
    const stats = statSync(path);
    return `${stats.size}:${stats.mtimeMs}`;
  },
  mkdir: (path) => mkdirSync(path, { recursive: true }),
};

/** The real clock, `Bun.spawn`, the node file system and this process's environment. */
export function defaultSessionDeps(): SessionDeps {
  const bun: { spawn: PtySpawn } = Reflect.get(globalThis, "Bun");
  return {
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    spawn: (argv, options) => bun.spawn(argv, options),
    fs: NODE_SESSION_FS,
    env: process.env,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfig(claudeJson: string, fs: SessionFs): Record<string, unknown> {
  if (!fs.exists(claudeJson)) return {};
  const config: unknown = JSON.parse(fs.read(claudeJson));
  if (!isRecord(config)) throw new Error(`${claudeJson} does not hold a JSON object`);
  return config;
}

function writeConfig(claudeJson: string, config: Record<string, unknown>, fs: SessionFs): void {
  const staged = `${claudeJson}.forge-eval.tmp`;
  fs.write(staged, JSON.stringify(config, null, 2) + "\n");
  fs.rename(staged, claudeJson);
}

function projectsOf(config: Record<string, unknown>): Record<string, unknown> {
  return isRecord(config.projects) ? config.projects : {};
}

/** Marks the tree trusted in Claude Code's global config, keeping every other key, so the session opens without the trust dialog. */
export function seedTrust(claudeJson: string, tree: string, fs: SessionFs = NODE_SESSION_FS): void {
  const config = readConfig(claudeJson, fs);
  const projects = projectsOf(config);
  const key = fs.realpath(tree);
  const entry = projects[key];
  writeConfig(claudeJson, { ...config, projects: { ...projects, [key]: { ...(isRecord(entry) ? entry : {}), hasTrustDialogAccepted: true } } }, fs);
}

/** Removes the tree's entry from Claude Code's global config, leaving the file untouched when it has none. */
export function unseedTrust(claudeJson: string, tree: string, fs: SessionFs = NODE_SESSION_FS): void {
  const config = readConfig(claudeJson, fs);
  const projects = projectsOf(config);
  const key = fs.exists(tree) ? fs.realpath(tree) : tree;
  if (!(key in projects)) return;
  const { [key]: _removed, ...rest } = projects;
  writeConfig(claudeJson, { ...config, projects: rest }, fs);
}

/** Refuses a Code Mode session unless the user has accepted Code Mode's caveats themselves, which the harness never does for them. */
export function assertCodeModeAccepted(claudeJson: string, fs: SessionFs = NODE_SESSION_FS): void {
  if (readConfig(claudeJson, fs).codeModeCaveatsAcceptedV1 !== true) {
    throw new Error(
      `${claudeJson} has not accepted Code Mode's caveats — accept them once in your own interactive session before an --code-mode on round`,
    );
  }
}

/** What a Claude Code session sets for the processes it starts; inherited, they make the driven session a child of this one, which saves no transcript. */
const PARENT_SESSION_MARKERS = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_CHILD_NOTES_DIR",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_TTY",
]);

/** The environment an interactive session runs under: Code Mode set only for the "on" arm, no parent-session marker, a 256-colour terminal and no auto-update. */
export function sessionEnv(base: Readonly<Record<string, string | undefined>>, codeMode: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base))
    if (value !== undefined && key !== CODE_MODE && !PARENT_SESSION_MARKERS.has(key)) env[key] = value;
  if (codeMode) env[CODE_MODE] = "1";
  return { ...env, TERM: "xterm-256color", DISABLE_AUTOUPDATER: "1" };
}

/** Terminal output as plain text: a cursor-forward becomes the spaces it skips, and every other escape sequence is dropped. */
export function stripAnsi(text: string): string {
  return text.replace(CURSOR_FORWARD, (_match, count: string) => " ".repeat(Number(count || "1"))).replace(ANSI, "");
}

function screenBuffer(): { append: (bytes: Uint8Array) => void; text: () => string; dialog: () => string | undefined } {
  const decoder = new TextDecoder();
  let screen = "";
  return {
    append: (bytes) => {
      screen = (screen + stripAnsi(decoder.decode(bytes, { stream: true }))).slice(-SCREEN_CHARS);
    },
    text: () => screen,
    dialog: () => DIALOGS.find(([, pattern]) => pattern.test(screen.slice(-DIALOG_WINDOW)))?.[0],
  };
}

interface Child {
  readonly process: PtyProcess;
  exited: boolean;
  exitCode: number | null;
}

function track(process: PtyProcess): Child {
  const child: Child = { process, exited: false, exitCode: null };
  void process.exited.then((code) => {
    child.exited = true;
    child.exitCode = code;
  });
  return child;
}

async function waitForExit(child: Child, clock: SessionClock, ms: number): Promise<boolean> {
  for (let waited = 0; !child.exited && waited < ms; waited += POLL_MS) await clock.sleep(POLL_MS);
  return child.exited;
}

async function stop(child: Child, clock: SessionClock): Promise<void> {
  child.process.kill("SIGTERM");
  if (await waitForExit(child, clock, TERM_GRACE_MS)) return;
  child.process.kill("SIGKILL");
  child.exitCode = await child.process.exited;
  child.exited = true;
}

type Ending = { kind: "exited" | "settled" | "timedOut" } | { kind: "stalled"; reason: string };

async function watch(request: SessionRequest, child: Child, screen: ReturnType<typeof screenBuffer>, deps: SessionDeps): Promise<Ending> {
  const { clock, fs } = deps;
  const start = clock.now();
  let stamp = "";
  let changedAt = start;
  for (;;) {
    await clock.sleep(POLL_MS);
    if (child.exited) return { kind: "exited" };
    const now = clock.now();
    if (now - start >= request.timeoutMs) return { kind: "timedOut" };
    const dialog = screen.dialog();
    if (dialog !== undefined) return { kind: "stalled", reason: `${dialog} dialog on screen` };
    const paths = findTranscripts(request.sessionId, request.projectsDir);
    if (paths === undefined) {
      if (now - start >= FIRST_TRANSCRIPT_MS) return { kind: "stalled", reason: `no transcript after ${FIRST_TRANSCRIPT_MS / 1000} s` };
      continue;
    }
    const next = [paths.main, ...paths.subagents].map((path) => `${path}=${fs.stamp(path)}`).join("\n");
    if (next !== stamp) {
      stamp = next;
      changedAt = now;
    }
    const turn = turnState(paths);
    if (turn.settled && now - changedAt >= QUIET_MS) return { kind: "settled" };
    if (!turn.settled && turn.pendingTools === 0 && now - changedAt >= PROGRESS_MS) {
      return { kind: "stalled", reason: `no progress for ${PROGRESS_MS / 1000} s` };
    }
  }
}

/** Runs one interactive Claude Code session in a PTY until its turn settles and it exits, it stalls, or the wall clock runs out. */
export async function driveSession(request: SessionRequest, deps: SessionDeps): Promise<SessionResult> {
  if (request.codeMode) assertCodeModeAccepted(request.claudeJson, deps.fs);
  seedTrust(request.claudeJson, request.tree, deps.fs);
  const screen = screenBuffer();
  const child = track(
    deps.spawn(request.argv, {
      cwd: request.tree,
      env: sessionEnv(deps.env, request.codeMode),
      terminal: { cols: 200, rows: 50, data: (_terminal, bytes) => screen.append(bytes) },
    }),
  );
  try {
    const ending = await watch(request, child, screen, deps);
    if (ending.kind === "settled") {
      child.process.terminal?.write("/exit\r");
      if (!(await waitForExit(child, deps.clock, EXIT_GRACE_MS))) await stop(child, deps.clock);
    }
    if (ending.kind === "timedOut" || ending.kind === "stalled") await stop(child, deps.clock);
    if (ending.kind === "stalled") {
      deps.fs.mkdir(dirname(request.screenLog));
      deps.fs.write(request.screenLog, screen.text());
    }
    return {
      settled: ending.kind === "settled",
      exitCode: child.exitCode,
      timedOut: ending.kind === "timedOut",
      stalled: ending.kind === "stalled" ? ending.reason : null,
    };
  } finally {
    if (!child.exited) await stop(child, deps.clock);
    child.process.terminal?.close();
  }
}
