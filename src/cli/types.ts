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

// Conditional mapped type: boolean flags → boolean, string flags with a default → string,
// required string flags → string, all other string flags → string | undefined.
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

export interface CommandConfig<F extends FlagDefs = FlagDefs> {
  name: string;
  description?: string;
  flags?: F;
  args?: ArgValidator;
  run?: (args: string[], flags: ResolvedFlags<F>) => void | Promise<void>;
}

// CommandBase holds the tree-structural properties without the typed run handler.
// Used for parent/commands links to avoid invariance conflicts arising from the
// contravariant `flags` parameter in `Command<F>.run`.
export interface CommandBase {
  name: string;
  description: string;
  flags: FlagDefs;
  args: ArgValidator;
  parent?: CommandBase;
  commands: CommandBase[];
}

// Command<F> extends CommandBase and adds a type-safe run handler.
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

/** A logger bound to a `[scope]` prefix. */
export interface ScopedLogger {
  /** Progress line to stdout: `[scope] msg`. */
  info(msg: string): void;
  /** Warning line to stderr: `[scope] msg`. */
  warn(msg: string): void;
  /** Completion line to stdout: `[scope] msg`. */
  done(msg: string): void;
}

// Internal types used to invoke run without knowing the specific flag type.
// CommandBase omits run deliberately; we recover it here via an assertion.
export type AnyFlags = Record<string, boolean | string | undefined>;
export type CallableCommand = { run?: (args: string[], flags: AnyFlags) => void | Promise<void> };
