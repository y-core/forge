import type { SpawnSync } from "../../cli/types";

/** Where one session's transcript lives: the main file, and one file per subagent it dispatched. */
export interface TranscriptPaths {
  main: string;
  subagents: string[];
}

/** Tokens a session spent, summed once per assistant message. */
export interface TokenUsage {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

/** The warden MCP tools a session can read the corpus through. */
export type WardenTool = "search" | "read" | "outline" | "related" | "impact";

/** How a session read the governing documents, by the route it took. */
export interface DocReads {
  warden: Record<WardenTool, number>;
  /** The chunk ids `knowledge_read` was given, sorted and deduplicated. */
  chunks: string[];
  mdFileReads: number;
  /** The `*.md` paths `Read` was given, sorted and deduplicated. */
  mdPaths: string[];
  wardenCli: number;
  /** Bash commands that look like they print a `*.md` file — a heuristic, so never added to `mdFileReads`. */
  bashMdReads: number;
}

/** What one session and its subagents spent and read. */
export interface SessionMetrics {
  assistantMessages: number;
  tokens: TokenUsage;
  toolCalls: number;
  toolsByName: Record<string, number>;
  docReads: DocReads;
}

/** A commit of the checkout and the changes `git status --porcelain` reported against it, read once before a round or a check writes anything. */
export interface CheckoutHead {
  checkout: string;
  sha: string;
  changes: string;
}

/** Which tree a task runs in: a forge checkout, or a consumer app installing the packed forge. */
export type TreeKind = "forge" | "consumer";

/** How a trap is detected: a pattern over the added lines, a gate step, or a test copied in from `accept/`. */
export type TrapDetector =
  | { kind: "rg"; pattern: string; paths: string[]; pcre?: boolean | undefined }
  | { kind: "step"; label: string }
  | { kind: "test"; file: string };

/** A known way to get the task wrong, the rules it breaks, and how to detect it. */
export interface EvalTrap {
  id: string;
  /** Chunk ids of the rules the trap breaks; a finding citing any of them catches it. */
  rules: string[];
  detector: TrapDetector;
}

/** A task's `task.json`, as written. */
export interface EvalTaskSpec {
  id: string;
  tree: TreeKind;
  model: string;
  timeoutMinutes: number;
  /** Patches applied to the base tree before the author starts, in order, relative to the task directory. */
  bait: string[];
  /** Test files under `accept/`, each copied to the same path in the tree. */
  accept: string[];
  traps: EvalTrap[];
}

/** A task spec that `loadTask` has checked against the files beside it. */
export interface EvalTask extends EvalTaskSpec {
  /** Absolute path of the task directory. */
  dir: string;
}

/** One line a unified diff adds, at its line number in the new file. */
export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** What a run changed: the commit it started from, and the diff from there to the tree's `HEAD`. */
export interface RunChange {
  base: string;
  diff: string;
}

/** Whether a trap's detector fired, and the added lines an `rg` detector matched. */
export interface TrapFiring {
  fires: boolean;
  hits: AddedLine[];
}

/** A firing trap is `caught` or `through` by the review, or `unreviewed` when no review ran; one that did not fire is `clean`. */
export type TrapVerdict = "caught" | "through" | "unreviewed" | "clean";

/** One reviewer finding: the six `CODE_REVIEW.md` §1b fields and the chunk ids it rests on. */
export interface ReviewFinding {
  impact: string;
  /** `path/file.ts:123`, optionally followed by the function name. */
  where: string;
  what: string;
  exploitScenario: string;
  preconditions: string | string[];
  fix: string;
  chunkIds: string[];
}

/** The findings read from a reviewer's result; `reviewParseFailed` is set when its last JSON fence is missing or malformed. */
export interface ParsedReview {
  findings: ReviewFinding[];
  reviewParseFailed: boolean;
}

/** Which Claude Code surface a round's sessions run on: headless `-p`, or an interactive session in a PTY with Code Mode on or off. */
export type EvalSession = { kind: "print" } | { kind: "interactive"; codeMode: boolean };

/** The surface a round file records its sessions ran on. */
export type SessionMode = EvalSession["kind"];

/** Where an eval reads its specs and writes its trees, and how it spawns. */
export interface EvalEnv {
  /** The forge checkout under test; it must be clean. */
  checkout: string;
  /** The directory holding one subdirectory per task, `consumer-base/` and `results/`. */
  evalsDir: string;
  /** Throwaway trees and per-round MCP configs, all removed or rewritten by the next run. */
  treesDir: string;
  /** Raw diffs and consumer templates, outside the repository. */
  cacheDir: string;
  /** Where Claude Code writes session transcripts. */
  projectsDir: string;
  /** Claude Code's global config, where an interactive session's tree is trusted for the length of the run. */
  claudeJson: string;
  /** The surface every session runs on; headless when absent. */
  session?: EvalSession;
  spawn: SpawnSync;
  log: (line: string) => void;
}

/** How a Claude Code session ended: its id, whether it hit the wall clock, the reply text, and why the driver killed a stalled one. */
export interface SessionOutcome {
  sessionId: string;
  timedOut: boolean;
  result: string;
  stalled: string | null;
}

/** What the interactive driver is asked to run, as `session-bin.ts` reads it from stdin. */
export interface SessionRequest {
  /** The command and its arguments, starting with `claude`. */
  argv: string[];
  tree: string;
  sessionId: string;
  projectsDir: string;
  claudeJson: string;
  codeMode: boolean;
  timeoutMs: number;
  /** Where the screen is saved when the session stalls. */
  screenLog: string;
}

/** How the interactive driver's session ended, as `session-bin.ts` prints it. */
export interface SessionResult {
  /** True when the turn settled and the driver ended the session, by `/exit` or by a kill when that was ignored. */
  settled: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stalled: string | null;
}

/** Whether a session's last turn has ended, and how many tool calls it is still waiting on. */
export interface TurnState {
  settled: boolean;
  pendingTools: number;
}

/** One author run of a task, then its review and the mechanical judgement of what it produced. */
export interface RunRecord {
  rep: number;
  /** True when the author or the reviewer hit the task's wall-clock timeout. */
  timedOut: boolean;
  author: SessionMetrics;
  review: SessionMetrics;
  /** Why `compare` leaves the record out, naming the session at fault; null for a record it reads. */
  invalid: string | null;
  reviewParseFailed: boolean;
  findings: number;
  verifyUnit: boolean;
  accepted: boolean;
  traps: Record<string, TrapVerdict>;
}

/** One review of the reference solution with every plant applied, which measures the reviewer alone. */
export interface CalibrationRecord {
  rep: number;
  timedOut: boolean;
  review: SessionMetrics;
  invalid: string | null;
  reviewParseFailed: boolean;
  traps: Record<string, TrapVerdict>;
}

/** Every run of one task in a round, against the spec its hash names. */
export interface TaskResult {
  specHash: string;
  model: string;
  runs: RunRecord[];
  calibration: CalibrationRecord[];
}

/** A round file, `tests/evals/results/<round>.json`. */
export interface RoundFile {
  schema: 2;
  round: string;
  /** The forge commit every run in the round started from. */
  forgeSha: string;
  /** The `--setting-sources` every session in the round ran under. */
  settingSources: string[];
  /** The `claude --version` every session ran under; absent from a round recorded before it was. */
  claudeVersion?: string;
  /** The surface every session ran on; absent from a round recorded before it was, which ran headless. */
  mode?: SessionMode;
  /** Whether Code Mode was on for every session; absent from a round recorded before it was. */
  codeMode?: boolean;
  tasks: Record<string, TaskResult>;
}

/** What `compareRounds` prints, and whether any task regressed. */
export interface RoundComparison {
  lines: string[];
  regressed: boolean;
}

/** One hunk of a changelog diff, its trailing context dropped: the lines it expects, and the lines it leaves in their place. */
export interface ChangelogHunk {
  readonly before: readonly string[];
  readonly after: readonly string[];
}

/** The slice of Bun's PTY `Terminal` the driver writes to and closes. */
export interface PtyTerminal {
  write(data: string): number;
  close(): void;
}

/** The slice of a Bun subprocess spawned with a `terminal` that the driver watches and kills. */
export interface PtyProcess {
  readonly terminal: PtyTerminal | undefined;
  readonly exited: Promise<number>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

/** The options of `Bun.spawn` the driver passes. */
export interface PtySpawnOptions {
  cwd: string;
  env: Record<string, string>;
  terminal: { cols: number; rows: number; data: (terminal: PtyTerminal, data: Uint8Array) => void };
}

/** `Bun.spawn` narrowed to a PTY-attached process. */
export type PtySpawn = (argv: string[], options: PtySpawnOptions) => PtyProcess;

/** The wall clock the driver polls by. */
export interface SessionClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The file operations the driver performs outside the transcripts. */
export interface SessionFs {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, text: string): void;
  rename(from: string, to: string): void;
  realpath(path: string): string;
  /** Changes whenever the file's size or modification time does. */
  stamp(path: string): string;
  mkdir(path: string): void;
}

/** What `driveSession` runs against: a clock, a PTY spawner, the file system and the environment the session inherits. */
export interface SessionDeps {
  clock: SessionClock;
  spawn: PtySpawn;
  fs: SessionFs;
  env: Readonly<Record<string, string | undefined>>;
}
