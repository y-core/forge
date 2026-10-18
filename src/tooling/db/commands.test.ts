import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execute } from "../cli/execute";
import type { CommandBase } from "../cli/types";
import { createDbCommands } from "./commands";
import { bufferedIO, fakeDbIo, jsonRows, minimalWranglerConfig, OK } from "./db.fixture";
import type { FakeDbIo } from "./types";

const roots: string[] = [];

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-commands-"));
  roots.push(root);
  const { path, text } = minimalWranglerConfig(root);
  writeFileSync(path, text, "utf-8");
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const BOOKMARK = "00000085-0000027c-00004f1e-90dbd1f2b0a54cfd";

function timeTravelIo(): FakeDbIo {
  const io = fakeDbIo();
  io.rules.push({
    match: (args) => args.includes("time-travel") && args.includes("info"),
    reply: { code: 0, stdout: `🌀 Time travelling...\n{"bookmark":"${BOOKMARK}"}\n`, stderr: "" },
  });
  io.rules.push({
    match: (args) => args.includes("time-travel") && args.includes("restore"),
    reply: { code: 0, stdout: "⚠️ Restored\n", stderr: "" },
  });
  return io;
}

async function runDb(io: FakeDbIo, argv: string[]): Promise<ReturnType<typeof bufferedIO>> {
  const cli = bufferedIO();
  try {
    await execute(createDbCommands({ io }), argv, cli);
  } catch (thrown) {
    if ((thrown as Error).message !== "exit 1") throw thrown;
  }
  return cli;
}

function subcommand(tree: CommandBase, name: string): CommandBase | undefined {
  return tree.commands.find((c) => c.name === name);
}

describe("createDbCommands()", () => {
  it("mounts bookmark with the two Time Travel verbs under it", () => {
    const bookmark = subcommand(createDbCommands(), "bookmark");
    expect(bookmark?.commands.map((c) => c.name)).toEqual(["info", "restore"]);
  });
});

describe("a wrangler entry whose migrations_dir is not forge's directory", () => {
  for (const [what, entry] of [
    ["unset", {}],
    ["naming another directory", { migrations_dir: "migrations" }],
  ] as const) {
    it(`refuses every verb when migrations_dir is ${what}, naming the key, before wrangler is run`, async () => {
      const root = mkdtempSync(join(tmpdir(), "forge-db-commands-"));
      roots.push(root);
      const { path, text } = minimalWranglerConfig(root, {
        d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", ...entry }],
      });
      writeFileSync(path, text, "utf-8");
      const io = fakeDbIo();

      const cli = await runDb(io, ["migrate", "status", "--root", root]);

      expect(cli.code).toBe(1);
      expect(cli.err.join("\n")).toContain('set "migrations_dir": "config/db/migrations" on that entry');
      expect(io.calls).toEqual([]);
    });
  }
});

describe("forge db standby reset", () => {
  it("defaults --target to standby, so the bare verb builds the second database", () => {
    const reset = subcommand(subcommand(createDbCommands(), "standby") as CommandBase, "reset");
    const target = reset?.flags?.target;
    expect(target?.type === "string" ? target.default : null).toBe("standby");
  });

  it("prints one JSON document naming the standby database it rebuilt", async () => {
    const root = appRoot();
    const io = fakeDbIo();
    io.rules.push(
      {
        match: (args) => args.includes("--json") && (args.at(-1) ?? "").includes("_forge_migrations"),
        reply: { code: 1, stdout: "", stderr: "no such table: _forge_migrations" },
      },
      { match: (args) => args.includes("--json"), reply: jsonRows([]) },
      { match: (args) => args.includes("--yes"), reply: OK },
    );

    const cli = await runDb(io, ["standby", "reset", "--root", root, "--no-seed", "--yes", "--json"]);

    expect(cli.out).toEqual([`{"target":"standby","database":"app-db-standby","applied":[],"seeded":[],"excluded":[]}`]);
  });
});

describe("forge db standby reset --no-lint", () => {
  it("rejects the flag, before anything is removed or run", async () => {
    const io = fakeDbIo();
    const cli = await runDb(io, ["standby", "reset", "--root", appRoot(), "--yes", "--no-lint"]);
    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain("Unknown flag: --no-lint.");
    expect([io.calls, io.d1Calls]).toEqual([[], []]);
  });
});

describe("forge db bookmark info", () => {
  it("prints the bookmark and the restore command as one JSON line on stdout", async () => {
    const io = timeTravelIo();
    const root = appRoot();
    const cli = await runDb(io, ["bookmark", "info", "--target", "remote", "--root", root, "--json"]);
    expect(cli.out).toEqual([
      `{"target":"remote","database":"app-db","bookmark":"${BOOKMARK}","restoreCommand":"forge db bookmark restore --target remote --bookmark ${BOOKMARK} --root '${root}' --config '${join(root, "wrangler.jsonc")}' --db 'DB'"}`,
    ]);
    expect(cli.err).toEqual([]);
  });

  it("prints a two-line report when --json was not asked for", async () => {
    const root = appRoot();
    const cli = await runDb(timeTravelIo(), ["bookmark", "info", "--target", "remote", "--root", root]);
    expect(cli.out).toEqual([
      `bookmark ${BOOKMARK}\nrestore with: forge db bookmark restore --target remote --bookmark ${BOOKMARK} --root '${root}' --config '${join(root, "wrangler.jsonc")}' --db 'DB'`,
    ]);
  });

  it("forwards --timestamp to wrangler", async () => {
    const io = timeTravelIo();
    await runDb(io, ["bookmark", "info", "--target", "remote", "--root", appRoot(), "--timestamp", "2026-09-01T00:00:00Z"]);
    expect(io.calls[0]?.slice(-2)).toEqual(["--timestamp", "2026-09-01T00:00:00Z"]);
  });

  it("refuses a local target, because a local database has no Time Travel", async () => {
    const cli = await runDb(timeTravelIo(), ["bookmark", "info", "--root", appRoot()]);
    expect(cli.err).toEqual([
      "Error: Time Travel is a property of a deployed database — --target local has none. Undo a local change with `forge db reset` and `forge db restore`.",
    ]);
    expect([cli.out, cli.code]).toEqual([[], 1]);
  });
});

describe("forge db bookmark restore", () => {
  it("refuses when neither --bookmark nor --timestamp names the point", async () => {
    const io = timeTravelIo();
    const cli = await runDb(io, ["bookmark", "restore", "--target", "remote", "--root", appRoot(), "--yes"]);
    expect(cli.err).toEqual(["Error: Name the point to return to with exactly one of --bookmark or --timestamp."]);
    expect([cli.code, io.calls]).toEqual([1, []]);
  });

  it("refuses when both name it, rather than silently preferring one", async () => {
    const io = timeTravelIo();
    const cli = await runDb(io, [
      "bookmark",
      "restore",
      "--target",
      "remote",
      "--root",
      appRoot(),
      "--yes",
      "--bookmark",
      BOOKMARK,
      "--timestamp",
      "2026-09-01T00:00:00Z",
    ]);
    expect(cli.err).toEqual(["Error: Name the point to return to with exactly one of --bookmark or --timestamp."]);
    expect([cli.code, io.calls]).toEqual([1, []]);
  });

  it("restores to a bookmark once --yes stands in for the confirmation", async () => {
    const io = timeTravelIo();
    const root = appRoot();
    const cli = await runDb(io, ["bookmark", "restore", "--target", "remote", "--root", root, "--bookmark", BOOKMARK, "--yes", "--json"]);
    expect(cli.out).toEqual([`{"target":"remote","database":"app-db","restored":{"bookmark":"${BOOKMARK}"}}`]);
    expect(io.calls[0]).toEqual(["wrangler", "d1", "time-travel", "restore", "app-db", "-c", join(root, "wrangler.jsonc"), "--bookmark", BOOKMARK]);
  });

  it("restores to a timestamp when that is the point named", async () => {
    const io = timeTravelIo();
    const cli = await runDb(io, [
      "bookmark",
      "restore",
      "--target",
      "remote",
      "--root",
      appRoot(),
      "--timestamp",
      "2026-09-01T00:00:00Z",
      "--yes",
      "--json",
    ]);
    expect(cli.out).toEqual(['{"target":"remote","database":"app-db","restored":{"timestamp":"2026-09-01T00:00:00Z"}}']);
    expect(io.calls[0]?.slice(-2)).toEqual(["--timestamp", "2026-09-01T00:00:00Z"]);
  });

  it("prints what wrangler said when --json was not asked for", async () => {
    const cli = await runDb(timeTravelIo(), ["bookmark", "restore", "--target", "remote", "--root", appRoot(), "--bookmark", BOOKMARK, "--yes"]);
    expect(cli.out).toEqual(["⚠️ Restored"]);
  });

  it("refuses to restore without --yes when there is no terminal to confirm at", async () => {
    const io = timeTravelIo();
    const cli = await runDb(io, ["bookmark", "restore", "--target", "remote", "--root", appRoot(), "--bookmark", BOOKMARK]);
    expect(cli.err).toEqual([
      `Error: Refusing to restore app-db (remote) to ${BOOKMARK} without a terminal to confirm at.\n` +
        "Every write since that point is discarded. Capture the current point first with `forge db bookmark info` if you may want it back. Pass --yes to say so deliberately.",
    ]);
    expect([cli.code, io.calls]).toEqual([1, []]);
  });
});

describe("the README's script table", () => {
  const table = readFileSync(join(import.meta.dir, "README.md"), "utf-8")
    .split("\n")
    .filter((line) => /^\| `(dev|deploy|db:[^`]+)` \|/.test(line));
  const commands = table.map((line) => (/^\| `[^`]+` \| `([^`]+)`/.exec(line)?.[1] ?? "").split("&&")[0]?.trim() ?? "");

  it("lists the lifecycle every app runs: the dev hook, status, lint, both migrates, deploy, backup, restore and reset", () => {
    const scripts = table.map((line) => /^\| `([^`]+)`/.exec(line)?.[1]);
    for (const script of ["dev", "db:status", "db:lint", "db:migrate", "db:migrate:remote", "deploy", "db:backup", "db:restore", "db:reset"]) {
      expect(scripts).toContain(script);
    }
  });

  /** The verb a row's command resolves to, and the flags it passes. */
  function resolveRow(command: string): { verb: CommandBase | undefined; words: string[]; flags: string[] } {
    const rest = command.split(" ").slice(2);
    const first = rest.findIndex((word) => word.startsWith("-"));
    const words = first === -1 ? rest : rest.slice(0, first);
    let verb: CommandBase | undefined = createDbCommands();
    for (const word of words) verb = verb?.commands.find((c) => c.name === word);
    return { verb, words, flags: rest.filter((word) => word.startsWith("-")) };
  }

  for (const command of commands) {
    it(`names \`${command}\`, a verb in the forge db tree with every flag it passes`, () => {
      const { verb, words, flags } = resolveRow(command);
      expect(command.startsWith("forge db ")).toBe(true);
      expect(verb?.name).toBe(words.at(-1) ?? "db");
      const declared = new Set(
        Object.entries(verb?.flags ?? {}).flatMap(([name, def]) => [`--${name}`, ...(def.short === undefined ? [] : [`-${def.short}`])]),
      );
      expect(flags.filter((flag) => !declared.has(flag))).toEqual([]);
    });
  }
});
