import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import type { FakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { sidecarKey } from "../../../storage/backup/list";
import { readD1Backup } from "../../../storage/backup/sidecar";
import type { CliError } from "../../cli/errors";
import { fakeDbIo, r2RestRules, REMOTE_AUTH } from "../db.fixture";
import { exportReply, fakeDatabase, stubDatabase } from "./backup.fixture";
import { restBackupBucket } from "./rest-bucket";
import { restTransfer } from "./rest-transfer";
import { takeD1Backup } from "./run";
import { backupKey } from "./store";
import type { D1BackupOptions } from "./types";

const DB = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const AT = new Date("2026-11-01T02:00:00Z");
const BOOKMARK = "00000085-0000024c-00004c6d-8e61117bf38d7adb";
const SIGNED = "https://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";
const DUMP = 'PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE t (a);\nINSERT INTO "t" ("a") VALUES(1);\nINSERT INTO "t" ("a") VALUES(2);\n';
const SCHEMA = "CREATE TABLE t (a); INSERT INTO t VALUES (1), (2);";

const hexOf = (algorithm: string, text: string) => createHash(algorithm).update(text).digest("hex");

interface Wiring {
  readonly options: D1BackupOptions;
  readonly bucket: ReturnType<typeof fakeBackupBucket>;
  readonly polls: unknown[];
  readonly downloads: RequestInit[];
}

function wire(exportStates: unknown[], over: Partial<D1BackupOptions> = {}, download: () => Response = () => new Response(DUMP)): Wiring {
  const bucket = fakeBackupBucket();
  const polls: unknown[] = [];
  const downloads: RequestInit[] = [];
  const io = fakeDbIo();
  io.fetch = async (input, init) => {
    if (String(input) === SIGNED) {
      downloads.push(init ?? {});
      return download();
    }
    polls.push(JSON.parse(String(init?.body)));
    const state = exportStates[Math.min(polls.length - 1, exportStates.length - 1)];
    return state instanceof Response ? state : exportReply(state);
  };
  const options: D1BackupOptions = {
    databaseId: DB,
    bucket,
    database: fakeDatabase(SCHEMA),
    transfer: restTransfer(io, REMOTE_AUTH, DB),
    upload: "whole",
    at: AT,
    ...over,
  };
  return { options, bucket, polls, downloads };
}

const ACTIVE = { status: "active", at_bookmark: BOOKMARK };
const COMPLETE = { status: "complete", at_bookmark: BOOKMARK, result: { filename: "d.sql", signed_url: SIGNED } };

/** The deployed bucket over Cloudflare's REST object endpoint, backed by an in-memory store. */
function restBucket() {
  const io = fakeDbIo();
  const store = fakeBackupBucket();
  io.restRules.push(...r2RestRules(store));
  return { io, store, bucket: restBackupBucket(io, REMOTE_AUTH, "app-backups") };
}

/** A bucket recording each key it is asked to write or delete, in order, and each value it is handed to write. */
function spyBucket(inner: FakeBackupBucket = fakeBackupBucket()) {
  const writes: { key: string; value: unknown }[] = [];
  const touched: string[] = [];
  const bucket: FakeBackupBucket = {
    ...inner,
    objects: inner.objects,
    deleted: inner.deleted,
    put(key, value, options) {
      writes.push({ key, value });
      touched.push(`put ${key}`);
      return inner.put(key, value, options);
    },
    delete(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) touched.push(`delete ${key}`);
      return inner.delete(keys);
    },
  };
  return { bucket, writes, touched };
}

/** A download announcing `length`, whose body reports whether it was cancelled. */
function announcedDownload(length: string | null) {
  const seen = { cancelled: false };
  const download = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(DUMP));
          controller.close();
        },
        cancel() {
          seen.cancelled = true;
        },
      }),
      length === null ? {} : { headers: { "Content-Length": length } },
    );
  return { seen, download };
}

describe("takeD1Backup()", () => {
  it("starts the export, polls until complete, and stores the dump under the instant and bookmark", async () => {
    const { options, bucket, polls, downloads } = wire([ACTIVE, ACTIVE, COMPLETE]);
    const record = await takeD1Backup(options);

    const key = backupKey(undefined, DB, AT, BOOKMARK);
    expect([record.key, record.bookmark, record.takenAt, record.size]).toEqual([key, BOOKMARK, AT.toISOString(), DUMP.length]);
    expect(polls).toEqual([
      { output_format: "polling" },
      { output_format: "polling", current_bookmark: BOOKMARK },
      { output_format: "polling", current_bookmark: BOOKMARK },
    ]);
    expect(new TextDecoder().decode(bucket.objects.get(key)?.bytes)).toBe(DUMP);
    expect(new Headers(downloads[0]?.headers).has("Authorization")).toBe(false);
  });

  it("writes a sidecar holding the dump's size, digests, rows per table and census, and answers it", async () => {
    const { options, bucket } = wire([ACTIVE, COMPLETE]);
    const record = await takeD1Backup(options);
    const sidecar = await readD1Backup(bucket, record.key);

    expect(sidecar).toEqual(record);
    expect(sidecar).toMatchObject({
      size: DUMP.length,
      md5: hexOf("md5", DUMP),
      sha256: hexOf("sha256", DUMP),
      rows: { t: 2 },
      migrationHead: null,
      hazards: [],
    });
    expect(sidecar?.schemaDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores a dump whose values D1's dumper will not reproduce, naming each in the sidecar", async () => {
    const { options, bucket } = wire([ACTIVE, COMPLETE], {
      database: fakeDatabase("CREATE TABLE t (a); INSERT INTO t VALUES (9007199254740993);"),
    });
    const record = await takeD1Backup(options);
    expect([bucket.objects.has(record.key), record.hazards]).toEqual([true, [{ table: "t", column: "a", kind: "integer", count: 1 }]]);
  });

  it("refuses a database holding a virtual table before starting the export", async () => {
    const database = stubDatabase([{ type: "table", name: "docs", tbl_name: "docs", sql: "CREATE VIRTUAL TABLE docs USING fts5(body)" }]);
    const { options, polls } = wire([ACTIVE, COMPLETE], { database });
    const error = (await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError;
    expect([error.kind, error.message.includes("docs"), polls.length]).toEqual(["invalid-args", true, 0]);
  });

  it("refuses a download shorter than its Content-Length, deleting the object and writing no sidecar", async () => {
    const short = () => new Response(DUMP, { headers: { "Content-Length": String(DUMP.length + 10) } });
    const { options, bucket } = wire([ACTIVE, COMPLETE], {}, short);
    const error = (await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError;
    expect([error.kind, bucket.deleted, bucket.objects.size]).toEqual(["external", [[backupKey(undefined, DB, AT, BOOKMARK)]], 0]);
  });

  it("refuses an empty download, deleting the object and writing no sidecar", async () => {
    const { options, bucket } = wire([ACTIVE, COMPLETE], {}, () => new Response(""));
    const error = (await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError;
    expect([error.kind, error.message, bucket.deleted, bucket.objects.size]).toEqual([
      "external",
      "the D1 export downloaded as an empty file",
      [[backupKey(undefined, DB, AT, BOOKMARK)]],
      0,
    ]);
  });

  it("fails a download that stalls past `idleTimeoutMs`, storing nothing", async () => {
    const stalled = () => new Response(new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode("PRAGMA")) }));
    const { options, bucket } = wire([ACTIVE, COMPLETE], { idleTimeoutMs: 5 }, stalled);
    const error = (await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError;
    expect([error.kind, error.message, bucket.objects.size]).toEqual(["external", "the D1 export download sent nothing for 5 ms", 0]);
  });

  it("prunes past `keep`, sidecars included", async () => {
    const { options, bucket } = wire([ACTIVE, COMPLETE], { keep: 1 });
    const older = backupKey(undefined, DB, new Date("2026-10-31T02:00:00Z"), BOOKMARK);
    for (const key of [older, sidecarKey(older)]) bucket.objects.set(key, { bytes: new Uint8Array(1) });
    await takeD1Backup(options);

    const kept = backupKey(undefined, DB, AT, BOOKMARK);
    expect([...bucket.objects.keys()].sort()).toEqual([sidecarKey(kept), kept]);
  });

  it("fails when D1 reports the export failed, storing nothing", async () => {
    const { options, bucket } = wire([ACTIVE, { status: "error", error: "database too large" }]);
    const error = await takeD1Backup(options).catch((thrown: unknown) => thrown);
    expect([(error as CliError).kind, (error as Error).message]).toEqual(["external", "D1 reported the export failed: database too large"]);
    expect(bucket.objects.size).toBe(0);
  });

  it("refuses an export whose bookmark moves while it is polled", async () => {
    const { options } = wire([ACTIVE, { status: "active", at_bookmark: "00000086-other" }]);
    expect(((await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError).kind).toBe("external");
  });

  it("refuses a bookmark outside D1's grammar before it can name an object", async () => {
    const { options } = wire([{ status: "active", at_bookmark: "../../escape" }]);
    expect(((await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError).kind).toBe("external");
  });

  it("keeps nothing when the download fails part-way", async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("PRAGMA"));
            controller.error(new Error("connection reset"));
          },
        }),
      );
    const { options, bucket } = wire([ACTIVE, COMPLETE], {}, broken);
    await expect(takeD1Backup(options)).rejects.toThrow("connection reset");
    expect(bucket.objects.size).toBe(0);
  });

  it("fails a refused download as a download failure that names the status, not the URL", async () => {
    const { options } = wire([ACTIVE, COMPLETE], {}, () => new Response("denied", { status: 403 }));
    const error = (await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError;
    expect([error.kind, error.message.includes("HTTP 403"), error.message.includes("X-Amz-Signature")]).toEqual(["external", true, false]);
  });

  it("refuses bad options before any request", async () => {
    for (const over of [{ databaseId: "" }, { keep: 0 }, { keep: 1.5 }, { at: new Date("nope") }, { idleTimeoutMs: 0 }]) {
      const { options, polls } = wire([ACTIVE], over);
      const error = (await takeD1Backup(options).catch((thrown: unknown) => thrown)) as CliError;
      expect([error.kind, polls.length]).toEqual(["invalid-args", 0]);
    }
  });
});

describe("takeD1Backup() — the upload", () => {
  const KEY = backupKey(undefined, DB, AT, BOOKMARK);
  const OBJECT_URL = `https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/app-backups/objects/${KEY.split("/").map(encodeURIComponent).join("/")}`;

  it("refuses a remote dump announced over 300 MiB before uploading anything, naming the size, the cap and R2's S3 API, and cancels the download", async () => {
    const { io, store, bucket } = restBucket();
    const { seen, download } = announcedDownload("314572801");
    const { options } = wire([ACTIVE, COMPLETE], { bucket, upload: "stream" }, download);
    const error = await takeD1Backup(options).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      kind: "invalid-args",
      message: `${KEY} is 314572801 bytes, and Cloudflare's REST object endpoint — the one \`wrangler r2 object put\` uses — takes a body of stated length of at most 314572800 — upload it through R2's S3 API instead`,
    });
    expect([io.restCalls, store.objects.size, seen.cancelled]).toEqual([[], 0, true]);
  });

  it("refuses a remote dump with no Content-Length before uploading anything, and cancels the download", async () => {
    const { io, store, bucket } = restBucket();
    const { seen, download } = announcedDownload(null);
    const { options } = wire([ACTIVE, COMPLETE], { bucket, upload: "stream" }, download);
    const error = await takeD1Backup(options).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      kind: "invalid-args",
      message: `${KEY} has no stated length, and Cloudflare's REST object endpoint — the one \`wrangler r2 object put\` uses — takes a body of stated length of at most 314572800 — upload it through R2's S3 API instead`,
    });
    expect([io.restCalls, store.objects.size, seen.cancelled]).toEqual([[], 0, true]);
  });

  it("refuses a streamed dump with no Content-Length before the bucket sees it, even a bucket that would take one", async () => {
    const { bucket, touched } = spyBucket();
    const { seen, download } = announcedDownload(null);
    const { options } = wire([ACTIVE, COMPLETE], { bucket, upload: "stream" }, download);
    const error = await takeD1Backup(options).catch((thrown: unknown) => thrown);
    expect([(error as CliError).kind, touched, seen.cancelled]).toEqual(["invalid-args", [], true]);
  });

  it("deletes a remote dump shorter than its Content-Length, writes no sidecar, and names both sizes", async () => {
    const { io, store, bucket } = restBucket();
    const { download } = announcedDownload(String(DUMP.length + 10));
    const { options } = wire([ACTIVE, COMPLETE], { bucket, upload: "stream" }, download);
    const error = await takeD1Backup(options).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      kind: "external",
      message: `the D1 export downloaded ${DUMP.length} bytes of the ${DUMP.length + 10} its Content-Length announced`,
    });
    expect(io.restCalls.map(({ method, url }) => [method, url])).toEqual([
      ["PUT", OBJECT_URL],
      ["DELETE", OBJECT_URL],
    ]);
    expect(store.objects.size).toBe(0);
  });

  it("streams a remote dump at its announced length into the deployed bucket", async () => {
    const { io, store, bucket } = restBucket();
    const { download } = announcedDownload(String(DUMP.length));
    const { options } = wire([ACTIVE, COMPLETE], { bucket, upload: "stream" }, download);
    await takeD1Backup(options);
    const dumpPut = io.restCalls.find(({ method, url }) => method === "PUT" && url === OBJECT_URL);
    expect([dumpPut?.headers["content-length"], new TextDecoder().decode(store.objects.get(KEY)?.bytes)]).toEqual([String(DUMP.length), DUMP]);
  });

  it("hands a local bucket the dump read whole, as bytes", async () => {
    const { bucket, writes } = spyBucket();
    const { options } = wire([ACTIVE, COMPLETE], { bucket, upload: "whole" });
    await takeD1Backup(options);
    const value = writes.find(({ key }) => key === KEY)?.value;
    expect(value).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(value as Uint8Array)).toBe(DUMP);
  });

  it("writes the dump, then its sidecar, then prunes past `keep`", async () => {
    for (const upload of ["stream", "whole"] as const) {
      const { bucket, touched } = spyBucket();
      const older = backupKey(undefined, DB, new Date("2026-10-31T02:00:00Z"), BOOKMARK);
      for (const key of [older, sidecarKey(older)]) bucket.objects.set(key, { bytes: new Uint8Array(1) });
      const { options } = wire([ACTIVE, COMPLETE], { bucket, upload, keep: 1 }, announcedDownload(String(DUMP.length)).download);
      await takeD1Backup(options);
      expect([upload, touched]).toEqual([upload, [`put ${KEY}`, `put ${sidecarKey(KEY)}`, `delete ${older}`, `delete ${sidecarKey(older)}`]]);
    }
  });
});
