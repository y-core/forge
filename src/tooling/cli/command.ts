import type { Command, CommandBase, CommandDefinition, FlagDefs } from "./types";

/** Creates a command from a definition, filling in the defaults for description, flags, args, and the empty subcommand list. @public */
export function createCommand<F extends FlagDefs = FlagDefs>(config: CommandDefinition<F>): Command<F> {
  const command: Command<F> = {
    name: config.name,
    description: config.description ?? "",
    flags: (config.flags ?? {}) as F,
    args: config.args ?? { kind: "none" },
    commands: [],
  };
  if (config.run) command.run = config.run;
  return command;
}

/** Attaches `child` under `parent` and links it back, throwing when `parent` already has a subcommand of that name. @public */
export function addCommand(parent: CommandBase, child: CommandBase): void {
  if (parent.commands.some((c) => c.name === child.name)) {
    throw new Error(`Duplicate command name: "${child.name}"`);
  }
  child.parent = parent;
  parent.commands.push(child);
}
