import { describe, expect, it } from "bun:test";
import type { CommandBase } from "../../cli/types";
import { createAssetsCommands } from "./commands";

/** Depth-first collection of every runnable (leaf) command in the tree. */
function runnableCommands(root: CommandBase): CommandBase[] {
  const out: CommandBase[] = [];
  const walk = (cmd: CommandBase): void => {
    if (cmd.commands.length === 0) out.push(cmd);
    for (const child of cmd.commands) walk(child);
  };
  walk(root);
  return out;
}

describe("createAssetsCommands", () => {
  it("registers the six asset subcommands", () => {
    const root = createAssetsCommands();
    const names = runnableCommands(root)
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(["all", "css", "fonts", "icons", "js", "sprites"]);
  });

  it("gives every runnable subcommand the shared config flag", () => {
    const root = createAssetsCommands();
    for (const cmd of runnableCommands(root)) {
      expect(cmd.flags.config).toEqual({ type: "string", description: "Path to assets.config.ts" });
    }
  });
});
