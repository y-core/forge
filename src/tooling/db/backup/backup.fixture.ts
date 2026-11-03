import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

import { splitDumpStatements } from "./split";
import type { BackupDatabase, BackupStatement } from "./types";

/** A Cloudflare success envelope around an export state. */
export function exportReply(result: unknown, status = 200): Response {
  return Response.json({ success: true, errors: [], messages: [], result }, { status });
}

/** An in-memory SQLite database behind D1's `prepare`/`batch` surface, built from `schema`, recording each batch's size. */
export function fakeDatabase(schema = ""): BackupDatabase & { readonly sqlite: Database; readonly batches: number[] } {
  const sqlite = new Database(":memory:");
  if (schema.trim() !== "") sqlite.exec(schema);
  const sql = new WeakMap<BackupStatement, string>();
  const batches: number[] = [];
  return {
    sqlite,
    batches,
    prepare(query) {
      const statement: BackupStatement = {
        all: async () => ({ results: sqlite.query(query).all() as Record<string, unknown>[] }),
        bind: (...values: unknown[]) => ({
          raw: async () => (sqlite.query(query).all(...(values as never[])) as Record<string, unknown>[]).map((row) => Object.values(row)),
        }),
      };
      sql.set(statement, query);
      return statement;
    },
    async batch(statements) {
      batches.push(statements.length);
      sqlite.transaction(() => {
        for (const statement of statements) sqlite.exec(sql.get(statement) ?? "");
      })();
      return [];
    },
  };
}

/** Per column of `table`, how many rows hold another value in `after` than in `before`: rows paired by rowid, values compared as SQLite's `quote()` writes them. */
export function changedCells(before: Database, after: Database, table: string): Record<string, number> {
  const read = (db: Database) => {
    const columns = (db.query(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((row) => row.name);
    const select = `SELECT rowid AS "rowid", ${columns.map((c) => `quote("${c}") AS "${c}"`).join(", ")} FROM "${table}"`;
    return { columns, rows: new Map((db.query(select).all() as Record<string, unknown>[]).map((row) => [row.rowid, row])) };
  };
  const a = read(before);
  const b = read(after);
  const changed: Record<string, number> = {};
  for (const rowid of new Set([...a.rows.keys(), ...b.rows.keys()])) {
    for (const column of new Set([...a.columns, ...b.columns])) {
      if (a.rows.get(rowid)?.[column] !== b.rows.get(rowid)?.[column]) changed[column] = (changed[column] ?? 0) + 1;
    }
  }
  return changed;
}

/** A binding whose every query answers `results`, and whose miniflare export answers `dump`. */
export function stubDatabase(results: Record<string, unknown>[], dump: unknown[][] = []): BackupDatabase {
  return { prepare: () => ({ all: async () => ({ results }), bind: () => ({ raw: async () => dump }) }), batch: async () => [] };
}

/** D1's REST API over one in-memory SQLite target per database id, `id` naming a created one: create, get, query, and the import's init → PUT → ingest → poll. */
export function fakeD1Rest(
  options: { uploaded?: boolean; importError?: string; etag?: (md5: string) => string; id?: (name: string) => string } = {},
) {
  const databases = new Map<string, ReturnType<typeof fakeDatabase>>();
  const calls: { method: string; url: string; body: unknown }[] = [];
  let pending: string | null = null;
  const envelope = (result: unknown, status = 200) => Response.json({ success: true, errors: [], messages: [], result }, { status });
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    if (url === "https://upload.example.com/put?sig=secret") {
      pending = await new Response(init?.body).text();
      calls.push({ method, url, body: null });
      const md5 = createHash("md5").update(pending).digest("hex");
      return new Response(null, { status: 200, headers: { etag: `"${options.etag?.(md5) ?? md5}"` } });
    }
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, url, body });
    const path = new URL(url).pathname.replace("/client/v4/accounts/acct/d1/database", "");
    if (path === "" && method === "POST") {
      const name = String(body?.name);
      const uuid = options.id?.(name) ?? `uuid-${name}`;
      databases.set(uuid, fakeDatabase());
      return envelope({ uuid, name });
    }
    const [, id = "", action] = path.split("/");
    const target = databases.get(id);
    if (target === undefined) return new Response("{}", { status: 404 });
    if (action === undefined && method === "GET") return envelope({ uuid: id, name: id });
    if (action === "query") return envelope([{ results: target.sqlite.query(String(body?.sql)).all(), success: true }]);
    if (body?.action === "init") {
      if (options.uploaded === true) return envelope({ success: true, status: "active", at_bookmark: "B-import" });
      return envelope({ upload_url: "https://upload.example.com/put?sig=secret", filename: "secret-file.sql" });
    }
    if (body?.action === "ingest" || body?.action === "poll") {
      if (body.action === "ingest") return envelope({ success: true, status: "active", at_bookmark: "B-import" });
      if (options.importError !== undefined) return envelope({ success: false, status: "error", error: options.importError });
      const statements = pending === null ? [] : splitDumpStatements(pending);
      target.sqlite.transaction(() => {
        for (const statement of statements) target.sqlite.exec(statement);
      })();
      return envelope({ success: true, status: "complete", result: { num_queries: statements.length, final_bookmark: "B-final" } });
    }
    return new Response("{}", { status: 400 });
  };
  return { fetch, calls, databases };
}
