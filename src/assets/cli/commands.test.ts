import { describe, expect, it } from "bun:test";
import type { CommandBase } from "../../cli/types";
import { createAssetsCommands } from "./commands";

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
  it("registers the seven asset subcommands", () => {
    const root = createAssetsCommands();
    const names = runnableCommands(root)
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(["all", "css", "fonts", "icons", "js", "sprites", "types"]);
  });

  it("puts `types` at the root, not under `build` — it builds nothing", () => {
    const root = createAssetsCommands();
    expect(root.commands.map((c) => c.name).sort()).toEqual(["build", "sprites", "types"]);
  });

  it("gives every runnable subcommand the shared config flag", () => {
    const root = createAssetsCommands();
    for (const cmd of runnableCommands(root)) {
      expect(cmd.flags.config).toEqual({ type: "string", description: "Path to assets.config.ts" });
    }
  });

  it("gives every runnable subcommand the shared root flag", () => {
    const root = createAssetsCommands();
    for (const cmd of runnableCommands(root)) {
      expect(cmd.flags.root).toEqual({ type: "string", description: "Application root (default: derived from forge's install path)" });
    }
  });
});
