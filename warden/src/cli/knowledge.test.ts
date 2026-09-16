import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCommand } from "../../../src/tooling/cli/command";
import { CliError } from "../../../src/tooling/cli/errors";
import { execute } from "../../../src/tooling/cli/execute";
import type { CallableCommand, CliIO, CommandBase } from "../../../src/tooling/cli/types";
import { createCatalogueCommand, createKnowledgeCommands, createServeCommand } from "./knowledge";

function tree(): CommandBase {
  const root = createCommand({ name: "warden" });
  createKnowledgeCommands(root);
  createCatalogueCommand(root);
  createServeCommand(root);
  return root;
}

function catalogueCommand(): CallableCommand {
  const found = tree().commands.find((command) => command.name === "catalogue");
  if (found === undefined) throw new Error("the catalogue command is not mounted");
  return found as CallableCommand;
}

function repoAt(...segments: string[]): string {
  const root = join(mkdtempSync(join(tmpdir(), "warden-catalogue-")), ...segments);
  mkdirSync(join(root, "warden"), { recursive: true });
  return root;
}

async function dispatch(...argv: string[]): Promise<{ err: string[]; code: number | null }> {
  const err: string[] = [];
  let code: number | null = null;
  const io: CliIO = {
    stdout: () => {},
    stderr: (message) => err.push(message),
    exit: ((status: number) => {
      code = status;
    }) as CliIO["exit"],
  };
  await execute(tree(), argv, io);
  return { err, code };
}

describe("the knowledge commands", () => {
  it("refuses a bare `search`, rather than ranking the corpus against an empty query", async () => {
    const { err, code } = await dispatch("search");

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("requires at least 1 argument(s), got 0");
  });

  it("refuses `read` with no id and with two, since a section is named by exactly one", async () => {
    expect((await dispatch("read")).code).toBe(1);
    expect((await dispatch("read", "one", "two")).code).toBe(1);
    expect((await dispatch("outline")).code).toBe(1);
    expect((await dispatch("related")).code).toBe(1);
  });

  it("gives every one a --root, so no command has to discover the repository", () => {
    for (const command of tree().commands) expect(command.flags.root).toBeDefined();
  });

  it("lets a caller name the canon tree rather than relying on package.json", () => {
    for (const command of tree().commands) expect(command.flags.kind).toBeDefined();
  });

  it("gives the commands that read an index a --gate flag, so the gate's own can be inspected", () => {
    const gated = tree().commands.filter((command) => command.flags.gate !== undefined);

    expect(gated.map((command) => command.name)).toEqual(["index", "search", "read", "outline", "related", "impact"]);
  });
});

describe("warden catalogue --write", () => {
  it("writes into the repository `--root` names, not into the installed package", async () => {
    const root = repoAt("consumer");

    await catalogueCommand().run?.([], { root, kind: "libs", write: true });

    expect(existsSync(join(root, "warden/CATALOGUE.md"))).toBe(true);
    expect(readFileSync(join(root, "warden/CATALOGUE.md"), "utf-8")).toContain("# Catalogue");
  });

  // The defect this guards: resolving against the library's own root wrote a consumer's catalogue
  // into their dependency, and the failing gate's remedy was the command that did it.
  it("refuses a target inside node_modules rather than mutating a dependency", () => {
    const root = repoAt("node_modules", "@y-core", "forge");

    expect(() => {
      void catalogueCommand().run?.([], { root, kind: "libs", write: true });
    }).toThrow(CliError);
    expect(existsSync(join(root, "warden/CATALOGUE.md"))).toBe(false);
  });
});
