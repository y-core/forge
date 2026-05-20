import { argv as processArgv, exit as processExit } from "node:process";
import { CliError, formatError } from "./errors";
import { formatHelp } from "./help";
import { collectFlags, parseArgs } from "./parse";
import type { CliIO, CommandBase } from "./types";

// Internal type used to invoke run without knowing the specific flag type.
// CommandBase omits run deliberately; we recover it here via an assertion.
type AnyFlags = Record<string, boolean | string | undefined>;
type CallableCommand = { run?: (args: string[], flags: AnyFlags) => void | Promise<void> };

export async function execute(root: CommandBase, argv?: string[], io?: CliIO): Promise<void> {
  const tokens = argv ?? processArgv.slice(2);
  const resolvedIO: CliIO = io ?? {
    stdout: (msg) => console.log(msg),
    stderr: (msg) => console.error(msg),
    exit: processExit as (code: number) => never,
  };

  try {
    // Descend the command tree by matching leading non-flag tokens to subcommand names
    let current: CommandBase = root;
    let remaining = tokens;

    while (remaining.length > 0 && !remaining[0].startsWith("-")) {
      const sub = current.commands.find((c) => c.name === remaining[0]);
      if (!sub) break;
      current = sub;
      remaining = remaining.slice(1);
    }

    if (remaining.includes("--help") || remaining.includes("-h")) {
      resolvedIO.stdout(formatHelp(current));
      return;
    }

    const flagDefs = collectFlags(current);
    const { args, flags } = parseArgs(remaining, flagDefs);

    validateArgs(current, args);

    const callable = current as unknown as CallableCommand;
    if (callable.run) {
      await callable.run(args, flags as AnyFlags);
    } else if (current.commands.length > 0) {
      // User invoked a group command without a subcommand — show help
      resolvedIO.stdout(formatHelp(current));
    } else {
      throw new CliError("missing-command", `Command "${current.name}" has no run handler`);
    }
  } catch (err) {
    if (err instanceof CliError) {
      resolvedIO.stderr(formatError(err));
    } else if (err instanceof Error) {
      resolvedIO.stderr(`Error: ${err.message}`);
    } else {
      resolvedIO.stderr("Error: unknown error");
    }
    resolvedIO.exit(1);
  }
}

function validateArgs(command: CommandBase, args: string[]): void {
  const v = command.args;
  switch (v.kind) {
    case "none":
      if (args.length > 0)
        throw new CliError("invalid-args", `Command "${command.name}" takes no arguments, got ${args.length}`);
      break;
    case "exact":
      if (args.length !== v.count)
        throw new CliError(
          "invalid-args",
          `Command "${command.name}" requires exactly ${v.count} argument(s), got ${args.length}`,
        );
      break;
    case "min":
      if (args.length < v.min)
        throw new CliError(
          "invalid-args",
          `Command "${command.name}" requires at least ${v.min} argument(s), got ${args.length}`,
        );
      break;
    case "max":
      if (args.length > v.max)
        throw new CliError(
          "invalid-args",
          `Command "${command.name}" requires at most ${v.max} argument(s), got ${args.length}`,
        );
      break;
    case "range":
      if (args.length < v.min || args.length > v.max)
        throw new CliError(
          "invalid-args",
          `Command "${command.name}" requires ${v.min}–${v.max} argument(s), got ${args.length}`,
        );
      break;
  }
}
