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
}

export type FlagDef = BooleanFlagDef | StringFlagDef;

export type FlagDefs = Record<string, FlagDef>;

export type ResolvedFlags<F extends FlagDefs> = {
  [K in keyof F]: F[K] extends BooleanFlagDef
    ? boolean
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
  run?: (args: string[], flags: ResolvedFlags<F>) => void | Promise<void>;
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
  run?: (args: string[], flags: ResolvedFlags<F>) => void | Promise<void>;
}

export interface CliIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
  exit: (code: number) => never;
}

export type CliErrorKind = "unknown-flag" | "missing-value" | "invalid-args" | "missing-command";

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

export type AnyFlags = Record<string, boolean | string | undefined>;
/** Flag-type-erased call signature `execute` invokes a command through once its flag generic is gone. @internal */
export type CallableCommand = { run?: (args: string[], flags: AnyFlags) => void | Promise<void> };
