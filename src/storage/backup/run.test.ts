import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import { exportReply, fakeBackupBucket, fakeDatabase, fakeStep, installDigestStream, stubDatabase } from "./backup.fixture";
import { D1BackupError } from "./errors";
import { backupKey, sidecarKey } from "./list";
import { runD1Backup } from "./run";
import { readD1Backup } from "./sidecar";
import type { D1BackupOptions } from "./types";

installDigestStream();

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
  const options: D1BackupOptions = {
    accountId: "acct",
    databaseId: DB,
    apiToken: "tok",
    bucket,
    database: fakeDatabase(SCHEMA),
    at: AT,
    pollIntervalMs: 0,
    fetch: async (url, init) => {
      if (url === SIGNED) {
        downloads.push(init ?? {});
        return download();
      }
      polls.push(JSON.parse(String(init?.body)));
      const state = exportStates[Math.min(polls.length - 1, exportStates.length - 1)];
      return state instanceof Response ? state : exportReply(state);
    },
    ...over,
  };
  return { options, bucket, polls, downloads };
}

const ACTIVE = { status: "active", at_bookmark: BOOKMARK };
const COMPLETE = { status: "complete", at_bookmark: BOOKMARK, result: { filename: "d.sql", signed_url: SIGNED } };

describe("runD1Backup()", () => {
  it("starts the export, polls until complete, and stores the dump under the event's instant and bookmark", async () => {
    const { options, bucket, polls, downloads } = wire([ACTIVE, ACTIVE, COMPLETE]);
    const step = fakeStep();
    const record = await runD1Backup(step, options);

    const key = backupKey(undefined, DB, AT, BOOKMARK);
    expect([record.key, record.bookmark, record.takenAt, record.size]).toEqual([key, BOOKMARK, AT.toISOString(), DUMP.length]);
    expect(polls).toEqual([
      { output_format: "polling" },
      { output_format: "polling", current_bookmark: BOOKMARK },
      { output_format: "polling", current_bookmark: BOOKMARK },
    ]);
    expect(new TextDecoder().decode(bucket.objects.get(key)?.bytes)).toBe(DUMP);
    expect(bucket.objects.get(key)?.customMetadata).toEqual({ bookmark: BOOKMARK, databaseId: DB, takenAt: AT.toISOString() });
    expect(new Headers(downloads[0]?.headers).has("Authorization")).toBe(false);
    expect(step.ran.map((ran) => ran.name)).toEqual(["take d1 census", "start d1 export", "export and store d1 dump"]);
  });

  it("writes a sidecar holding the dump's size, digests, rows per table and census, and answers it", async () => {
    const { options, bucket } = wire([ACTIVE, COMPLETE]);
    const record = await runD1Backup(fakeStep(), options);
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
    const record = await runD1Backup(fakeStep(), options);
    expect([bucket.objects.has(record.key), record.hazards]).toEqual([true, [{ table: "t", column: "a", kind: "integer", count: 1 }]]);
  });

  it("refuses a database holding a virtual table before starting the export", async () => {
    const database = stubDatabase([{ type: "table", name: "docs", tbl_name: "docs", sql: "CREATE VIRTUAL TABLE docs USING fts5(body)" }]);
    const { options, polls } = wire([ACTIVE, COMPLETE], { database });
    const error = (await runD1Backup(fakeStep(), options).catch((thrown: unknown) => thrown)) as D1BackupError;
    expect([error.kind, error.message.includes("docs"), polls.length]).toEqual(["unsupported", true, 0]);
  });

  it("refuses a download shorter than its Content-Length, aborting the upload and writing no sidecar", async () => {
    const short = () => new Response(DUMP, { headers: { "Content-Length": String(DUMP.length + 10) } });
    const { options, bucket } = wire([ACTIVE, COMPLETE], {}, short);
    const error = (await runD1Backup(fakeStep(), options).catch((thrown: unknown) => thrown)) as D1BackupError;
    expect([error.kind, bucket.aborted.length, bucket.objects.size]).toEqual(["download", 1, 0]);
  });

  it("fails a download that stalls past `idleTimeoutMs`, aborting the upload", async () => {
    const stalled = () => new Response(new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode("PRAGMA")) }));
    const { options, bucket } = wire([ACTIVE, COMPLETE], { idleTimeoutMs: 5 }, stalled);
    const error = (await runD1Backup(fakeStep(), options).catch((thrown: unknown) => thrown)) as D1BackupError;
    expect([error.kind, error.message, bucket.aborted.length, bucket.objects.size]).toEqual([
      "download",
      "the D1 export download sent nothing for 5 ms",
      1,
      0,
    ]);
  });

  it("returns only the bookmark and the record from its steps, so the signed URL never reaches persisted state", async () => {
    const { options } = wire([ACTIVE, COMPLETE]);
    const step = fakeStep();
    await runD1Backup(step, options);
    expect(JSON.stringify(step.ran.map((ran) => ran.result))).not.toContain("X-Amz-Signature");
    expect(step.ran[1]?.result).toBe(BOOKMARK);
  });

  it("bounds the export step by the given timeout and retries it", async () => {
    const { options } = wire([ACTIVE, COMPLETE], { timeout: "3 hours" });
    const step = fakeStep();
    await runD1Backup(step, options);
    expect(step.ran[2]?.config).toEqual({ retries: { limit: 3, delay: "1 minute", backoff: "exponential" }, timeout: "3 hours" });
  });

  it("prunes past `keep` in a step of its own, sidecars included", async () => {
    const { options, bucket } = wire([ACTIVE, COMPLETE], { keep: 1 });
    const older = backupKey(undefined, DB, new Date("2026-10-31T02:00:00Z"), BOOKMARK);
    for (const key of [older, sidecarKey(older)]) bucket.objects.set(key, { bytes: new Uint8Array(1), customMetadata: {} });
    const step = fakeStep();
    await runD1Backup(step, options);

    const kept = backupKey(undefined, DB, AT, BOOKMARK);
    expect(step.ran.map((ran) => [ran.name, ran.result])).toContainEqual(["prune old d1 dumps", 1]);
    expect([...bucket.objects.keys()].sort()).toEqual([sidecarKey(kept), kept]);
  });

  it("fails the export step when D1 reports the export failed, storing nothing", async () => {
    const { options, bucket } = wire([ACTIVE, { status: "error", error: "database too large" }]);
    const error = await runD1Backup(fakeStep(), options).catch((thrown: unknown) => thrown);
    expect([(error as D1BackupError).kind, (error as Error).message]).toEqual(["export", "D1 reported the export failed: database too large"]);
    expect(bucket.objects.size).toBe(0);
  });

  it("refuses an export whose bookmark moves while it is polled", async () => {
    const { options } = wire([ACTIVE, { status: "active", at_bookmark: "00000086-other" }]);
    expect(((await runD1Backup(fakeStep(), options).catch((thrown: unknown) => thrown)) as D1BackupError).kind).toBe("export");
  });

  it("refuses a bookmark outside D1's grammar before it can name an object", async () => {
    const { options } = wire([{ status: "active", at_bookmark: "../../escape" }]);
    expect(((await runD1Backup(fakeStep(), options).catch((thrown: unknown) => thrown)) as D1BackupError).kind).toBe("malformed");
  });

  it("aborts the upload when the download fails part-way, keeping nothing", async () => {
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
    await expect(runD1Backup(fakeStep(), options)).rejects.toThrow("connection reset");
    expect([bucket.aborted, bucket.objects.size]).toEqual([[backupKey(undefined, DB, AT, BOOKMARK)], 0]);
  });

  it("fails a refused download as a download failure that names the status, not the URL", async () => {
    const { options } = wire([ACTIVE, COMPLETE], {}, () => new Response("denied", { status: 403 }));
    const error = (await runD1Backup(fakeStep(), options).catch((thrown: unknown) => thrown)) as D1BackupError;
    expect([error.kind, error.status, error.message.includes("X-Amz-Signature")]).toEqual(["download", 403, false]);
  });

  it("hands a failure no retry can change to `nonRetryable`, and leaves a transient one as it was", async () => {
    class Final extends Error {}
    const nonRetryable = (message: string) => new Final(message);

    const auth = wire([new Response("{}", { status: 403 })], { nonRetryable });
    expect(await runD1Backup(fakeStep(), auth.options).catch((thrown: unknown) => thrown)).toBeInstanceOf(Final);

    const outage = wire([new Response("{}", { status: 503 })], { nonRetryable });
    const transient = await runD1Backup(fakeStep(), outage.options).catch((thrown: unknown) => thrown);
    expect([transient instanceof Final, (transient as D1BackupError).kind]).toEqual([false, "refused"]);
  });

  it("refuses bad options before any step or request", async () => {
    for (const over of [{ apiToken: "" }, { keep: 0 }, { keep: 1.5 }, { at: new Date("nope") }, { idleTimeoutMs: 0 }]) {
      const { options, polls } = wire([ACTIVE], over);
      const step = fakeStep();
      const error = (await runD1Backup(step, options).catch((thrown: unknown) => thrown)) as D1BackupError;
      expect([error.kind, polls.length, step.ran.length]).toEqual(["options", 0, 0]);
    }
  });
});
