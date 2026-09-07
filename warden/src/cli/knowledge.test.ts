import { describe, expect, it } from "bun:test";

import { createCommand } from "../../../src/tooling/cli/command";
import type { CommandBase } from "../../../src/tooling/cli/types";
import { createCatalogueCommand, createKnowledgeCommands, createServeCommand } from "./knowledge";

function tree(): CommandBase {
  const root = createCommand({ name: "warden" });
  createKnowledgeCommands(root);
  createCatalogueCommand(root);
  createServeCommand(root);
  return root;
}

describe("the knowledge commands", () => {
  it("mounts the five knowledge verbs, the catalogue and the server", () => {
    expect(tree().commands.map((command) => command.name)).toEqual(["index", "search", "read", "outline", "related", "catalogue", "serve"]);
  });

  it("gives every one a --root, so no command has to discover the repository", () => {
    for (const command of tree().commands) expect(command.flags.root).toBeDefined();
  });

  it("lets a caller name the canon tree rather than relying on package.json", () => {
    for (const command of tree().commands) expect(command.flags.kind).toBeDefined();
  });

  it("gives the commands that read an index a --gate flag, so the gate's own can be inspected", () => {
    const gated = tree().commands.filter((command) => command.flags.gate !== undefined);

    expect(gated.map((command) => command.name)).toEqual(["index", "search", "read", "outline", "related"]);
  });

  it("requires the argument each verb cannot work without", () => {
    const args = Object.fromEntries(tree().commands.map((command) => [command.name, command.args]));

    expect(args.search).toEqual({ kind: "min", min: 1 });
    expect(args.read).toEqual({ kind: "exact", count: 1 });
    expect(args.outline).toEqual({ kind: "exact", count: 1 });
    expect(args.related).toEqual({ kind: "exact", count: 1 });
    expect(args.index).toEqual({ kind: "none" });
  });
});
