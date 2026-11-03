import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import type { D1BackupSidecar } from "../../../storage/backup/types";
import { CliError } from "../../cli/errors";
import { fakeDbIo, REMOTE_AUTH } from "../db.fixture";
import { fakeD1Rest, fakeDatabase } from "./backup.fixture";
import { takeD1Census } from "./census";
import { dumpRowCounter } from "./meter";
import { restTransfer } from "./rest-transfer";
import { compareWithSidecar, restoreD1Backup } from "./restore";
import { writeSidecar } from "./store";
import type { D1RestoreOptions } from "./types";

const KEY = "d1-backups/db/2026-11-02T03:00:00.000Z-B1.sql";

const DUMP = [
  "PRAGMA defer_foreign_keys=TRUE;",
  'CREATE TABLE IF NOT EXISTS "_forge_migrations" (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
  'INSERT INTO "_forge_migrations" ("id","name") VALUES(1,\'0001_notes.sql\');',
  'CREATE TABLE IF NOT EXISTS "notes" (id INTEGER PRIMARY KEY, body TEXT);',
  'INSERT INTO "notes" ("id","body") VALUES(1,\'one; two\');',
  'INSERT INTO "notes" ("id","body") VALUES(2,replace(\'a\\nb\',\'\\n\',char(10)));',
  'CREATE INDEX notes_body ON "notes" (body);',
].join("\n");

async function sidecarOf(dump: string): Promise<D1BackupSidecar> {
  const source = fakeDatabase(dump);
  const counter = dumpRowCounter();
  counter.push(new TextEncoder().encode(dump));
  return {
    key: KEY,
    databaseId: "db",
    bookmark: "B1",
    takenAt: "2026-11-02T03:00:00.000Z",
    size: new TextEncoder().encode(dump).byteLength,
    md5: createHash("md5").update(dump).digest("hex"),
    sha256: createHash("sha256").update(dump).digest("hex"),
    rows: counter.finish(),
    ...(await takeD1Census(source)),
  };
}

async function wire(over: Partial<D1RestoreOptions> = {}, rest = fakeD1Rest(), fetch = rest.fetch, dump = DUMP) {
  const bucket = fakeBackupBucket();
  bucket.objects.set(KEY, { bytes: new TextEncoder().encode(dump) });
  await writeSidecar(bucket, await sidecarOf(dump));
  const io = fakeDbIo();
  io.fetch = (input, init) => fetch(String(input), init);
  const options: D1RestoreOptions = {
    bucket,
    key: KEY,
    into: { fresh: "app-db-restore-1" },
    transfer: restTransfer(io, REMOTE_AUTH, "unused"),
    ...over,
  };
  return { options, bucket, rest };
}

async function failure(run: Promise<unknown>): Promise<CliError> {
  const error = await run.catch((thrown: unknown) => thrown);
  if (!(error instanceof CliError)) throw new Error(`expected a CliError, got ${String(error)}`);
  return error;
}

describe("restoreD1Backup()", () => {
  it("creates a fresh database, imports the dump by init → PUT → ingest → poll, and finds it matches the sidecar", async () => {
    const { options, rest } = await wire();
    const report = await restoreD1Backup(options);

    expect(report).toEqual({
      databaseId: "uuid-app-db-restore-1",
      name: "app-db-restore-1",
      key: KEY,
      bookmark: "B-final",
      queries: 7,
      mismatches: [],
    });
    const imports = rest.calls.filter((call) => call.url.endsWith("/import") || call.method === "PUT");
    expect(imports.map((call) => (call.method === "PUT" ? "PUT" : (call.body as { action: string }).action))).toEqual([
      "init",
      "PUT",
      "ingest",
      "poll",
    ]);
    expect(imports[0]?.body).toEqual({ action: "init", etag: createHash("md5").update(DUMP).digest("hex") });
  });

  it("skips the upload when D1 already holds a file with the dump's md5", async () => {
    const { options, rest } = await wire({}, fakeD1Rest({ uploaded: true }));
    await restoreD1Backup(options);
    expect(rest.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("never quotes the upload URL or the uploaded file's name", async () => {
    const { options } = await wire({}, fakeD1Rest({ etag: () => "other" }));
    const error = await failure(restoreD1Backup(options));
    expect([error.kind, error.message.includes("sig=secret"), error.message.includes("secret-file")]).toEqual(["external", false, false]);
  });

  it("fails on an import D1 reports failed, naming the target", async () => {
    const { options } = await wire({}, fakeD1Rest({ importError: "UNIQUE constraint failed" }));
    const error = await failure(restoreD1Backup(options));
    expect([error.kind, error.message]).toEqual(["external", "D1 reported the import into app-db-restore-1 failed: UNIQUE constraint failed"]);
  });

  it("refuses a standby that already holds a table, before any import call", async () => {
    const rest = fakeD1Rest();
    const standby = fakeDatabase("CREATE TABLE users (id INTEGER);");
    rest.databases.set("standby-id", standby);
    const { options } = await wire({ into: { standby: "standby-id" } }, rest);
    const error = await failure(restoreD1Backup(options));
    expect([error.kind, error.message, rest.calls.some((call) => call.url.endsWith("/import"))]).toEqual([
      "invalid-args",
      "standby-id already holds users — a restore imports only into an empty database",
      false,
    ]);
  });

  it("refuses a dump with no sidecar, and one whose stored size differs from it", async () => {
    const missing = await wire();
    missing.bucket.objects.delete(KEY.replace(/\.sql$/, ".json"));
    expect((await failure(restoreD1Backup(missing.options))).kind).toBe("invalid-args");

    const truncated = await wire();
    truncated.bucket.objects.set(KEY, { bytes: new TextEncoder().encode(DUMP.slice(0, 10)) });
    const error = await failure(restoreD1Backup(truncated.options));
    expect([error.kind, error.message.includes("its sidecar recorded")]).toEqual(["invalid-args", true]);
  });

  it("refuses a dump gone from the bucket though its sidecar remains, before any import call", async () => {
    const { options, bucket, rest } = await wire();
    bucket.objects.delete(KEY);
    const error = await failure(restoreD1Backup(options));
    expect([error.kind, error.message, rest.calls.some((call) => call.url.endsWith("/import"))]).toEqual([
      "invalid-args",
      `${KEY} is gone from the bucket`,
      false,
    ]);
  });

  it("adopts a database of the same name a lost create reply already made", async () => {
    const rest = fakeD1Rest();
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      const path = new URL(url).pathname;
      if (path.endsWith("/d1/database") && init?.method === "POST") {
        await rest.fetch(url, init);
        return new Response("{}", { status: 503 });
      }
      if (url.includes("?name=")) return Response.json({ success: true, result: [{ uuid: "uuid-app-db-restore-1", name: "app-db-restore-1" }] });
      return rest.fetch(url, init);
    };
    const { options } = await wire({}, rest, fetch);
    expect((await restoreD1Backup(options)).databaseId).toBe("uuid-app-db-restore-1");
  });

  it("refuses bad options before any request", async () => {
    for (const over of [{ key: "" }, { into: { fresh: "" } }, { into: { standby: "" } }]) {
      const { options, rest } = await wire(over);
      const error = await failure(restoreD1Backup(options));
      expect([error.kind, rest.calls.length]).toEqual(["invalid-args", 0]);
    }
  });
});

describe("compareWithSidecar()", () => {
  it("names a table whose row count, the schema digest and the migration head that differ", async () => {
    const rest = fakeD1Rest();
    const target = fakeDatabase(
      'CREATE TABLE "_forge_migrations" (id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE "notes" (id INTEGER PRIMARY KEY, body TEXT);',
    );
    target.sqlite.exec("INSERT INTO notes (body) VALUES ('only one')");
    rest.databases.set("t", target);
    const { options } = await wire({}, rest);
    const mismatches = await compareWithSidecar((sql) => options.transfer.query({ databaseId: "t", name: "t" }, sql), await sidecarOf(DUMP));
    expect(mismatches[0]).toMatch(/^the schema digests [0-9a-f]{64}, but the sidecar recorded [0-9a-f]{64}$/);
    expect(mismatches.slice(1)).toEqual([
      "_forge_migrations holds 0 rows, but the dump holds 1",
      "notes holds 1 rows, but the dump holds 2",
      "the migration head is none, but the sidecar recorded 0001_notes.sql",
    ]);
  });
});
