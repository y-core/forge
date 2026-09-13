import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INVENTORY_SELECT } from "../../../storage/db/schema";
import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import { sha256 } from "../digest";
import { RECORDED_CHECKSUM_SELECT } from "../migrate/checksum";
import { schemaFingerprint } from "../migrate/fingerprint";
import { argvHas, bufferedIO, fakeDbIo, jsonRows, minimalWranglerConfig, OK } from "../test-support";
import type { FakeDbIo, SeedRecord } from "../types";

const USERS = "INSERT INTO users (email) VALUES ('${ADMIN:-admin@example.com}');";
const POSTS = "INSERT INTO posts (title) VALUES ('hello');";

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-seed-"));
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text, "utf-8");
  return root;
}

const isColumns = (args: readonly string[]) => argvHas(args, "execute", "--json", "--command") && (args.at(-1) ?? "").includes("pragma_table_info");

function seedIo(root: string, history: SeedRecord[], files: Record<string, string> = { "001_users.sql": USERS, "002_posts.sql": POSTS }): FakeDbIo {
  const seeded: Record<string, string> = {};
  for (const [name, sql] of Object.entries(files)) seeded[join(root, "seeds", name)] = sql;
  const io = fakeDbIo(seeded, { now: new Date("2026-09-11T10:00:00Z") });
  io.rules.push({ match: isColumns, reply: jsonRows([{ name: "source" }, { name: "name" }]) });
  io.rules.push({
    match: (args) => argvHas(args, "execute", "--json", "--command"),
    reply: jsonRows(history.map((row) => ({ source: row.source, name: row.name, sha256: row.sha256, applied_at: row.appliedAt }))),
  });
  io.rules.push({ match: (args) => argvHas(args, "execute", "--yes"), reply: OK });
  return io;
}

/** One history row for the one seeds directory `config/db.ts` declares. */
function record(name: string, hash: string): SeedRecord {
  return { source: "seeds", name, sha256: hash, appliedAt: 1 };
}

const SECRET_SEED = "INSERT INTO users (email) VALUES ('${SECRET}');";

/** What each `--file` load read from the scratch file at the moment it ran, since the file is gone afterwards. */
function recordLoads(io: FakeDbIo): (string | undefined)[] {
  const loaded: (string | undefined)[] = [];
  io.rules.unshift({
    match: (args) => args.includes("--file"),
    reply: (args) => {
      loaded.push(io.files.get(args[args.indexOf("--file") + 1] ?? ""));
      return OK;
    },
  });
  return loaded;
}

/** The statements the run sent with `--command`, and the files it sent with `--file`. */
function sent(io: FakeDbIo, flag: "--command" | "--file"): string[] {
  return io.calls.filter((call) => call.includes(flag)).map((call) => call[call.indexOf(flag) + 1] ?? "");
}

async function run(io: FakeDbIo, argv: string[]): Promise<ReturnType<typeof bufferedIO>> {
  const cli = bufferedIO();
  try {
    await execute(createDbCommands({ io, host: { seeds: ["seeds"] } }), argv, cli);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("exit ")) throw err;
  }
  return cli;
}

describe("db seed apply", () => {
  it("loads each pending seed from a scratch file, records it with its raw hash, and leaves no expanded text behind", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    const loaded = recordLoads(io);
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(null);
    expect(sent(io, "--file")).toEqual([
      join(root, ".forge", "scratch", "seed", "seeds", "001_users.sql"),
      join(root, ".forge", "scratch", "seed", "seeds", "002_posts.sql"),
    ]);
    expect(loaded).toEqual([
      `INSERT INTO users (email) VALUES ('admin@example.com');\nINSERT OR REPLACE INTO _forge_seed_history (source, name, sha256, applied_at) VALUES ('seeds', '001_users', '${sha256(USERS)}', 1789120800000);`,
      `${POSTS}\nINSERT OR REPLACE INTO _forge_seed_history (source, name, sha256, applied_at) VALUES ('seeds', '002_posts', '${sha256(POSTS)}', 1789120800000);`,
    ]);
    expect([...io.files.keys()].filter((path) => path.includes("/.forge/scratch/seed/"))).toEqual([]);
    expect(sent(io, "--command").filter((command) => command.startsWith("INSERT"))).toEqual([]);
    expect(cli.out).toEqual(["applied seeds:001_users", "applied seeds:002_posts", "2 applied, 0 already in"]);
  });

  it("skips a seed already recorded with the same hash", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_users", sha256(USERS)), record("002_posts", sha256(POSTS))]);
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(sent(io, "--file")).toEqual([]);
    expect(cli.out).toEqual(["0 applied, 2 already in"]);
  });

  it("refuses a seed whose file changed since it ran, after applying the others, and exits 1", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_users", "stale")]);
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(sent(io, "--file")).toEqual([join(root, ".forge", "scratch", "seed", "seeds", "002_posts.sql")]);
    expect(cli.out).toEqual(["changed seeds:001_users — applied before and edited since; re-run it with --rerun --only seeds:001_users"]);
    expect(cli.err.join("\n")).toContain(
      "1 seed(s) changed since they were applied and were not run. Re-run each with --rerun --only <dir>:<name>.",
    );
    expect(cli.code).toBe(1);
  });

  it("re-applies just the changed seed under --rerun --only, leaving the other alone", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_users", "stale"), record("002_posts", sha256(POSTS))]);
    const cli = await run(io, ["seed", "apply", "--root", root, "--rerun", "--only", "001_users"]);

    expect(cli.code).toBe(null);
    expect(sent(io, "--file")).toEqual([join(root, ".forge", "scratch", "seed", "seeds", "001_users.sql")]);
    expect(cli.out).toEqual(["applied seeds:001_users", "1 applied, 0 already in"]);
  });

  it("re-applies every selected seed under --rerun without --only", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_users", "stale"), record("002_posts", sha256(POSTS))]);
    const cli = await run(io, ["seed", "apply", "--root", root, "--rerun"]);

    expect(cli.code).toBe(null);
    expect(sent(io, "--file")).toEqual([
      join(root, ".forge", "scratch", "seed", "seeds", "001_users.sql"),
      join(root, ".forge", "scratch", "seed", "seeds", "002_posts.sql"),
    ]);
    expect(cli.out).toEqual(["applied seeds:001_users", "applied seeds:002_posts", "2 applied, 0 already in"]);
  });

  it("runs just the named seed, expands the environment into the file it loads, and removes that file after", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    (io as { env: Record<string, string | undefined> }).env = { ADMIN: "ada@example.com" };
    const file = join(root, ".forge", "scratch", "seed", "seeds", "001_users.sql");
    const loaded = recordLoads(io);
    const cli = await run(io, ["seed", "apply", "--root", root, "--only", "001_users"]);

    expect(cli.code).toBe(null);
    expect(sent(io, "--file")).toEqual([file]);
    expect(loaded).toEqual([
      `INSERT INTO users (email) VALUES ('ada@example.com');\nINSERT OR REPLACE INTO _forge_seed_history (source, name, sha256, applied_at) VALUES ('seeds', '001_users', '${sha256(USERS)}', 1789120800000);`,
    ]);
    expect(io.files.has(file)).toBe(false);
  });

  it("refuses an unset variable with no default before any seed is loaded, naming it", async () => {
    const root = appRoot();
    const io = seedIo(root, [], { "001_posts.sql": POSTS, "002_admin.sql": SECRET_SEED });
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(1);
    expect(cli.err).toEqual(["Error: SECRET is not set and the seed gives it no default — export it, or write ${SECRET:-default} in the file"]);
    expect(sent(io, "--file")).toEqual([]);
  });

  it("refuses an unknown --only, naming the seeds there are", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    const cli = await run(io, ["seed", "apply", "--root", root, "--only", "003_nope"]);

    expect(cli.err.join("\n")).toContain('No seed named "003_nope" — available: seeds:001_users, seeds:002_posts');
    expect(cli.code).toBe(1);
    expect(sent(io, "--file")).toEqual([]);
  });

  it("prints one JSON document and nothing else under --json", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_users", sha256(USERS))]);
    const cli = await run(io, ["seed", "apply", "--root", root, "--json"]);

    expect(cli.out.length).toBe(1);
    expect(JSON.parse(cli.out[0] ?? "")).toEqual({
      target: "local",
      database: "app-db",
      applied: ["seeds:002_posts"],
      skipped: ["seeds:001_users"],
      changed: [],
      excluded: [],
    });
  });
});

describe("db seed apply --target remote", () => {
  const REMOTE_USERS = "-- forge:places remote\nINSERT OR IGNORE INTO users (email) VALUES ('ops@example.com');";
  const REMOTE_BARE = "-- forge:places remote\nINSERT INTO users (email) VALUES ('ops@example.com');";
  const withTimeTravel = (io: FakeDbIo): FakeDbIo => {
    io.rules.unshift({ match: (args) => argvHas(args, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } });
    return io;
  };
  const timeTravelCalls = (io: FakeDbIo) => io.calls.filter((call) => argvHas(call.slice(1), "time-travel", "info"));

  it("refuses without --yes and no terminal, before touching the database", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_ops.sql": REMOTE_USERS }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote"]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain(
      "Refusing to seed app-db (remote) without a terminal to confirm at: seeds:001_ops.\nSeeds are ordinary SQL against a deployed database; the undo is `forge db bookmark restore`. Pass --yes to say so deliberately.",
    );
    expect(sent(io, "--file")).toEqual([]);
    expect(timeTravelCalls(io)).toEqual([]);
  });

  it("captures a Time Travel bookmark before the first seed under --yes, and prints the undo", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_ops.sql": REMOTE_USERS }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes"]);

    expect(cli.code).toBe(null);
    expect(timeTravelCalls(io).length).toBe(1);
    const order = io.calls.map((call) => (argvHas(call.slice(1), "time-travel", "info") ? "bookmark" : call.includes("--file") ? "seed" : "other"));
    expect(order.indexOf("bookmark")).toBeLessThan(order.indexOf("seed"));
    expect(cli.out).toEqual([
      `undo: forge db bookmark restore --target remote --bookmark bm-1 --root ${root} --config ${join(root, "wrangler.jsonc")} --db DB`,
      "applied seeds:001_ops",
      "1 applied, 0 already in",
    ]);
  });

  it("lists a seed with no places line as excluded, with the line that includes it", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_ops.sql": REMOTE_USERS, "002_dev.sql": POSTS }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes", "--json"]);

    expect(io.logs).toEqual([
      "excluded from remote: seeds:002_dev — add `-- forge:places remote` on line 1 to include it",
      `undo: forge db bookmark restore --target remote --bookmark bm-1 --root ${root} --config ${join(root, "wrangler.jsonc")} --db DB`,
    ]);
    expect(sent(io, "--file")).toEqual([join(root, ".forge", "scratch", "seed", "seeds", "001_ops.sql")]);
    expect(JSON.parse(cli.out[0] ?? "")).toEqual({
      target: "remote",
      database: "app-db",
      applied: ["seeds:001_ops"],
      skipped: [],
      changed: [],
      excluded: ["seeds:002_dev"],
      bookmark: {
        bookmark: "bm-1",
        restoreCommand: `forge db bookmark restore --target remote --bookmark bm-1 --root ${root} --config ${join(root, "wrangler.jsonc")} --db DB`,
      },
    });
  });

  it("prints the excluded seed in the human report", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_ops.sql": REMOTE_USERS, "002_dev.sql": POSTS }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes"]);

    expect(cli.out).toEqual([
      `undo: forge db bookmark restore --target remote --bookmark bm-1 --root ${root} --config ${join(root, "wrangler.jsonc")} --db DB`,
      "excluded seeds:002_dev",
      "applied seeds:001_ops",
      "1 applied, 0 already in",
    ]);
  });

  it("refuses a lint warning against a deployed database until --allow-warnings says so", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_bare.sql": REMOTE_BARE }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes"]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain(
      `1 lint warning(s) against remote. Read them, then pass --allow-warnings to seed anyway:\nwarning ${join(root, "seeds", "001_bare.sql")}:2 seed-insert-not-idempotent — INSERT without OR IGNORE, OR REPLACE or ON CONFLICT is not safe to run twice — a re-run duplicates the row or fails on its key`,
    );
    expect(sent(io, "--file")).toEqual([]);
    expect(timeTravelCalls(io)).toEqual([]);

    const allowed = withTimeTravel(seedIo(root, [], { "001_bare.sql": REMOTE_BARE }));
    const ok = await run(allowed, ["seed", "apply", "--root", root, "--target", "remote", "--yes", "--allow-warnings"]);

    expect(ok.code).toBe(null);
    expect(allowed.logs).toEqual([
      `warning ${join(root, "seeds", "001_bare.sql")}:2 seed-insert-not-idempotent — INSERT without OR IGNORE, OR REPLACE or ON CONFLICT is not safe to run twice — a re-run duplicates the row or fails on its key`,
    ]);
    expect(sent(allowed, "--file")).toEqual([join(root, ".forge", "scratch", "seed", "seeds", "001_bare.sql")]);
  });

  it("refuses an unbounded DELETE against a deployed database until --allow-warnings says so", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_wipe.sql": "-- forge:places remote\nDELETE FROM users;" }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes"]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain(
      `1 lint warning(s) against remote. Read them, then pass --allow-warnings to seed anyway:\nwarning ${join(root, "seeds", "001_wipe.sql")}:2 unbounded-delete — DELETE with no WHERE empties the table`,
    );
    expect(sent(io, "--file")).toEqual([]);

    const allowed = withTimeTravel(seedIo(root, [], { "001_wipe.sql": "-- forge:places remote\nDELETE FROM users;" }));
    const ok = await run(allowed, ["seed", "apply", "--root", root, "--target", "remote", "--yes", "--allow-warnings"]);

    expect(ok.code).toBe(null);
    expect(sent(allowed, "--file")).toEqual([join(root, ".forge", "scratch", "seed", "seeds", "001_wipe.sql")]);
  });

  it("refuses an unbounded UPDATE the environment expands into, which the seed as written does not show", async () => {
    const root = appRoot();
    const scoped = "-- forge:places remote\nUPDATE users SET active = 1 ${SCOPE:-WHERE id = 1};";
    const io = withTimeTravel(seedIo(root, [], { "001_scope.sql": scoped }));
    (io as { env: Record<string, string | undefined> }).env = { SCOPE: "" };
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes"]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain(
      `1 lint warning(s) against remote. Read them, then pass --allow-warnings to seed anyway:\nwarning ${join(root, "seeds", "001_scope.sql")}:2 unbounded-update — UPDATE with no WHERE rewrites every row in the table`,
    );
    expect(sent(io, "--file")).toEqual([]);
    expect(timeTravelCalls(io)).toEqual([]);
  });

  it("skips the bookmark under --no-bookmark", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_ops.sql": REMOTE_USERS }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes", "--no-bookmark"]);

    expect(cli.code).toBe(null);
    expect(timeTravelCalls(io)).toEqual([]);
    expect(cli.out).toEqual(["applied seeds:001_ops", "1 applied, 0 already in"]);
  });

  it("asks nothing and captures nothing when every seed is already in", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [record("001_ops", sha256(REMOTE_USERS))], { "001_ops.sql": REMOTE_USERS }));
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote"]);

    expect(cli.code).toBe(null);
    expect(timeTravelCalls(io)).toEqual([]);
    expect(cli.out).toEqual(["0 applied, 1 already in"]);
  });

  it("names the undo when a seed fails part-way", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, [], { "001_ops.sql": REMOTE_USERS }));
    io.rules.unshift({ match: (args) => args.includes("--file"), reply: { code: 1, stdout: "", stderr: "boom" } });
    const cli = await run(io, ["seed", "apply", "--root", root, "--target", "remote", "--yes"]);

    expect(cli.code).toBe(1);
    expect(cli.out).toEqual([
      `undo: forge db bookmark restore --target remote --bookmark bm-1 --root ${root} --config ${join(root, "wrangler.jsonc")} --db DB`,
      `the database may be part-seeded — undo with: forge db bookmark restore --target remote --bookmark bm-1 --root ${root} --config ${join(root, "wrangler.jsonc")} --db DB`,
    ]);
  });

  it("still asks nothing and bookmarks nothing on local", async () => {
    const root = appRoot();
    const io = withTimeTravel(seedIo(root, []));
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(null);
    expect(timeTravelCalls(io)).toEqual([]);
    expect(cli.out).toEqual(["applied seeds:001_users", "applied seeds:002_posts", "2 applied, 0 already in"]);
  });
});

describe("db seed apply with a migration pending", () => {
  const INIT = "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;";

  it("refuses to seed an older schema, naming the pending migration and the way past it", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    io.files.set(join(root, "migrations", "0001_init.sql"), INIT);
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain("pending migration(s)");
    expect(cli.err.join("\n")).toContain(
      "app-db (local) has 1 pending migration(s): 0001_init. Run `forge db migrate` first, or pass --allow-pending to seed the older schema anyway.",
    );
    expect(sent(io, "--file")).toEqual([]);
  });

  it("seeds the older schema under --allow-pending, re-running nothing that is already in", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_users", sha256(USERS))]);
    io.files.set(join(root, "migrations", "0001_init.sql"), INIT);
    const cli = await run(io, ["seed", "apply", "--root", root, "--allow-pending"]);

    expect(cli.code).toBe(null);
    expect(sent(io, "--file")).toEqual([join(root, ".forge", "scratch", "seed", "seeds", "002_posts.sql")]);
    expect(cli.out).toEqual(["applied seeds:002_posts", "1 applied, 1 already in"]);
  });
});

describe("db seed apply against a schema nothing certified", () => {
  const USERS_SQL = "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT";
  const CERTIFIED = "f".repeat(64);

  /** Puts a certified fingerprint on the history and an inventory that does not hash to it. */
  function drifted(io: FakeDbIo): void {
    io.rules.unshift(
      {
        match: (args) => (args.at(-1) ?? "") === RECORDED_CHECKSUM_SELECT,
        reply: jsonRows([{ name: "0001_init", sha256: "a".repeat(64), applied_at: 1, fingerprint: CERTIFIED }]),
      },
      {
        match: (args) => (args.at(-1) ?? "") === INVENTORY_SELECT,
        reply: jsonRows([{ type: "table", name: "users", tbl_name: "users", sql: USERS_SQL }]),
      },
    );
  }

  it("refuses with nothing written, naming both fingerprints and what a seed cannot do about them", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    drifted(io);
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain(
      `app-db (local) schema fingerprint ${schemaFingerprint([{ type: "table", name: "users", tblName: "users", sql: USERS_SQL }])} is not the ${CERTIFIED} the last apply certified`,
    );
    expect(cli.err.join("\n")).toContain(
      "pass --allow-drift to seed anyway; a seed certifies no fingerprint, so `forge db migrate` goes on refusing until an apply explains the schema.",
    );
    expect(sent(io, "--file")).toEqual([]);
  });

  it("seeds it under --allow-drift", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    drifted(io);
    const cli = await run(io, ["seed", "apply", "--root", root, "--allow-drift"]);

    expect(cli.code).toBe(null);
    expect(sent(io, "--file")).toEqual([
      join(root, ".forge", "scratch", "seed", "seeds", "001_users.sql"),
      join(root, ".forge", "scratch", "seed", "seeds", "002_posts.sql"),
    ]);
  });
});

describe("db seed apply linting", () => {
  const BARE = "INSERT INTO tags (name) VALUES ('x');";
  const SAFE = "INSERT OR IGNORE INTO tags (name) VALUES ('y');";

  it("warns on a non-idempotent INSERT through the log, and applies the seed regardless", async () => {
    const root = appRoot();
    const io = seedIo(root, [], { "001_bare.sql": BARE, "002_safe.sql": SAFE });
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(null);
    expect(io.logs).toEqual([
      `warning ${join(root, "seeds", "001_bare.sql")}:1 seed-insert-not-idempotent — INSERT without OR IGNORE, OR REPLACE or ON CONFLICT is not safe to run twice — a re-run duplicates the row or fails on its key`,
    ]);
    expect(sent(io, "--file")).toEqual([
      join(root, ".forge", "scratch", "seed", "seeds", "001_bare.sql"),
      join(root, ".forge", "scratch", "seed", "seeds", "002_safe.sql"),
    ]);
    expect(cli.out).toEqual(["applied seeds:001_bare", "applied seeds:002_safe", "2 applied, 0 already in"]);
  });

  it("says nothing about a seed that is already recorded, since only a pending seed is linted", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_bare", sha256(BARE))], { "001_bare.sql": BARE });
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(null);
    expect(io.logs).toEqual([]);
  });
});

describe("db seed apply locking", () => {
  const NOW = new Date("2026-09-11T10:00:00Z");
  const lockPath = (root: string) => join(root, ".forge", "db-apply.lock");
  const heldLock = JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - 60_000 });
  const heldMessage = (root: string) =>
    `Another seed holds ${lockPath(root)} (pid 4242, since 2026-09-11T09:59:00.000Z). Wait for it to finish, or delete that file if the process is gone.`;

  it("holds the lock across every seed it loads, and removes it once they are in", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    const heldWhileLoading: boolean[] = [];
    io.rules.unshift({
      match: (args) => args.includes("--file"),
      reply: () => {
        heldWhileLoading.push(io.files.has(lockPath(root)));
        return OK;
      },
    });
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(null);
    expect(heldWhileLoading).toEqual([true, true]);
    expect(io.files.has(lockPath(root))).toBe(false);
  });

  it("refuses a local apply while another verb holds the lock, loading nothing", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    io.files.set(lockPath(root), heldLock);
    const cli = await run(io, ["seed", "apply", "--root", root]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain(heldMessage(root));
    expect(sent(io, "--file")).toEqual([]);
    expect(io.files.get(lockPath(root))).toBe(heldLock);
  });

  it("refuses a reset while another verb holds the lock, clearing no history", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    io.files.set(lockPath(root), heldLock);
    const cli = await run(io, ["seed", "reset", "--root", root, "--yes"]);

    expect(cli.code).toBe(1);
    expect(cli.err.join("\n")).toContain(heldMessage(root));
    expect(sent(io, "--command").filter((command) => command.startsWith("DELETE"))).toEqual([]);
  });
});

describe("db seed status", () => {
  it("classifies every seed without touching the database", async () => {
    const root = appRoot();
    const io = seedIo(root, [record("001_users", "stale")]);
    const cli = await run(io, ["seed", "status", "--root", root, "--json"]);

    expect(cli.out.length).toBe(1);
    expect(JSON.parse(cli.out[0] ?? "")).toEqual({
      target: "local",
      database: "app-db",
      apply: ["seeds:002_posts"],
      skip: [],
      changed: ["seeds:001_users"],
      excluded: [],
    });
    expect(sent(io, "--file")).toEqual([]);
  });

  it("needs no variable set, since nothing is expanded before apply", async () => {
    const root = appRoot();
    const io = seedIo(root, [], { "001_admin.sql": SECRET_SEED });
    const cli = await run(io, ["seed", "status", "--root", root, "--check"]);

    expect(cli.out).toEqual(["pending  seeds:001_admin"]);
    expect(cli.err).toEqual(["Error: 1 seed(s) pending or changed on app-db (local) — apply them with `forge db seed apply`."]);
    expect(cli.code).toBe(1);
  });

  it("reads an empty history from a database with no history table", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    io.rules[1] = {
      match: (args) => argvHas(args, "execute", "--json", "--command"),
      reply: { code: 1, stdout: "", stderr: "no such table: _forge_seed_history" },
    };
    const cli = await run(io, ["seed", "status", "--root", root, "--json"]);

    expect(JSON.parse(cli.out[0] ?? "").apply).toEqual(["seeds:001_users", "seeds:002_posts"]);
  });
});

describe("db seed reset", () => {
  it("clears the history table and says the seeds' own rows are untouched", async () => {
    const root = appRoot();
    const io = seedIo(root, []);
    const cli = await run(io, ["seed", "reset", "--root", root, "--yes"]);

    expect(sent(io, "--command").filter((command) => command.startsWith("DELETE"))).toEqual(["DELETE FROM _forge_seed_history;"]);
    expect(cli.out).toEqual(["seed history cleared — the rows the seeds wrote are untouched"]);
  });
});
