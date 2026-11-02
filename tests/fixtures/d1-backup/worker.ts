import { D1BackupError, readD1Backup, runD1Backup, runD1Restore, type BackupWorkflowStep } from "../../../src/storage/backup/mod";

interface Env {
  readonly DB: D1Database;
  readonly STANDBY: D1Database;
  readonly BACKUPS: R2Bucket;
}

const step: BackupWorkflowStep = { do: (_name, _config, callback) => callback() };

const SEED = [
  "CREATE TABLE IF NOT EXISTS _forge_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  "INSERT INTO _forge_migrations (name) VALUES ('0001_notes.sql')",
  "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)",
  "INSERT INTO notes (body) VALUES ('one'), ('two' || char(10) || 'lines'), ('three'), ('four\\nliteral')",
  "ANALYZE",
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/seed") {
      await env.DB.batch(SEED.map((sql) => env.DB.prepare(sql)));
      return new Response(null, { status: 204 });
    }
    if (path === "/backup") {
      const sidecar = await runD1Backup(step, {
        accountId: "",
        apiToken: "",
        databaseId: "backup-fixture-local",
        bucket: env.BACKUPS,
        database: env.DB,
        at: new Date("2026-11-02T03:00:00Z"),
      }).catch((error: unknown) => {
        if (error instanceof D1BackupError) return { kind: error.kind, message: error.message };
        throw error;
      });
      if ("kind" in sidecar) return Response.json(sidecar, { status: 422 });
      const dump = await env.BACKUPS.get(sidecar.key);
      return Response.json({ sidecar, read: await readD1Backup(env.BACKUPS, sidecar.key), dump: await dump?.text() });
    }
    if (path === "/restore") {
      const key = new URL(request.url).searchParams.get("key") ?? "";
      const report = await runD1Restore(step, {
        accountId: "",
        apiToken: "",
        bucket: env.BACKUPS,
        key,
        into: { standby: "backup-fixture-standby", database: env.STANDBY },
      }).catch((error: unknown) => {
        if (error instanceof D1BackupError) return { kind: error.kind, message: error.message };
        throw error;
      });
      if ("kind" in report) return Response.json(report, { status: 422 });
      const notes = await env.STANDBY.prepare("SELECT id, body FROM notes ORDER BY id").all();
      return Response.json({ report, notes: notes.results });
    }
    return new Response("not found", { status: 404 });
  },
};
