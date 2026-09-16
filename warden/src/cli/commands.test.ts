import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { createCommand } from "../../../src/tooling/cli/command";
import { execute } from "../../../src/tooling/cli/execute";
import type { CliIO } from "../../../src/tooling/cli/types";
import { CLAUDE_ROOT } from "../paths";
import { syncTrees, walk } from "../sync/sync";
import { createWardenCommands } from "./commands";
import { createCatalogueCommand, createKnowledgeCommands, createServeCommand } from "./knowledge";

interface Dispatch {
  readonly out: string[];
  readonly err: string[];
  readonly code: number | null;
}

async function warden(...argv: string[]): Promise<Dispatch> {
  const out: string[] = [];
  const err: string[] = [];
  let code: number | null = null;
  const io: CliIO = {
    stdout: (message) => out.push(message),
    stderr: (message) => err.push(message),
    exit: ((status: number) => {
      code = status;
    }) as CliIO["exit"],
  };
  const { log, error } = console;
  console.log = (...parts: unknown[]) => out.push(parts.join(" "));
  console.error = (...parts: unknown[]) => err.push(parts.join(" "));
  try {
    await execute(createWardenCommands(), argv, io);
  } finally {
    console.log = log;
    console.error = error;
  }
  return { out, err, code };
}

function emptyRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "warden-cli-"));
  mkdirSync(join(root, "warden"), { recursive: true });
  return root;
}

/** Every agent the corpus ships for `kind`, by the name `CLAUDE.md` has to name it under. */
function agentNames(kind: "libs" | "apps"): string[] {
  return shipped(kind)
    .filter((file) => file.startsWith(".claude/agents/"))
    .map((file) => basename(file, ".md"))
    .sort();
}

/** A repository synced and carrying the agent roster `CLAUDE.md` owes the corpus. */
async function syncedRepo(kind: "libs" | "apps" = "libs"): Promise<string> {
  const root = emptyRepo();
  await warden("sync", "--root", root, "--kind", kind);
  writeFileSync(
    join(root, "CLAUDE.md"),
    agentNames(kind)
      .map((name) => `- \`${name}\`\n`)
      .join(""),
  );
  return root;
}

/** Every file the corpus would place under `.claude/`, as `tree/relative-path`. */
function shipped(kind: "libs" | "apps"): string[] {
  return syncTrees(CLAUDE_ROOT, kind)
    .flatMap(({ tree, from }) => from.flatMap((source) => walk(source).map((file) => `${tree}/${file}`)))
    .sort();
}

describe("warden sync", () => {
  it("places every file the corpus ships for the named kind, and says which trees it wrote", async () => {
    const root = emptyRepo();

    const { out, code } = await warden("sync", "--root", root, "--kind", "libs");

    expect(code).toBeNull();
    expect(shipped("libs").filter((file) => !existsSync(join(root, file)))).toEqual([]);
    expect(out.at(-1)).toBe("✓ warden synced — libs");
  });

  it("defaults an undeclared repository to apps and says so, rather than giving it a tree it never asked for", async () => {
    const root = emptyRepo();

    const { out } = await warden("sync", "--root", root);

    expect(out.some((line) => line.includes("no `warden.kind` in package.json"))).toBe(true);
    expect(out.at(-1)).toBe("✓ warden synced — apps");
    expect(shipped("apps").filter((file) => !existsSync(join(root, file)))).toEqual([]);
  });

  it("reports a synced repository whose CLAUDE.md names every agent as in step", async () => {
    const root = await syncedRepo();

    const { out, code } = await warden("sync", "--check", "--root", root, "--kind", "libs");

    expect(code).toBeNull();
    expect(out.at(-1)).toBe("✓ warden in sync — libs");
  });

  it("reports an agent CLAUDE.md never names, because the roster is reconciled in both directions", async () => {
    const root = await syncedRepo();
    const [unnamed, ...named] = agentNames("libs");
    writeFileSync(join(root, "CLAUDE.md"), named.map((name) => `- \`${name}\`\n`).join(""));

    const { err, code } = await warden("sync", "--check", "--root", root, "--kind", "libs");

    expect(code).toBe(1);
    expect(err.some((line) => line.includes("unnamed") && line.includes(unnamed as string))).toBe(true);
  });

  it("names the edited file as drift and exits 1, so a hand-edited agent cannot pass the gate", async () => {
    const root = await syncedRepo();
    const edited = shipped("libs")[0] as string;
    writeFileSync(join(root, edited), "local edit\n");

    const { err, code } = await warden("sync", "--check", "--root", root, "--kind", "libs");

    expect(code).toBe(1);
    expect(err.some((line) => line.includes("modified") && line.includes(edited.split("/").slice(1).join("/")))).toBe(true);
  });

  it("restores that file on the next sync, which is what makes the trees overwrite-on-sync", async () => {
    const root = await syncedRepo();
    const edited = shipped("libs")[0] as string;
    writeFileSync(join(root, edited), "local edit\n");

    await warden("sync", "--root", root, "--kind", "libs");

    expect(readFileSync(join(root, edited), "utf-8")).not.toBe("local edit\n");
  });

  it("seeds the repository's own files only under --init, and never as part of a plain sync", async () => {
    const plain = emptyRepo();
    await warden("sync", "--root", plain, "--kind", "libs");
    const seeded = emptyRepo();

    await warden("sync", "--init", "--root", seeded, "--kind", "libs");

    expect(existsSync(join(plain, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(seeded, "CLAUDE.md"))).toBe(true);
  });
});

describe("warden — dispatch", () => {
  it("refuses `show` with no subject, naming the subjects it does carry", async () => {
    const { err, code } = await warden("show");

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--zed");
  });

  it("suggests the nearest verb for a mistyped one rather than reprinting the tree", async () => {
    const { err, code } = await warden("syncc");

    expect(code).toBe(1);
    expect(err.join("\n")).toContain('Did you mean "sync"?');
  });

  it("mounts the knowledge verbs from their own builder, so the two orders cannot drift apart", () => {
    const bare = createCommand({ name: "warden" });
    createKnowledgeCommands(bare);
    createCatalogueCommand(bare);
    createServeCommand(bare);
    const knowledge = bare.commands.map((command) => command.name);

    const mounted = createWardenCommands().commands.map((command) => command.name);
    expect(mounted.slice(mounted.length - knowledge.length)).toEqual(knowledge);
  });

  it("declares --root once and shares it, so no verb can describe the same flag differently", () => {
    const commands = createWardenCommands().commands.filter((command) => command.name !== "show");
    const [first] = commands.map((command) => command.flags.root);

    expect(first).toBeDefined();
    expect(commands.every((command) => command.flags.root === first)).toBe(true);
  });

  it("gives `show` no --root, because it writes a shipped example rather than reading a repository", () => {
    expect(createWardenCommands().commands.find((command) => command.name === "show")?.flags.root).toBeUndefined();
  });
});
