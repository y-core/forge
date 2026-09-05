import { describe, expect, it } from "bun:test";

import type { Command, CommandBase } from "../cli/types";
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
  it("registers the eight asset subcommands", () => {
    const root = createAssetsCommands();
    const names = runnableCommands(root)
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(["all", "css", "fonts", "icons", "js", "rasters", "sprites", "types"]);
  });

  it("groups by verb — `build` produces assets, `gen` produces a module describing them", () => {
    const root = createAssetsCommands();
    expect(root.commands.map((c) => c.name).sort()).toEqual(["build", "gen", "sprites"]);
    expect(root.commands.find((c) => c.name === "gen")?.commands.map((c) => c.name)).toEqual(["types"]);
  });

  // The default and the named form share one runner and one flags object rather than a second copy
  // that agrees until one is edited.
  it("makes a bare `assets build` mean `build all`, which is the union and so cannot do less", () => {
    const build = createAssetsCommands().commands.find((c) => c.name === "build") as Command | undefined;
    const all = build?.commands.find((c) => c.name === "all") as Command | undefined;
    expect(build?.run).toBeDefined();
    expect(build?.run).toBe(all?.run);
    expect(build?.flags).toBe(all?.flags);
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
