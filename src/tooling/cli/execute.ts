import process, { argv as processArgv, exit as processExit } from "node:process";

import { resolveColorLevel } from "../term/capability";
import { createColorize } from "../term/color";
import { terminalWidth } from "../term/terminal";
import { CliError, formatError } from "./errors";
import { formatHelp } from "./help";
import { collectFlags, parseArgs } from "./parse";
import { suggest } from "./suggest";
import type { AnyFlags, CallableCommand, CliContext, CliIO, CommandBase } from "./types";

function validateArgs(command: CommandBase, args: string[]): void {
  const v = command.args;
  switch (v.kind) {
    case "none":
      if (args.length > 0) throw new CliError("invalid-args", `Command "${command.name}" takes no arguments, got ${args.length}`);
      break;
    case "exact":
      if (args.length !== v.count)
        throw new CliError("invalid-args", `Command "${command.name}" requires exactly ${v.count} argument(s), got ${args.length}`);
      break;
    case "min":
      if (args.length < v.min)
        throw new CliError("invalid-args", `Command "${command.name}" requires at least ${v.min} argument(s), got ${args.length}`);
      break;
    case "max":
      if (args.length > v.max)
        throw new CliError("invalid-args", `Command "${command.name}" requires at most ${v.max} argument(s), got ${args.length}`);
      break;
    case "range":
      if (args.length < v.min || args.length > v.max)
        throw new CliError("invalid-args", `Command "${command.name}" requires ${v.min}–${v.max} argument(s), got ${args.length}`);
      break;
  }
}

/** Resolves the subcommand from argv, parses and validates its flags and args, runs it, and exits 1 on any error. @public */
export async function execute(root: CommandBase, argv?: string[], io?: CliIO): Promise<void> {
  const tokens = argv ?? processArgv.slice(2);
  const resolvedIO: CliIO = io ?? {
    stdout: (msg) => console.log(msg),
    stderr: (msg) => console.error(msg),
    exit: processExit as (code: number) => never,
  };

  // Two levels, not one: `forge verify > log.txt` must still colour progress on the terminal
  // stderr is still attached to, while the redirected stdout stays clean.
  const env = process.env;
  const ctx: CliContext = {
    io: resolvedIO,
    out: createColorize(resolveColorLevel({ env, isTTY: process.stdout.isTTY === true, argv: tokens })),
    err: createColorize(resolveColorLevel({ env, isTTY: process.stderr.isTTY === true, argv: tokens })),
    width: terminalWidth(process.stdout),
  };

  try {
    let current: CommandBase = root;
    let remaining = tokens;

    while (remaining.length > 0) {
      const head = remaining[0];
      if (head === undefined || head.startsWith("-")) break;
      const sub = current.commands.find((c) => c.name === head);
      if (!sub) break;
      current = sub;
      remaining = remaining.slice(1);
    }

    // Descent stopped on a non-subcommand word. Where the command takes no arguments that word can
    // only be a mistype, so naming it beats surfacing `takes no arguments, got 1`.
    const stopped = remaining[0];
    if (stopped !== undefined && !stopped.startsWith("-") && current.commands.length > 0 && current.args.kind === "none") {
      const alternative = suggest(
        stopped,
        current.commands.map((c) => c.name),
      );
      throw new CliError(
        "missing-command",
        `Unknown command "${stopped}" for "${current.name}".${alternative === undefined ? "" : ` Did you mean "${alternative}"?`}`,
      );
    }

    if (remaining.includes("--help") || remaining.includes("-h")) {
      resolvedIO.stdout(formatHelp(current, { width: ctx.width, style: ctx.out }));
      return;
    }

    const flagDefs = collectFlags(current);
    const { args, flags } = parseArgs(remaining, flagDefs);

    validateArgs(current, args);

    const callable = current as unknown as CallableCommand;
    if (callable.run) {
      await callable.run(args, flags as AnyFlags, ctx);
    } else if (current.commands.length > 0) {
      resolvedIO.stdout(formatHelp(current, { width: ctx.width, style: ctx.out }));
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
