import { describe, expect, it } from "bun:test";

import { exportReply, fakeBackupBucket, fakeStep } from "./backup.fixture";
import { D1BackupError } from "./errors";
import { backupKey } from "./list";
import { runD1Backup } from "./run";
import type { D1BackupOptions } from "./types";

const DB = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const AT = new Date("2026-11-01T02:00:00Z");
const BOOKMARK = "00000085-0000024c-00004c6d-8e61117bf38d7adb";
const SIGNED = "https://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";
const DUMP = "PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE t (a);\nINSERT INTO t VALUES (1);\n";

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
    expect(record).toEqual({ key, databaseId: DB, bookmark: BOOKMARK, takenAt: AT.toISOString(), size: DUMP.length });
    expect(polls).toEqual([
      { output_format: "polling" },
      { output_format: "polling", current_bookmark: BOOKMARK },
      { output_format: "polling", current_bookmark: BOOKMARK },
    ]);
    expect(new TextDecoder().decode(bucket.objects.get(key)?.bytes)).toBe(DUMP);
    expect(bucket.objects.get(key)?.customMetadata).toEqual({ bookmark: BOOKMARK, databaseId: DB, takenAt: AT.toISOString() });
    expect(new Headers(downloads[0]?.headers).has("Authorization")).toBe(false);
    expect(step.ran.map((ran) => ran.name)).toEqual(["start d1 export", "export and store d1 dump"]);
  });

  it("returns only the bookmark and the record from its steps, so the signed URL never reaches persisted state", async () => {
    const { options } = wire([ACTIVE, COMPLETE]);
    const step = fakeStep();
    await runD1Backup(step, options);
    expect(JSON.stringify(step.ran.map((ran) => ran.result))).not.toContain("X-Amz-Signature");
    expect(step.ran[0]?.result).toBe(BOOKMARK);
  });

  it("bounds the export step by the given timeout and retries it", async () => {
    const { options } = wire([ACTIVE, COMPLETE], { timeout: "3 hours" });
    const step = fakeStep();
    await runD1Backup(step, options);
    expect(step.ran[1]?.config).toEqual({ retries: { limit: 3, delay: "1 minute", backoff: "exponential" }, timeout: "3 hours" });
  });

  it("prunes past `keep` in a step of its own", async () => {
    const { options, bucket } = wire([ACTIVE, COMPLETE], { keep: 1 });
    const older = backupKey(undefined, DB, new Date("2026-10-31T02:00:00Z"), BOOKMARK);
    bucket.objects.set(older, { bytes: new Uint8Array(1), customMetadata: {} });
    const step = fakeStep();
    await runD1Backup(step, options);

    expect(step.ran.map((ran) => [ran.name, ran.result])).toContainEqual(["prune old d1 dumps", 1]);
    expect([...bucket.objects.keys()]).toEqual([backupKey(undefined, DB, AT, BOOKMARK)]);
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
    for (const over of [{ apiToken: "" }, { keep: 0 }, { keep: 1.5 }, { at: new Date("nope") }]) {
      const { options, polls } = wire([ACTIVE], over);
      const step = fakeStep();
      const error = (await runD1Backup(step, options).catch((thrown: unknown) => thrown)) as D1BackupError;
      expect([error.kind, polls.length, step.ran.length]).toEqual(["options", 0, 0]);
    }
  });
});
