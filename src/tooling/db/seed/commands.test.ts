import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addCommand, createCommand } from "../../cli/command";
import { execute } from "../../cli/execute";
import type { CommandBase } from "../../cli/types";
import { sha256 } from "../digest";
import { argvHas, bufferedIO, fakeDbIo, jsonRows, minimalWranglerConfig, OK } from "../test-support";
import type { FakeDbIo, SeedRecord } from "../types";
import { createSeedCommands } from "./commands";

const USERS = "INSERT INTO users (email) VALUES ('ada@example.com');";
const POSTS = "INSERT INTO posts (title) VALUES ('hello');";

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-seed-commands-"));
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text);
  return root;
}

function seedIo(root: string, history: SeedRecord[] = []): FakeDbIo {
  const io = fakeDbIo({ [join(root, "seeds", "001_users.sql")]: USERS, [join(root, "seeds", "002_posts.sql")]: POSTS });
  io.rules.push({
    match: (args) => argvHas(args, "execute", "--json", "--command") && (args.at(-1) ?? "").includes("forge_seed_history"),
    reply: jsonRows(history.map((row) => ({ source: row.source, name: row.name, sha256: row.sha256, applied_at: row.appliedAt }))),
  });
  io.rules.push({ match: (args) => argvHas(args, "execute", "--json", "--command"), reply: jsonRows([]) });
  io.rules.push({ match: (args) => argvHas(args, "execute", "--yes"), reply: OK });
  return io;
}

function seedRoot(io: FakeDbIo): CommandBase {
  const root = createCommand({ name: "db", description: "database verbs" });
  for (const command of createSeedCommands({ io, host: { seeds: ["seeds"] } })) addCommand(root, command);
  return root;
}

async function run(io: FakeDbIo, argv: string[]): Promise<ReturnType<typeof bufferedIO>> {
  const cli = bufferedIO();
  try {
    await execute(seedRoot(io), argv, cli);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("exit ")) throw error;
  }
  return cli;
}

describe("createSeedCommands", () => {
  it("returns one seed command carrying apply, status and reset", () => {
    const commands = createSeedCommands();
    const seed = commands[0];

    expect(commands.length).toBe(1);
    expect(seed?.name).toBe("seed");
    expect(seed?.description).toBe("Apply name-keyed idempotent seed files, and read or clear what has run");
    expect(seed?.commands.map((command) => command.name)).toEqual(["apply", "status", "reset"]);
    expect(seed?.commands.map((command) => command.parent?.name)).toEqual(["seed", "seed", "seed"]);
  });

  it("gives apply --rerun and --allow-pending as two flags, with no --force", () => {
    const apply = createSeedCommands()[0]?.commands[0];

    expect(Object.keys(apply?.flags ?? {})).toEqual([
      "target",
      "db",
      "config",
      "env",
      "root",
      "json",
      "yes",
      "dir",
      "only",
      "rerun",
      "allow-pending",
      "allow-warnings",
      "no-bookmark",
    ]);
  });

  it("gives every subcommand the shared --root flag, so one context resolves them all", () => {
    const seed = createSeedCommands()[0];

    expect(seed?.commands.map((command) => Object.hasOwn(command.flags, "root"))).toEqual([true, true, true]);
  });
});

describe("db seed", () => {
  it("applies every pending seed under apply", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "apply", "--root", root]);

    expect(cli.err).toEqual([]);
    expect(cli.out).toEqual(["applied seeds:001_users", "applied seeds:002_posts", "2 applied, 0 already in"]);
    expect(cli.code).toBe(null);
  });

  it("applies from the bare verb too, which is `seed apply` under another name", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "--root", root]);

    expect(cli.err).toEqual([]);
    expect(cli.out).toEqual(["applied seeds:001_users", "applied seeds:002_posts", "2 applied, 0 already in"]);
    expect(cli.code).toBe(null);
  });

  it("reports every seed as pending under status, without loading one", async () => {
    const root = appRoot();
    const io = seedIo(root);
    const cli = await run(io, ["seed", "status", "--root", root]);

    expect(cli.err).toEqual([]);
    expect(cli.out).toEqual(["pending  seeds:001_users", "pending  seeds:002_posts"]);
    expect(io.calls.filter((call) => call.includes("--file"))).toEqual([]);
  });

  it("clears the history under reset when --yes says so", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "reset", "--root", root, "--yes"]);

    expect(cli.err).toEqual([]);
    expect(cli.out).toEqual(["seed history cleared — the rows the seeds wrote are untouched"]);
  });
});

describe("db seed status --check", () => {
  const applied = (name: string, hash: string): SeedRecord => ({ source: "seeds", name, sha256: hash, appliedAt: 1 });
  const allIn = [applied("001_users", sha256(USERS)), applied("002_posts", sha256(POSTS))];

  it("exits 1 while a seed is pending, after printing the lines", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "status", "--root", root, "--check"]);

    expect(cli.out).toEqual(["pending  seeds:001_users", "pending  seeds:002_posts"]);
    expect(cli.err.join("\n")).toContain("2 seed(s) pending or changed on app-db (local)");
    expect(cli.code).toBe(1);
  });

  it("exits 1 while a seed has changed since it ran", async () => {
    const root = appRoot();
    const history = [applied("001_users", "stale"), applied("002_posts", sha256(POSTS))];
    const cli = await run(seedIo(root, history), ["seed", "status", "--root", root, "--check"]);

    expect(cli.out).toEqual(["applied  seeds:002_posts", "changed  seeds:001_users"]);
    expect(cli.err.join("\n")).toContain("1 seed(s) pending or changed on app-db (local)");
    expect(cli.code).toBe(1);
  });

  it("exits 0 when every seed is already in", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root, allIn), ["seed", "status", "--root", root, "--check"]);

    expect(cli.out).toEqual(["applied  seeds:001_users", "applied  seeds:002_posts"]);
    expect(cli.err).toEqual([]);
    expect(cli.code).toBe(null);
  });

  it("prints the one JSON document before exiting 1 under --json", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "status", "--root", root, "--check", "--json"]);

    expect(cli.out.length).toBe(1);
    expect(JSON.parse(cli.out[0] ?? "")).toEqual({
      target: "local",
      database: "app-db",
      apply: ["seeds:001_users", "seeds:002_posts"],
      skip: [],
      changed: [],
      excluded: [],
    });
    expect(cli.code).toBe(1);
  });

  it("exits 0 under --json when nothing is outstanding", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root, allIn), ["seed", "status", "--root", root, "--check", "--json"]);

    expect(JSON.parse(cli.out[0] ?? "")).toEqual({
      target: "local",
      database: "app-db",
      apply: [],
      skip: ["seeds:001_users", "seeds:002_posts"],
      changed: [],
      excluded: [],
    });
    expect(cli.err).toEqual([]);
    expect(cli.code).toBe(null);
  });

  it("prints excluded rows on a deployed target and exits 0 on them", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "status", "--root", root, "--target", "remote", "--check"]);

    expect(cli.out).toEqual(["excluded seeds:001_users", "excluded seeds:002_posts"]);
    expect(cli.err).toEqual([]);
    expect(cli.code).toBe(null);
  });

  it("lists excluded seeds in the JSON document", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "status", "--root", root, "--target", "remote", "--check", "--json"]);

    expect(JSON.parse(cli.out[0] ?? "")).toEqual({
      target: "remote",
      database: "app-db",
      apply: [],
      skip: [],
      changed: [],
      excluded: ["seeds:001_users", "seeds:002_posts"],
    });
    expect(cli.code).toBe(null);
  });

  it("says nothing and exits 0 without --check, even with seeds pending", async () => {
    const root = appRoot();
    const cli = await run(seedIo(root), ["seed", "status", "--root", root]);

    expect(cli.err).toEqual([]);
    expect(cli.code).toBe(null);
  });
});
