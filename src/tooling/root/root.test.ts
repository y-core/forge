import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRootCommand } from "./root";

// `verify` and `release` are bare verbs whose object is the repository; `cf` and `assets` are
// domain nouns under which the verb and object are both named. That split is the tree's whole rule.
const FIRST_PARTY = ["verify", "release", "cf", "assets"];
const KERNEL = resolve(import.meta.dir, "../cli/command.ts");

/** A throwaway project root, optionally carrying a `config/commands.ts` declaring one command. */
function project(name: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "forge-root-"));
  if (name !== null) {
    mkdirSync(join(root, "config"));
    const source = `import { createCommand } from "${KERNEL}";\nexport default [createCommand({ name: "${name}" })];\n`;
    writeFileSync(join(root, "config/commands.ts"), source, "utf-8");
  }
  return root;
}

describe("createRootCommand()", () => {
  it("attaches every first-party command, since the binary is the only entry point they now have", async () => {
    const root = await createRootCommand(project(null));

    expect(root.commands.map((c) => c.name)).toEqual(FIRST_PARTY);
  });

  it("is named for the binary, because the name is what --help prints", async () => {
    expect((await createRootCommand(project(null))).name).toBe("forge");
  });

  it("appends an app's own commands, so `forge <name>` runs them", async () => {
    const root = await createRootCommand(project("greet"));

    expect(root.commands.map((c) => c.name)).toEqual([...FIRST_PARTY, "greet"]);
  });

  // Shadowing `verify` would silently replace the gate, which is the one command a repository most
  // needs to be the one forge shipped.
  it("refuses an app command that collides with a first-party name rather than shadowing it", async () => {
    await expect(createRootCommand(project("verify"))).rejects.toThrow('Duplicate command name: "verify"');
  });
});
