import { join } from "node:path";
import process from "node:process";
import { PassThrough } from "node:stream";

import type { FakeBackupBucket } from "../../storage/backup/backup.fixture";
import { cutSqlStatements } from "../../storage/backup/split";
import type { CfAuth } from "../cf/types";
import { CliError } from "../cli/errors";
import type { CliIO } from "../cli/types";
import { persistRoot } from "./home";
import { SqlReal } from "./literal";
import { formatComposeHeader } from "./schema/header";
import { schemaModelSelects } from "./schema/introspect";
import type { FakeDbIo, FakeRestRule, Home } from "./types";

/** The rows one statement of `readSchemaModel`'s batch answers with, by which read it is. */
export function schemaModelRows(
  statement: string,
  rows: {
    inventory?: Record<string, unknown>[];
    columns?: Record<string, unknown>[];
    indexList?: Record<string, unknown>[];
    indexColumns?: Record<string, unknown>[];
    foreignKeys?: Record<string, unknown>[];
  },
): Record<string, unknown>[] {
  const selects = schemaModelSelects();
  if (statement === selects.inventory) return rows.inventory ?? [];
  if (statement === selects.columns) return rows.columns ?? [];
  if (statement === selects.indexList) return rows.indexList ?? [];
  if (statement === selects.indexColumns) return rows.indexColumns ?? [];
  if (statement === selects.foreignKeys) return rows.foreignKeys ?? [];
  return [];
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

/** What one key-probe statement asks about: the table, the key column, and which probe it is. */
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

function sqlOrder(left: unknown, right: unknown): number {
  const plain = (value: unknown) => (value instanceof SqlReal ? value.value : (value ?? null));
  const a = plain(left);
  const b = plain(right);
  const rank = (value: unknown) => (value === null ? 0 : typeof value === "number" ? 1 : Array.isArray(value) ? 3 : 2);
  if (rank(a) !== rank(b)) return Math.sign(rank(a) - rank(b));
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  const units = (value: unknown): number[] =>
    Array.isArray(value) ? (value as number[]) : [...String(value)].map((char) => char.codePointAt(0) ?? 0);
  const [x, y] = [units(a), units(b)];
  for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
    if (x[index] !== y[index]) return Math.sign((x[index] ?? 0) - (y[index] ?? 0));
  }
  return Math.sign(x.length - y.length);
}

function rowOrder(left: readonly unknown[], right: readonly unknown[]): number {
  for (const [index, cell] of left.entries()) {
    const order = sqlOrder(cell, right[index]);
    if (order !== 0) return order;
  }
  return 0;
}

const KEY_REF = /t\."((?:[^"]|"")+)"/g;

const LITERAL = /X'([0-9a-fA-F]*)'|'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function sqlLiterals(text: string): unknown[] {
  return [...text.matchAll(LITERAL)].map(([, hex, quoted, number]) =>
    hex !== undefined
      ? (hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))
      : quoted !== undefined
        ? quoted.replaceAll("''", "'")
        : Number(number),
  );
}

/** The page a keyset read of `tables` answers, sought and ordered as SQLite would — a row-value seek included; null when the statement is not one. */
export function keysetPageReply(
  statement: string,
  tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): Record<string, unknown>[] | null {
  const shape =
    /FROM "((?:[^"]|"")+)" AS t(?: WHERE (\(t\.".*?"\)|t\."(?:[^"]|"")+") > (.*?))? ORDER BY ((?:t\."(?:[^"]|"")+"(?:, )?)+) LIMIT (\d+)$/.exec(
      statement,
    );
  if (shape === null) return null;
  const [, table = "", seekKeys, seekLiterals, orderKeys = "", limit = "0"] = shape;
  const names = (text: string) => [...text.matchAll(KEY_REF)].map(([, name = ""]) => name.replaceAll('""', '"'));
  const order = names(orderKeys);
  const sought = seekKeys === undefined ? [] : names(seekKeys);
  const after = seekLiterals === undefined ? [] : sqlLiterals(seekLiterals);
  if (sought.length !== after.length) throw new Error(`fake keyset read: ${sought.length} key(s) sought past ${after.length} literal(s)`);
  const rows = [...(tables[table.replaceAll('""', '"')] ?? [])]
    .filter(
      (row) =>
        sought.length === 0 ||
        rowOrder(
          sought.map((key) => row[key]),
          after,
        ) > 0,
    )
    .sort((left, right) =>
      rowOrder(
        order.map((key) => left[key]),
        order.map((key) => right[key]),
      ),
    );
  return projectReadRows(rows.slice(0, Number(limit)));
}

/** `bytes` as a stream of small chunks, so a reader that needs the whole body at once is caught. */
export function chunkedStream(bytes: Uint8Array, size = 4096): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

/** The rows the fake answers one statement with: the first rule that matches it, else none — a statement writing rows answers none. */
function answerStatement(io: FakeDbIo, statement: string, home: Home): Record<string, unknown>[] {
  for (const rule of io.d1Rules) {
    if (rule.match(statement, home)) return typeof rule.reply === "function" ? rule.reply(statement, home) : rule.reply;
  }
  return [];
}

/** The credentials a deployed home carries, set to values a test can look for. */
export const REMOTE_AUTH: CfAuth = { accountId: "acct", apiToken: "tok" };

/** The flags that supply `REMOTE_AUTH` to a verb aimed at a deployed place. */
export const REMOTE_FLAGS = { "account-id": "acct", "api-token": "tok" };

/** `REMOTE_FLAGS` as the argv a command line passes them in. */
export const REMOTE_ARGS = ["--account-id", "acct", "--api-token", "tok"];

/** A Cloudflare success envelope carrying `result`. */
export function cfEnvelope(result: unknown, status = 200): Response {
  return Response.json({ success: true, errors: [], messages: [], result }, { status });
}

/** A Cloudflare failure envelope carrying one error. */
export function cfRefusal(code: number, message: string, status = 400): Response {
  return Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status });
}

function requestBody(init: RequestInit | undefined): string | null {
  return typeof init?.body === "string" ? init.body : null;
}

/** A D1 `/query` POST answered through the same `d1Rules` a local statement is, by the home whose `databaseId` the path names. */
function answerQuery(io: FakeDbIo, homes: readonly Home[], path: string, body: string | null): Response {
  const databaseId = decodeURIComponent(/\/d1\/database\/([^/]+)\/query$/.exec(path)?.[1] ?? "");
  const home = homes.find((candidate) => candidate.databaseId === databaseId);
  if (home === undefined) return cfRefusal(7003, `fake cloudflare: no home has the D1 id ${databaseId}`, 404);
  const parsed = JSON.parse(body ?? "{}") as { sql?: string; batch?: { sql: string }[] };
  const statements =
    parsed.batch === undefined ? cutSqlStatements(parsed.sql ?? "") : parsed.batch.map(({ sql }) => cutSqlStatements(sql)[0] ?? sql);
  try {
    return cfEnvelope(statements.map((statement) => ({ results: answerStatement(io, statement, home), success: true, meta: {} })));
  } catch (error) {
    return cfRefusal(7500, error instanceof Error ? error.message : String(error));
  }
}

const R2_OBJECTS = /\/r2\/buckets\/[^/]+\/objects(?:\/(.+))?$/;

/** Cloudflare's REST R2 object endpoints over `bucket`: a listing paged as the bucket pages, and each body served in small chunks. */
export function r2RestRules(bucket: FakeBackupBucket): FakeRestRule[] {
  return [
    {
      match: (url) => R2_OBJECTS.test(new URL(url).pathname),
      reply: async (url, init) => {
        const parsed = new URL(url);
        const encoded = R2_OBJECTS.exec(parsed.pathname)?.[1];
        if (encoded === undefined) {
          const cursor = parsed.searchParams.get("cursor");
          const page = await bucket.list({ prefix: parsed.searchParams.get("prefix") ?? "", ...(cursor === null ? {} : { cursor }) });
          return Response.json({
            success: true,
            errors: [],
            messages: [],
            result: page.objects.map((object) => ({ ...object, etag: "etag" })),
            result_info: { per_page: Number(parsed.searchParams.get("per_page")), is_truncated: page.truncated, cursor: page.cursor ?? "" },
          });
        }
        const key = encoded.split("/").map(decodeURIComponent).join("/");
        if (init?.method === "PUT") {
          await bucket.put(key, init.body as string | Uint8Array | ReadableStream<Uint8Array>);
          return cfEnvelope({ key });
        }
        if (init?.method === "DELETE") {
          await bucket.delete(key);
          return cfEnvelope({});
        }
        const stored = bucket.objects.get(key);
        if (stored === undefined) return cfRefusal(10007, "The specified key does not exist.", 404);
        return new Response(chunkedStream(stored.bytes, 7), { headers: { "content-length": String(stored.bytes.byteLength) } });
      },
    },
  ];
}

/** Builds a fake `DbIo` with an optional seed filesystem. Unmatched Cloudflare requests fail loudly. */
export function fakeDbIo(
  seed: Record<string, string> = {},
  options: { now?: Date; env?: Record<string, string>; homes?: readonly Home[] } = {},
): FakeDbIo {
  const files = new Map(Object.entries(seed));
  const dirs = new Set<string>();
  const startedAt = options.now ?? new Date("2026-09-11T10:00:00Z");
  let elapsedMs = 0;
  const io: FakeDbIo = {
    files,
    logs: [],
    d1Calls: [],
    d1Rules: [],
    restRules: [],
    restCalls: [],
    closed: [],
    slept: [],
    d1(home, sql) {
      const statements = sql.flatMap((text) => cutSqlStatements(text));
      const source = sql.length === 1 ? ([...files].find(([, text]) => text === sql[0])?.[0] ?? null) : null;
      io.d1Calls.push({ home: home.label, place: home.place, persistTo: persistRoot(home), statements, source });
      return Promise.resolve(statements.map((statement) => answerStatement(io, statement, home)));
    },
    splitD1: (_home, sql) => Promise.resolve(cutSqlStatements(sql)),
    buckets: new Map(),
    bucket(home, binding) {
      const bucket = io.buckets.get(binding);
      if (bucket === undefined)
        return Promise.reject(new CliError("invalid-args", `${home.configPath} declares no r2_buckets binding named ${binding}`));
      return Promise.resolve(bucket);
    },
    closeD1(home) {
      io.closed.push(home === null ? "*" : persistRoot(home));
      return Promise.resolve();
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
    readStream: (p) => {
      const text = files.get(p);
      if (text === undefined) throw new Error(`ENOENT: ${p}`);
      return chunkedStream(new TextEncoder().encode(text));
    },
    writeStream: async (p, body) => {
      files.set(p, await new Response(body).text());
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
    now: () => new Date(startedAt.getTime() + elapsedMs),
    sleep: (ms) => {
      io.slept.push(ms);
      elapsedMs += ms;
      return Promise.resolve();
    },
    env: options.env ?? {},
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? "GET";
      const body = requestBody(init);
      io.restCalls.push({ url, method, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
      for (const rule of io.restRules) {
        if (rule.match(url, init)) return typeof rule.reply === "function" ? rule.reply(url, init) : rule.reply.clone();
      }
      const path = new URL(url).pathname;
      if (method === "POST" && path.endsWith("/query")) return answerQuery(io, options.homes ?? [], path, body);
      return cfRefusal(7003, `fake cloudflare: no rule matches ${method} ${path}`, 404);
    },
    wranglerVersion: () => "4.151.2",
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
    d1_databases: [
      { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
    ],
    ...over,
  };
  return { path: join(root, "wrangler.jsonc"), text: `${JSON.stringify(config, null, 2)}\n` };
}

/** A migration file as compose writes one: the body under a valid compose stamp, which every verb requires of a pending file. @internal */
export function composed(body: string): string {
  const sql = body.endsWith("\n") ? body : `${body}\n`;
  return `${formatComposeHeader({ desired: {}, baseline: "", forge: "0.0.0" }, sql)}${sql}`;
}

/** Runs `body` with `process.stdin` a stream answering `answer`, a terminal when `tty`, and returns what the prompt wrote to stdout. */
export async function onStdin<T>(tty: boolean, answer: string, body: () => Promise<T>): Promise<{ prompted: string; value: T }> {
  const saved = { stdin: Object.getOwnPropertyDescriptor(process, "stdin"), stdout: Object.getOwnPropertyDescriptor(process, "stdout") };
  const input = Object.assign(new PassThrough(), { isTTY: tty });
  const output = new PassThrough();
  const chunks: string[] = [];
  output.write = (chunk: unknown) => chunks.push(String(chunk)) > 0;
  input.write(`${answer}\n`);
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  Object.defineProperty(process, "stdout", { value: output, configurable: true });
  try {
    const value = await body();
    return { prompted: chunks.join(""), value };
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) if (descriptor !== undefined) Object.defineProperty(process, name, descriptor);
  }
}
