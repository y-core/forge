import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import type { D1BackupSidecar } from "../../../storage/backup/types";
import type { WranglerConfig } from "../../cf/types";
import { CliError } from "../../cli/errors";
import { PLAIN } from "../../term/color";
import { fakeDbIo, r2RestRules, REMOTE_AUTH } from "../db.fixture";
import { appHome } from "../home";
import type { DbConfig, DbRunContext, FakeDbIo, Home } from "../types";
import { exportReply, fakeDatabase } from "./backup.fixture";
import { compareRowCounts, openBackupPorts, resolveDumpSource } from "./dumps";

function config(r2: unknown[] | undefined, env: string | null = null, envR2?: unknown[], databaseId: string | null = "db-id"): DbConfig {
  return {
    configPath: "/app/wrangler.jsonc",
    env,
    config: { name: "app", r2_buckets: r2, env: envR2 === undefined ? {} : { staging: { r2_buckets: envR2 } } } as unknown as WranglerConfig,
    entry: { binding: "DB", databaseName: "app-db", databaseId, previewDatabaseId: null },
  } as unknown as DbConfig;
}

/** A local run over `c`, whose home carries no deployed id. */
const at = (c: DbConfig) => ({ config: c, home: { databaseId: null } as unknown as Home });

const bucket = (binding: string) => ({ binding, bucket_name: binding.toLowerCase() });

describe("resolveDumpSource()", () => {
  it("takes BACKUPS among several, and --bucket over it", () => {
    expect(resolveDumpSource(at(config([bucket("MEDIA"), bucket("BACKUPS")])), {}).binding).toBe("BACKUPS");
    expect(resolveDumpSource(at(config([bucket("BACKUPS")])), { bucket: "OTHER" }).binding).toBe("OTHER");
    expect(resolveDumpSource(at(config([bucket("UPLOADS")])), { bucket: "UPLOADS" }).binding).toBe("UPLOADS");
  });

  it("reads an environment's own buckets, which wrangler does not inherit", () => {
    const staging = at(config([bucket("BACKUPS")], "staging", [{ binding: "BACKUPS", bucket_name: "staging-backups" }]));
    expect(resolveDumpSource(staging, {}).bucketName).toBe("staging-backups");
    expect(() => resolveDumpSource(at(config([bucket("BACKUPS")], "staging", [bucket("STAGING_DUMPS")])), {})).toThrow(
      "binds no R2 bucket named BACKUPS (it binds STAGING_DUMPS)",
    );
  });

  it("keys the dumps by the binding's database_id, else its name, under d1-backups unless --prefix says otherwise", () => {
    expect(resolveDumpSource(at(config([bucket("BACKUPS")])), {})).toEqual({
      binding: "BACKUPS",
      bucketName: "backups",
      prefix: "d1-backups",
      databaseId: "db-id",
    });
    expect(resolveDumpSource(at(config([bucket("BACKUPS")], null, undefined, null)), { prefix: "ops" })).toEqual({
      binding: "BACKUPS",
      bucketName: "backups",
      prefix: "ops",
      databaseId: "app-db",
    });
  });

  it("drops a --prefix's trailing slashes, as listD1Backups does, so a push checks its key against the prefix the listing reads", () => {
    expect(resolveDumpSource(at(config([bucket("BACKUPS")])), { prefix: "ops//" }).prefix).toBe("ops");
  });

  it("refuses a config with no BACKUPS binding, the only other bucket included, naming what it binds and both fixes", () => {
    const fix = "— declare one in r2_buckets to keep the dumps apart from other data, or pass --bucket";
    expect(() => resolveDumpSource(at(config(undefined)), {})).toThrow(`binds no R2 bucket named BACKUPS ${fix}`);
    expect(() => resolveDumpSource(at(config([bucket("UPLOADS")])), {})).toThrow(`binds no R2 bucket named BACKUPS (it binds UPLOADS) ${fix}`);
    expect(() => resolveDumpSource(at(config([bucket("A"), bucket("B")])), {})).toThrow(`binds no R2 bucket named BACKUPS (it binds A, B) ${fix}`);
  });
});

describe("resolveDumpSource() — the bucket and the database", () => {
  it("names the bucket the binding declares, and a --bucket no binding declares as the bucket itself", () => {
    expect(resolveDumpSource(at(config([{ binding: "BACKUPS", bucket_name: "app-backups" }])), {}).bucketName).toBe("app-backups");
    expect(resolveDumpSource(at(config([bucket("BACKUPS")])), { bucket: "loose-bucket" }).bucketName).toBe("loose-bucket");
  });

  it("keys a deployed target's dumps by the id its home addresses, a preview's own included", () => {
    const preview = { config: config([bucket("BACKUPS")]), home: { databaseId: "preview-id" } as unknown as Home };
    expect(resolveDumpSource(preview, {}).databaseId).toBe("preview-id");
  });
});

describe("compareRowCounts()", () => {
  const sidecar = { rows: { tasks: 2, gone: 1 } } as unknown as D1BackupSidecar;

  it("names each table whose count moved and each the database no longer declares, an empty table matching an absent count", () => {
    expect(
      compareRowCounts(
        sidecar,
        new Map([
          ["tasks", 3],
          ["empty", 0],
        ]),
      ),
    ).toEqual(["gone is in the dump and this database no longer declares it", "tasks: the dump holds 2 row(s) and the database now holds 3"]);
  });

  it("finds nothing when every count agrees", () => {
    expect(
      compareRowCounts(
        sidecar,
        new Map([
          ["tasks", 2],
          ["gone", 1],
        ]),
      ),
    ).toEqual([]);
  });
});

describe("openBackupPorts()", () => {
  const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
  const AT = new Date("2026-11-02T03:00:00Z");
  const ACCOUNT = "https://api.cloudflare.com/client/v4/accounts/acct";

  function ported(place: "local" | "remote", databaseId: string | null = DB_ID): { run: DbRunContext; io: FakeDbIo; reachedLocally: string[] } {
    const declared: DbConfig = {
      ...config([{ binding: "BACKUPS", bucket_name: "app-backups" }]),
      root: "/app",
      entry: { binding: "DB", databaseName: "app-db", databaseId, previewDatabaseId: null },
      target: { place, database: null },
    } as DbConfig;
    const home = appHome(declared, REMOTE_AUTH);
    const io = fakeDbIo({}, { homes: [home] });
    const reachedLocally: string[] = [];
    const localBucket = io.bucket.bind(io);
    const localDatabase = io.database.bind(io);
    io.bucket = (reached, binding) => (reachedLocally.push(`bucket ${binding}`), localBucket(reached, binding));
    io.database = (reached, binding) => (reachedLocally.push(`database ${binding}`), localDatabase(reached, binding));
    return { run: { config: declared, home, io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} }, io, reachedLocally };
  }

  it("goes over REST for a remote target: the deployed bucket, D1's query for the census, D1's export, and a streamed upload", async () => {
    const { run, io, reachedLocally } = ported("remote");
    io.restRules.push(...r2RestRules(fakeBackupBucket()), {
      match: (url) => url.endsWith("/export"),
      reply: () => exportReply({ status: "active", at_bookmark: "B-1" }),
    });
    io.d1Rules.push({ match: (statement) => statement === "SELECT 7 AS n", reply: [{ n: 7 }] });
    const ports = await openBackupPorts(run, resolveDumpSource(run, {}));

    expect(await ports.bucket.list({ prefix: "d1-backups/" })).toEqual({ objects: [], truncated: false });
    expect(await ports.database.prepare("SELECT 7 AS n").all()).toEqual({ results: [{ n: 7 }] });
    expect(await ports.transfer.startExport(AT)).toBe("B-1");
    expect(ports.upload).toBe("stream");
    expect(io.restCalls.map((call) => [call.method, call.url.split("?")[0], call.body === null ? null : JSON.parse(call.body)])).toEqual([
      ["GET", `${ACCOUNT}/r2/buckets/app-backups/objects`, null],
      ["POST", `${ACCOUNT}/d1/database/${DB_ID}/query`, { batch: [{ sql: "SELECT 7 AS n" }] }],
      ["POST", `${ACCOUNT}/d1/database/${DB_ID}/export`, { output_format: "polling" }],
    ]);
    expect(reachedLocally).toEqual([]);
  });

  it("goes through the dev session's own bindings for a local target, uploading the dump whole and sending nothing to Cloudflare", async () => {
    const { run, io, reachedLocally } = ported("local");
    const backups = fakeBackupBucket();
    const source = fakeDatabase();
    const standby = fakeDatabase("CREATE TABLE marker (n INTEGER); INSERT INTO marker VALUES (7);");
    io.buckets.set("BACKUPS", backups);
    io.databases.set("DB", source);
    io.databases.set("STANDBY", standby);
    const ports = await openBackupPorts(run, resolveDumpSource(run, {}));
    const reachedOpening = [...reachedLocally];
    const target = await ports.transfer.openTarget({ standby: "STANDBY" });

    expect(reachedOpening).toEqual(["bucket BACKUPS", "database DB"]);
    expect(ports.bucket).toBe(backups);
    expect(ports.database).toBe(source);
    expect(ports.upload).toBe("whole");
    expect(await ports.transfer.startExport(AT)).toBe(`local-${AT.getTime()}`);
    expect(await ports.transfer.query(target, "SELECT n FROM marker")).toEqual([{ n: 7 }]);
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a remote target with no D1 id to address, before any request", async () => {
    const { run, io, reachedLocally } = ported("remote", null);
    const error = await openBackupPorts(run, resolveDumpSource(run, {})).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ kind: "invalid-args", message: "remote (app-db) has no D1 id to address" });
    expect([io.restCalls, reachedLocally]).toEqual([[], []]);
  });
});
