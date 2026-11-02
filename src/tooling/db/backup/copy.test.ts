import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import type { FakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { backupKey, sidecarKey } from "../../../storage/backup/list";
import type { D1BackupSidecar } from "../../../storage/backup/types";
import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { fakeDbIo, r2RestRules, REMOTE_AUTH } from "../db.fixture";
import { sha256 } from "../digest";
import { appHome } from "../home";
import type { DbConfig, DbRunContext, FakeDbIo, Home } from "../types";
import { listDumps, pullDump, pushDump } from "./copy";
import { resolveDumpSource } from "./dumps";
import { restBackupBucket } from "./rest-bucket";

const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const KEY = backupKey(undefined, DB_ID, new Date("2026-09-11T09:00:00Z"), "local-1");
const FILE = KEY.split("/").at(-1) ?? "";
const DUMP = `PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE notes (body TEXT);\n${"INSERT INTO \"notes\" VALUES('BEGIN TRANSACTION; ü');\n".repeat(40)}`;

function sidecarOf(dump: string, over: Partial<D1BackupSidecar> = {}): D1BackupSidecar {
  return {
    key: KEY,
    databaseId: DB_ID,
    bookmark: "local-1",
    takenAt: "2026-09-11T09:00:00.000Z",
    size: new TextEncoder().encode(dump).byteLength,
    md5: "0".repeat(32),
    sha256: sha256(dump),
    schemaDigest: "2".repeat(64),
    migrationHead: "0001_init",
    rows: { notes: 40 },
    hazards: [],
    ...over,
  };
}

// Key order differs from the schema's, so a copy that re-serialised the sidecar would show.
const SIDECAR_TEXT = ({ rows, ...rest }: D1BackupSidecar) => JSON.stringify({ rows, ...rest });

const CONFIG: DbConfig = {
  root: "/app",
  configPath: "/app/wrangler.jsonc",
  config: {
    name: "app",
    compatibility_date: "2026-01-01",
    d1_databases: [{ binding: "DB", database_name: "app-db", database_id: DB_ID }],
    r2_buckets: [{ binding: "BACKUPS", bucket_name: "app-backups" }],
  } as WranglerConfig,
  env: null,
  entry: { binding: "DB", databaseName: "app-db", databaseId: DB_ID, previewDatabaseId: null },
  target: { place: "local", database: null },
};

const REMOTE_HOME: Home = { ...appHome(CONFIG), label: "remote", persistTo: null, place: "remote", databaseId: DB_ID, auth: REMOTE_AUTH };

/** A run over a bucket holding `dump` and, unless `sidecar` is null, its sidecar — the dev session's own, or the deployed one over REST. */
async function context(
  where: "local" | "remote",
  dump: string | null = DUMP,
  sidecar: D1BackupSidecar | null = sidecarOf(DUMP),
): Promise<{ run: DbRunContext; io: FakeDbIo; bucket: FakeBackupBucket }> {
  const io = fakeDbIo();
  const bucket = fakeBackupBucket(1);
  if (dump !== null) await bucket.put(KEY, dump);
  if (sidecar !== null) await bucket.put(sidecarKey(KEY), SIDECAR_TEXT(sidecar));
  if (where === "local") io.buckets.set("BACKUPS", bucket);
  else io.restRules.push(...r2RestRules(bucket));
  const home = where === "local" ? appHome(CONFIG) : REMOTE_HOME;
  const config = where === "local" ? CONFIG : { ...CONFIG, target: { place: "remote" as const, database: null } };
  return { run: { config, home, io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} }, io, bucket };
}

const source = (run: DbRunContext) => resolveDumpSource(run, {});

const puts = (io: FakeDbIo) => io.restCalls.filter((call) => call.method === "PUT");

describe("listDumps()", () => {
  it("lists the remote bucket across truncated pages, newest first, marking a dump with no sidecar incomplete", async () => {
    const { run, io, bucket } = await context("remote");
    const older = backupKey(undefined, DB_ID, new Date("2026-09-10T09:00:00Z"), "local-0");
    await bucket.put(older, "x");
    const records = await listDumps(run, source(run));
    expect(records.map(({ key, complete, size }) => ({ key, complete, size }))).toEqual([
      { key: KEY, complete: true, size: sidecarOf(DUMP).size },
      { key: older, complete: false, size: 1 },
    ]);
    expect(io.restCalls.filter((call) => call.url.includes("cursor=")).length).toBeGreaterThan(0);
    expect(io.restCalls.every((call) => call.url.includes("/r2/buckets/app-backups/objects"))).toBe(true);
  });

  it("lists the dev session's own bucket for a local target, sending nothing to Cloudflare", async () => {
    const { run, io } = await context("local", DUMP, null);
    expect((await listDumps(run, source(run))).map((record) => record.complete)).toEqual([false]);
    expect(io.restCalls).toEqual([]);
  });
});

describe("pullDump()", () => {
  for (const where of ["local", "remote"] as const) {
    it(`copies a ${where} dump and its sidecar to disk byte for byte`, async () => {
      const { run, io } = await context(where);
      const copy = await pullDump(run, source(run), KEY, "/out");
      expect(copy).toEqual({
        key: KEY,
        path: `/out/${FILE}`,
        sidecar: `/out/${FILE.replace(/\.sql$/, ".json")}`,
        size: sidecarOf(DUMP).size,
        sha256: sha256(DUMP),
      });
      expect([io.files.get(copy.path), io.files.get(copy.sidecar)]).toEqual([DUMP, SIDECAR_TEXT(sidecarOf(DUMP))]);
    });
  }

  it("leaves no file and refuses when a byte of the dump differs from what its sidecar records", async () => {
    const corrupted = `${DUMP.slice(0, 40)}X${DUMP.slice(41)}`;
    const { run, io } = await context("remote", corrupted, sidecarOf(DUMP));
    await expect(pullDump(run, source(run), KEY, "/out")).rejects.toThrow(
      `${KEY} arrived as sha256 ${sha256(corrupted)} where its sidecar records ${sha256(DUMP)}`,
    );
    expect([...io.files.keys()]).toEqual([]);
  });

  it("refuses a size that differs from the sidecar's before it compares the digest", async () => {
    const { run, io } = await context("local", `${DUMP}\n`, sidecarOf(DUMP));
    await expect(pullDump(run, source(run), KEY, "/out")).rejects.toThrow(`bytes where its sidecar records ${sidecarOf(DUMP).size}`);
    expect([...io.files.keys()]).toEqual([]);
  });

  it("fails a pull whose body stalls mid-stream on the idle timeout, leaving no file at the target path", async () => {
    const { run, io } = await context("local", null, null);
    io.restRules.push({ match: (url) => url.endsWith(".json"), reply: () => new Response(SIDECAR_TEXT(sidecarOf(DUMP))) });
    io.restRules.push({
      match: (url) => url.endsWith(".sql"),
      reply: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(DUMP.slice(0, 10)));
            },
          }),
        ),
    });
    io.buckets.set("BACKUPS", restBackupBucket(io, REMOTE_AUTH, "app-backups", { requestMs: 20, idleMs: 20 }));
    await expect(pullDump(run, source(run), KEY, "/out")).rejects.toThrow("sent nothing within 0.02 s");
    expect([...io.files.keys()]).toEqual([]);
  });

  it("refuses a file already on disk, reading nothing from the bucket", async () => {
    const { run, io } = await context("remote");
    io.files.set(`/out/${FILE}`, "mine");
    await expect(pullDump(run, source(run), KEY, "/out")).rejects.toThrow(`/out/${FILE} already exists`);
    expect([io.files.get(`/out/${FILE}`), io.restCalls]).toEqual(["mine", []]);
  });

  it("refuses a dump whose sidecar was never written", async () => {
    const { run } = await context("remote", DUMP, null);
    await expect(pullDump(run, source(run), KEY, "/out")).rejects.toThrow(`${KEY} has no sidecar in BACKUPS, so its backup never finished`);
  });
});

describe("pushDump()", () => {
  async function pulled(where: "local" | "remote"): Promise<{ run: DbRunContext; io: FakeDbIo; bucket: FakeBackupBucket; path: string }> {
    const from = await context(where);
    const copy = await pullDump(from.run, source(from.run), KEY, "/out");
    const to = await context(where, null, null);
    for (const path of [copy.path, copy.sidecar]) to.io.files.set(path, from.io.files.get(path) ?? "");
    return { ...to, path: copy.path };
  }

  for (const where of ["local", "remote"] as const) {
    it(`uploads a pulled dump and its sidecar to a ${where} bucket under the original key, byte for byte`, async () => {
      const { run, bucket, path } = await pulled(where);
      expect((await pushDump(run, source(run), path)).key).toBe(KEY);
      const text = (key: string) => new TextDecoder().decode(bucket.objects.get(key)?.bytes);
      expect([[...bucket.objects.keys()].sort(), text(KEY), text(sidecarKey(KEY))]).toEqual([
        [KEY, sidecarKey(KEY)].sort(),
        DUMP,
        SIDECAR_TEXT(sidecarOf(DUMP)),
      ]);
    });
  }

  it("sends the dump to a deployed bucket as a stream of its stated length", async () => {
    const { run, io, path } = await pulled("remote");
    await pushDump(run, source(run), path);
    expect(puts(io).map((call) => [decodeURIComponent(call.url).endsWith(FILE), call.headers["content-length"]])).toEqual([
      [true, String(sidecarOf(DUMP).size)],
      [false, String(SIDECAR_TEXT(sidecarOf(DUMP)).length)],
    ]);
  });

  it("refuses a dump with no sidecar beside it, before any request", async () => {
    const { run, io, path } = await pulled("remote");
    io.files.delete(path.replace(/\.sql$/, ".json"));
    await expect(pushDump(run, source(run), path)).rejects.toThrow(`${path} has no sidecar beside it`);
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a sidecar that names another dump file", async () => {
    const { run, io, path } = await pulled("remote");
    const sidecarPath = path.replace(/\.sql$/, ".json");
    io.files.set(sidecarPath, JSON.stringify(sidecarOf(DUMP, { key: `d1-backups/${DB_ID}/other.sql` })));
    await expect(pushDump(run, source(run), path)).rejects.toThrow(`is the sidecar of d1-backups/${DB_ID}/other.sql, not of ${FILE}`);
  });

  for (const where of ["local", "remote"] as const) {
    it(`reads the dump file once when it pushes to a ${where} bucket`, async () => {
      const { run, io, path } = await pulled(where);
      const reads: string[] = [];
      const readStream = io.readStream;
      io.readStream = (p) => {
        reads.push(p);
        return readStream(p);
      };
      await pushDump(run, source(run), path);
      expect(reads).toEqual([path]);
    });

    it(`leaves neither the dump nor its sidecar in a ${where} bucket when the file's sha256 differs from its sidecar's`, async () => {
      const { run, io, bucket, path } = await pulled(where);
      const corrupted = `${DUMP.slice(0, 40)}X${DUMP.slice(41)}`;
      io.files.set(path, corrupted);
      await expect(pushDump(run, source(run), path)).rejects.toThrow(
        `${path} is sha256 ${sha256(corrupted)} where its sidecar records ${sha256(DUMP)}`,
      );
      expect([...bucket.objects.keys()]).toEqual([]);
    });
  }

  it("refuses a dump of one database pushed under another's id, before any request", async () => {
    const { run, io, bucket, path } = await pulled("remote");
    const other = "9e8d7c6b-5a49-4382-a716-0f1e2d3c4b5a";
    await expect(pushDump(run, { ...source(run), databaseId: other }, path)).rejects.toThrow(
      `records a dump of database ${DB_ID}, not of ${other} — nothing was uploaded`,
    );
    expect([io.restCalls, [...bucket.objects.keys()]]).toEqual([[], []]);
  });

  it("refuses a sidecar whose key lies outside the database's prefix, before any request", async () => {
    const { run, io, path } = await pulled("remote");
    io.files.set(path.replace(/\.sql$/, ".json"), JSON.stringify(sidecarOf(DUMP, { key: `elsewhere/${DB_ID}/${FILE}` })));
    await expect(pushDump(run, source(run), path)).rejects.toThrow(`which is not under d1-backups/${DB_ID}/`);
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a key the bucket already holds, before any PUT", async () => {
    const { run, io, bucket, path } = await pulled("remote");
    await bucket.put(KEY, "already here");
    await expect(pushDump(run, source(run), path)).rejects.toThrow(`BACKUPS already holds ${KEY} — push never replaces an object`);
    expect([puts(io), new TextDecoder().decode(bucket.objects.get(KEY)?.bytes)]).toEqual([[], "already here"]);
  });

  it("refuses a sidecar key the bucket already holds, before any PUT", async () => {
    const { run, io, bucket, path } = await pulled("remote");
    await bucket.put(sidecarKey(KEY), "{}");
    await expect(pushDump(run, source(run), path)).rejects.toThrow(`already holds ${sidecarKey(KEY)}`);
    expect(puts(io)).toEqual([]);
  });
});
