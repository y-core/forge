import type { Colorize } from "../term/types";

export interface BooleanFlagDef {
  type: "boolean";
  short?: string;
  description?: string;
  persistent?: boolean;
}

export interface StringFlagDef {
  type: "string";
  short?: string;
  description?: string;
  persistent?: boolean;
  default?: string;
  required?: boolean;
  /** Accept the flag more than once, collecting every occurrence. Without it, a repeat throws. */
  multiple?: boolean;
}

export type FlagDef = BooleanFlagDef | StringFlagDef;

export type FlagDefs = Record<string, FlagDef>;

/** What `parseArgs` hands a handler, derived from the flag table. */
export type ResolvedFlags<F extends FlagDefs> = {
  [K in keyof F]: F[K] extends BooleanFlagDef
    ? boolean
    : F[K] extends { multiple: true }
      ? string[]
      : F[K] extends { type: "string"; default: string }
        ? string
        : F[K] extends { type: "string"; required: true }
          ? string
          : string | undefined;
};

export type ArgValidator =
  | { kind: "none" }
  | { kind: "exact"; count: number }
  | { kind: "min"; min: number }
  | { kind: "max"; max: number }
  | { kind: "range"; min: number; max: number };

export interface CommandDefinition<F extends FlagDefs = FlagDefs> {
  name: string;
  description?: string;
  flags?: F;
  args?: ArgValidator;
  run?: (args: string[], flags: ResolvedFlags<F>, ctx?: CliContext) => void | Promise<void>;
}

/** Flag-type-erased view of a command, used to walk the command tree where the flag generic cannot be carried. */
export interface CommandBase {
  name: string;
  description: string;
  flags: FlagDefs;
  args: ArgValidator;
  parent?: CommandBase;
  commands: CommandBase[];
}

export interface Command<F extends FlagDefs = FlagDefs> extends CommandBase {
  flags: F;
  run?: (args: string[], flags: ResolvedFlags<F>, ctx?: CliContext) => void | Promise<void>;
}

export interface CliIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
  exit: (code: number) => never;
}

/** What a handler is told about the terminal it is writing to. @public */
export interface CliContext {
  /** Where the command writes, and how it exits. */
  io: CliIO;
  /** Styler resolved for stdout. */
  out: Colorize;
  /** Styler resolved for stderr, which may carry colour where `out` does not. */
  err: Colorize;
  /** Columns available on stdout. */
  width: number;
}

/** Why a command failed: a flag or argument problem, a missing handler, or a command this tool ran that failed. @public */
export type CliErrorKind = "unknown-flag" | "missing-value" | "invalid-args" | "missing-command" | "external";

/** Map of tool command → install hint, surfaced verbatim when the tool is missing. */
export type ToolHints = Record<string, string>;

/** Outcome of a buffered child process spawned by `capture`. */
export interface CaptureResult {
  code: number;
  output: string;
  ms: number;
}

/** A logger bound to a `[scope]` prefix. */
export interface ScopedLogger {
  info(msg: string): void;
  warn(msg: string): void;
  done(msg: string): void;
}

export type AnyFlags = Record<string, boolean | string | string[] | undefined>;
/** Flag-type-erased call signature `execute` invokes a command through once its flag generic is gone. @internal */
export type CallableCommand = { run?: (args: string[], flags: AnyFlags, ctx?: CliContext) => void | Promise<void> };

/** Where a bin looks for its configuration module, and what to call it when it is wrong. */
export interface ConfigModuleRequest {
  /** Directory a relative `path` resolves against. */
  root: string;
  /** Module path, absolute or relative to `root`. */
  path: string;
  /** Whether the caller named `path` rather than falling back to the default. */
  explicit: boolean;
  /** What the module holds, named in every error — e.g. `"step table"`. */
  what: string;
}

/** How wide to render, and what to render it in. @public */
export interface HelpOptions {
  /** Columns the block must fit in. Defaults to 80, so a test can pin it and stay exact-match. */
  width?: number;
  /** Styler for the headings. Defaults to `PLAIN`. */
  style?: Colorize;
}

export interface JsoncEdit {
  path: JsonPath;
  value: Primitive;
}

export interface JsoncEditError {
  message: string;
  path?: JsonPath | undefined;
}

/** A path into a JSON document: object keys and array indices, outermost first. @public */
export type JsonPath = (string | number)[];

export type Primitive = string | number | boolean | null;

export type JsoncNode =
  | { kind: "object"; start: number; end: number; members: JsoncMember[] }
  | { kind: "array"; start: number; end: number; elements: JsoncNode[] }
  | { kind: "string" | "number" | "boolean" | "null"; start: number; end: number };

export interface JsoncMember {
  key: string;
  /** Offset of the key's opening quote. */
  keyStart: number;
  /** Offset just past the key's closing quote. */
  keyEnd: number;
  value: JsoncNode;
  /** Offset just past the value — before any trailing comma or comment. */
  end: number;
}

export interface JsoncParseError {
  message: string;
  offset: number;
}

/** What one argv element turned out to be. @public */
export type TokenKind = "option" | "option-terminator" | "positional";

/** One element of the command line, classified but not yet matched against any definition. @public */
export interface ArgToken {
  kind: TokenKind;
  /** Index into the original argv, not into this token stream; a whole cluster carries the index it came from. */
  index: number;
  /** Flag name: the long name without `--`, or the single letter without `-`. */
  name?: string;
  /** The element as written, dashes included. */
  raw?: string;
  /** A positional's text, or an option's inline `=` value. */
  value?: string;
  /** Whether `value` came from an `=` rather than the next element. */
  inline?: boolean;
}

/** What `confirm` asks, and where it asks it. @public */
export interface ConfirmOptions {
  /** The object of the action, completing `About to <verb> <what>`. */
  what: string;
  /** Names of the things affected, listed after a colon in the prompt and the refusal. */
  detail?: string;
  /** One sentence on why the action cannot be taken back. */
  consequence: string;
  /** The verb the prompt and the refusal use. Defaults to `proceed`. */
  verb?: string;
  /** `--yes`: skip the prompt entirely. */
  yes?: boolean | undefined;
  /** Stream the answer is read from. Defaults to `process.stdin`. */
  input?: NodeStdioStream;
  /** Stream the question is written to. Defaults to `process.stdout`. */
  output?: NodeStdioStream;
  /** Whether a prompt can be shown. Defaults to `input.isTTY`. */
  interactive?: boolean;
  /** Where the preamble lines go. Defaults to `console.log`. */
  print?: (line: string) => void;
  /** The error a `n` answer raises. */
  cancelMessage?: string;
}

/** The options this namespace hands a spawner — the exact shapes `run`, `capture` and `probeOk` build. */
export interface SpawnOptions {
  readonly stdio: "ignore" | "inherit" | ["ignore", number, number];
  readonly env: typeof process.env;
  readonly cwd?: string;
}

/** How a spawned command exited, narrowed to what this namespace reads of it. */
export interface SpawnOutcome {
  readonly status: number | null;
  readonly error?: Error | undefined;
}

/** Runs a command to completion — the seam these helpers take, so a test substitutes it rather than mocking the module for the whole process. */
export type SpawnSync = (command: string, args: string[], options: SpawnOptions) => SpawnOutcome;
