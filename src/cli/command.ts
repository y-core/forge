import type { Command, CommandBase, CommandConfig, FlagDefs } from "./types";

export function createCommand<F extends FlagDefs = FlagDefs>(config: CommandConfig<F>): Command<F> {
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

export function addCommand(parent: CommandBase, child: CommandBase): void {
  if (parent.commands.some((c) => c.name === child.name)) {
    throw new Error(`Duplicate command name: "${child.name}"`);
  }
  child.parent = parent;
  parent.commands.push(child);
}
