import { mock } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import type { SpawnOptions, SpawnOutcome } from "../../cli/types";
import { seedTrust } from "./session";
import type { EvalEnv, SessionRequest, SessionResult } from "./types";

/** A diff adding one line under `src/sample` that the sample `node-import` trap matches. */
export const FIRING_DIFF = [
  "diff --git a/src/sample/mod.ts b/src/sample/mod.ts",
  "--- a/src/sample/mod.ts",
  "+++ b/src/sample/mod.ts",
  "@@ -1 +1,2 @@",
  " export {};",
  '+import { readFileSync } from "node:fs";',
  "",
].join("\n");

/** What the fake world answers, for a test to change before it runs. */
export interface WorldAnswers {
  dirty: string;
  diff: () => string;
  review: string;
  claude: (args: string[]) => SpawnOutcome | undefined;
  /** What `claude --version` prints. */
  version: string;
  /** The session driver's answer to a request, after the transcript is written; a settled session when undefined. */
  session: (request: SessionRequest) => SpawnOutcome | undefined;
  transcript: (sessionId: string, args: string[]) => string;
  failing: (command: string, args: string[]) => boolean;
  worktree: Record<string, string>;
}

function argAfter(args: readonly string[], flag: string): string {
  return args[args.indexOf(flag) + 1] ?? "";
}

function emulateRg(args: string[], input: string): SpawnOutcome {
  const pattern = new RegExp(argAfter(args, "-e"));
  const hits = input
    .split("\n")
    .slice(0, -1)
    .flatMap((line, index) => (pattern.test(line) ? [`${index + 1}:${line}`] : []));
  return hits.length === 0 ? { status: 1, stdout: "" } : { status: 0, stdout: hits.join("\n") + "\n" };
}

function transcript(sessionId: string): string {
  const usage = { input_tokens: 5, cache_creation_input_tokens: 50, cache_read_input_tokens: 500, output_tokens: 7 };
  const block = { type: "tool_use", id: `tu-${sessionId}`, name: "Read", input: { file_path: "/x/docs/NAMESPACES.md" } };
  return JSON.stringify({ type: "assistant", message: { id: `msg-${sessionId}`, usage, content: [block] } }) + "\n";
}

/** The result the session driver prints for a session whose turn settled and that exited at `/exit`. */
export const SETTLED: SessionResult = { settled: true, exitCode: 0, timedOut: false, stalled: null };

function reply(sessionId: string, text: string): string {
  return (
    JSON.stringify({ type: "assistant", message: { id: `reply-${sessionId}`, stop_reason: "end_turn", content: [{ type: "text", text }] } }) + "\n"
  );
}

function seedWorktree(at: string, files: Record<string, string>): void {
  mkdirSync(at, { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(at, path), text, "utf-8");
}

/** A temporary checkout, evals, trees, cache and projects directory, and a spawner that plays git, bun, rg and claude in them. */
export function fakeWorld() {
  const root = mkdtempSync(join(tmpdir(), "forge-eval-world-"));
  const env = {
    checkout: join(root, "checkout"),
    evalsDir: join(root, "checkout", "tests", "evals"),
    treesDir: join(root, "trees"),
    cacheDir: join(root, "cache"),
    projectsDir: join(root, "projects"),
    claudeJson: join(root, "claude.json"),
    log: () => {},
  };
  mkdirSync(join(env.checkout, "node_modules"), { recursive: true });
  mkdirSync(env.evalsDir, { recursive: true });
  const answers: WorldAnswers = {
    dirty: "",
    diff: () => FIRING_DIFF,
    review: "```json\n[]\n```",
    claude: () => undefined,
    version: "2.1.400 (Claude Code)",
    session: () => undefined,
    transcript,
    failing: () => false,
    worktree: {},
  };
  let commits = 0;
  let head = "0".repeat(40);
  const parents = new Map<string, string>();

  const writeTranscript = (sessionId: string, text: string): void => {
    const dir = join(env.projectsDir, "-tree");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.jsonl`), text, "utf-8");
  };

  const answerSession = (request: SessionRequest): SpawnOutcome => {
    const text = answers.transcript(request.sessionId, request.argv.slice(1));
    writeTranscript(request.sessionId, text === "" ? "" : text + reply(request.sessionId, answers.review));
    seedTrust(env.claudeJson, request.tree);
    return answers.session(request) ?? { status: 0, stdout: JSON.stringify(SETTLED) };
  };

  const spawn = mock((command: string, args: string[], options: SpawnOptions): SpawnOutcome => {
    if (answers.failing(command, args)) return { status: 1, stdout: "", stderr: `${command} failed` };
    if (command === "rg") return emulateRg(args, options.input ?? "");
    if (command === "claude" && args[0] === "--version") return { status: 0, stdout: `${answers.version}\n` };
    if (command === "bun" && args[0]?.endsWith("session-bin.ts") === true)
      return answerSession(JSON.parse(options.input ?? "{}") as SessionRequest);
    if (command === "claude") {
      const sessionId = argAfter(args, "--session-id");
      writeTranscript(sessionId, answers.transcript(sessionId, args));
      const answer = answers.claude(args);
      if (answer !== undefined) return answer;
      return { status: 0, stdout: JSON.stringify({ type: "result", result: answers.review }) };
    }
    if (command !== "git") return { status: 0, stdout: "" };
    const [verb, ...rest] = args.filter((arg, index) => args[index - 1] !== "-c" && arg !== "-c");
    if (verb === "status") return { status: 0, stdout: answers.dirty };
    if (verb === "rev-parse") return { status: 0, stdout: `${head}\n` };
    if (verb === "commit") {
      commits += 1;
      const sha = String(commits).padStart(40, "0");
      parents.set(sha, head);
      head = sha;
    }
    if (verb === "reset") head = rest.at(-1) ?? head;
    if (verb === "diff") return { status: 0, stdout: answers.diff() };
    if (verb === "worktree" && rest[0] === "add") seedWorktree(argAfter(args, "--detach"), answers.worktree);
    if (verb === "worktree" && rest[0] === "remove") rmSync(argAfter(args, "--force"), { recursive: true, force: true });
    return { status: 0, stdout: "" };
  });

  const parentOf = (sha: string): string | undefined => parents.get(sha);
  const world: { root: string; env: EvalEnv; answers: WorldAnswers; spawn: typeof spawn; parentOf: typeof parentOf } = {
    root,
    env: { ...env, spawn },
    answers,
    spawn,
    parentOf,
  };
  return world;
}

/** Every request the fake spawner's session driver was handed, in order. */
export function sessionRequests(spawn: ReturnType<typeof fakeWorld>["spawn"]): SessionRequest[] {
  return spawn.mock.calls
    .filter(([command, args]) => command === "bun" && args[0]?.endsWith("session-bin.ts") === true)
    .map(([, , options]) => JSON.parse(options.input ?? "{}") as SessionRequest);
}

/** Every argv the fake spawner was handed for `command`. */
export function callsTo(spawn: ReturnType<typeof fakeWorld>["spawn"], command: string): string[][] {
  return spawn.mock.calls.filter(([cmd]) => cmd === command).map(([, args]) => args);
}

function checkoutFiles(checkout: string): Map<string, string> {
  const entries = readdirSync(checkout, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && !relative(checkout, entry.parentPath).startsWith("node_modules"));
  return new Map(
    files.map((entry) => [relative(checkout, join(entry.parentPath, entry.name)), readFileSync(join(entry.parentPath, entry.name), "utf-8")]),
  );
}

/** Commits the checkout as it stands, so `git status --porcelain` reports every file written into it from now on. */
export function statusFromDisk(world: ReturnType<typeof fakeWorld>): void {
  const committed = checkoutFiles(world.env.checkout);
  Object.defineProperty(world.answers, "dirty", {
    get: () => {
      const now = checkoutFiles(world.env.checkout);
      const added = [...now.keys()].filter((path) => !committed.has(path)).map((path) => `?? ${path}`);
      const changed = [...committed].filter(([path, text]) => now.get(path) !== text).map(([path]) => ` M ${path}`);
      return [...changed, ...added].map((line) => `${line}\n`).join("");
    },
  });
}
