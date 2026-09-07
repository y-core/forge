import { describe, expect, it } from "bun:test";

import { createWardenCommands } from "./commands";

describe("createWardenCommands()", () => {
  it("mounts every verb under one root", () => {
    const root = createWardenCommands();

    expect(root.name).toBe("warden");
    expect(root.commands.map((command) => command.name)).toEqual([
      "sync",
      "natives",
      "show",
      "index",
      "search",
      "read",
      "outline",
      "related",
      "catalogue",
      "serve",
    ]);
  });

  it("gives sync the four flags the migration and the gate both depend on", () => {
    const sync = createWardenCommands().commands.find((command) => command.name === "sync");

    expect(Object.keys(sync?.flags ?? {}).sort()).toEqual(["check", "init", "kind", "root"]);
  });

  it("gives every command but `show` a --root, so none has to discover the repository", () => {
    for (const command of createWardenCommands().commands) {
      if (command.name === "show") continue;
      expect(command.flags.root).toEqual({ type: "string", description: "Repository root (default: derived from warden's install path)" });
    }
  });
});
