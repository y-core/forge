import { join } from "node:path";

import type { CliIO } from "../cli/types";
import { SqlReal } from "./backup/artifact";
import { formatComposeHeader } from "./schema/header";
import type { FakeDbIo, Spawned } from "./types";

/** True when `words` occur in argv in this order, not necessarily adjacent. */
export function argvHas(args: readonly string[], ...words: string[]): boolean {
  let from = 0;
  for (const word of words) {
    const at = args.indexOf(word, from);
    if (at === -1) return false;
    from = at + 1;
  }
  return true;
}

/** The `--json` payload `d1 execute` prints for one statement's rows. */
export function jsonRows(rows: Record<string, unknown>[]): Spawned {
  return { code: 0, stdout: `${JSON.stringify([{ results: rows, success: true, meta: {} }])}\n`, stderr: "" };
}

/** The `--json` payload `d1 execute` prints for several statements, one result set each. */
export function jsonBatches(batches: readonly Record<string, unknown>[][]): Spawned {
  return { code: 0, stdout: `${JSON.stringify(batches.map((results) => ({ results, success: true, meta: {} })))}\n`, stderr: "" };
}

/**
 * One `--command` answered statement by statement, which is what wrangler does however many were batched
 * into the spawn — so a fake built this way answers a batched read and an unbatched one alike.
 */
export function routedReply(command: string, answer: (statement: string) => Record<string, unknown>[]): Spawned {
  // A batch terminates every statement and an unbatched read does not; the terminator is dropped so a
  // matcher sees the statement as its caller wrote it either way.
  return jsonBatches(command.split("\n").map((statement) => answer(statement.trim().replace(/;$/, ""))));
}

/** The one batched reply `readSchemaModel` expects: the five result sets in the order it asks for them. */
export function schemaModelReply(rows: {
  inventory?: Record<string, unknown>[];
  columns?: Record<string, unknown>[];
  indexList?: Record<string, unknown>[];
  indexColumns?: Record<string, unknown>[];
  foreignKeys?: Record<string, unknown>[];
}): Spawned {
  return jsonBatches([rows.inventory ?? [], rows.columns ?? [], rows.indexList ?? [], rows.indexColumns ?? [], rows.foreignKeys ?? []]);
}

/** The table one `pragma_table_info` statement reads, or null when the statement is not one. */
export function tableInfoAsked(statement: string): string | null {
  return /pragma_table_info\('((?:[^']|'')*)'\)/.exec(statement)?.[1]?.replaceAll("''", "'") ?? null;
}

/** The table one `sqlite_master` DDL read names, or null when the statement is not one. */
export function tableSqlAsked(statement: string): string | null {
  return /FROM sqlite_master WHERE type = 'table' AND name = '((?:[^']|'')*)'/.exec(statement)?.[1]?.replaceAll("''", "'") ?? null;
}

/** The result set a `tableSqlAsked` statement expects, empty where the table declares nothing. */
export function tableSqlReply(tableSql: string | null | undefined): Record<string, unknown>[] {
  return tableSql === null || tableSql === undefined ? [] : [{ sql: tableSql }];
}

/** What one key-probe statement asks about: the table, the key column, and which of the two probes it is. */
export function keyProbeAsked(statement: string): { table: string; column: string; asks: "nulls" | "classes" } | null {
  if (statement.includes("IS NULL LIMIT 1")) {
    return { table: /FROM "([^"]+)"/.exec(statement)?.[1] ?? "", column: /WHERE "([^"]+)" IS NULL/.exec(statement)?.[1] ?? "", asks: "nulls" };
  }
  if (!statement.includes("COUNT(DISTINCT typeof(")) return null;
  return { table: /FROM "([^"]+)"/.exec(statement)?.[1] ?? "", column: /typeof\("([^"]+)"\)/.exec(statement)?.[1] ?? "", asks: "classes" };
}

/** The result set one key probe expects, over the rows the table holds: the NULL row, or how many storage classes the column spans. */
export function keyProbeReply(asks: "nulls" | "classes", rows: readonly Record<string, unknown>[], column: string): Record<string, unknown>[] {
  if (asks === "nulls")
    return rows
      .filter((row) => row[column] === null || row[column] === undefined)
      .slice(0, 1)
      .map(() => ({ present: 1 }));
  return [{ classes: Math.max(new Set(rows.map((row) => storageClass(row[column]))).size, 1) }];
}

function storageClass(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof SqlReal) return "real";
  if (Array.isArray(value)) return "blob";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "real";
  return "text";
}

/** Stored rows as the self-describing projection of `verificationSelect` returns them: value, then `typeof`. */
export function projectReadRows(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(row)) {
      const type = storageClass(value);
      projected[name] =
        type === "blob"
          ? (value as readonly number[])
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join("")
              .toUpperCase()
          : value instanceof SqlReal
            ? value.value
            : value;
      projected[`forge:type:${name}`] = type;
    }
    return projected;
  });
}

/** A successful run with nothing to say. */
export const OK: Spawned = { code: 0, stdout: "", stderr: "" };

/** Builds a fake `DbIo` with an optional seed filesystem. Unmatched wrangler calls fail loudly. */
export function fakeDbIo(seed: Record<string, string> = {}, options: { now?: Date; env?: Record<string, string> } = {}): FakeDbIo {
  const files = new Map(Object.entries(seed));
  const dirs = new Set<string>();
  const io: FakeDbIo = {
    files,
    calls: [],
    logs: [],
    rules: [],
    spawn(cmd, args) {
      io.calls.push([cmd, ...args]);
      for (const rule of io.rules) {
        if (rule.match(args)) return typeof rule.reply === "function" ? rule.reply(args) : rule.reply;
      }
      return { code: 1, stdout: "", stderr: `fake wrangler: no rule matches ${cmd} ${args.join(" ")}` };
    },
    exists: (p) => files.has(p) || dirs.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
    readText: (p) => {
      const text = files.get(p);
      if (text === undefined) throw new Error(`ENOENT: ${p}`);
      return text;
    },
    writeText: (p, text) => {
      files.set(p, text);
    },
    createExclusive: (p, text) => {
      if (files.has(p)) return false;
      files.set(p, text);
      return true;
    },
    readDir: (p) => {
      const prefix = `${p}/`;
      const names = new Set<string>();
      for (const key of files.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0] ?? "");
      for (const dir of dirs) if (dir.startsWith(prefix)) names.add(dir.slice(prefix.length).split("/")[0] ?? "");
      if (names.size === 0 && !dirs.has(p)) throw new Error(`ENOENT: ${p}`);
      return [...names].filter((n) => n !== "").sort();
    },
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files.set(to, text);
      files.delete(from);
    },
    mkdir: (p) => {
      dirs.add(p);
    },
    remove: (p) => {
      for (const key of [...files.keys()]) if (key === p || key.startsWith(`${p}/`)) files.delete(key);
      for (const dir of [...dirs]) if (dir === p || dir.startsWith(`${p}/`)) dirs.delete(dir);
    },
    mtime: (p) => (files.has(p) ? (options.now ?? new Date()).getTime() : null),
    now: () => options.now ?? new Date("2026-09-11T10:00:00Z"),
    env: options.env ?? {},
    log: (line) => {
      io.logs.push(line);
    },
  };
  return io;
}

/** A `CliIO` that buffers both streams and throws on `exit`, so a command runs in-process. */
export function bufferedIO(): CliIO & { out: string[]; err: string[]; code: number | null } {
  const buffer = {
    out: [] as string[],
    err: [] as string[],
    code: null as number | null,
    stdout: (msg: string) => {
      buffer.out.push(msg);
    },
    stderr: (msg: string) => {
      buffer.err.push(msg);
    },
    exit: (code: number): never => {
      buffer.code = code;
      throw new Error(`exit ${code}`);
    },
  };
  return buffer;
}

/** A minimal `wrangler.jsonc` naming one database, for a temp root. */
export function minimalWranglerConfig(root: string, over: Record<string, unknown> = {}): { path: string; text: string } {
  const config = {
    name: "app",
    compatibility_date: "2026-01-01",
    d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
    ...over,
  };
  return { path: join(root, "wrangler.jsonc"), text: `${JSON.stringify(config, null, 2)}\n` };
}

/** A migration file as compose writes one: the DDL under a valid generated stamp, since an unstamped one carrying DDL is a lint error. @internal */
export function composed(body: string): string {
  const sql = body.endsWith("\n") ? body : `${body}\n`;
  return `${formatComposeHeader({ desired: {}, baseline: "", forge: "0.0.0" }, sql)}${sql}`;
}
