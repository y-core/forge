import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

import { splitDumpStatements } from "./split";
import type {
  BackupBucket,
  BackupDatabase,
  BackupMultipartUpload,
  BackupStatement,
  BackupStepConfig,
  BackupUploadedPart,
  BackupWorkflowStep,
} from "./types";

/** An in-memory bucket recording every multipart upload, with listing paged by `pageSize`. */
export interface FakeBackupBucket extends BackupBucket {
  readonly objects: Map<string, { bytes: Uint8Array; customMetadata: Record<string, string> }>;
  readonly aborted: string[];
  readonly partSizes: number[];
  readonly deleted: string[][];
  failPart?: number;
}

export function fakeBackupBucket(pageSize = 1000): FakeBackupBucket {
  const bucket: FakeBackupBucket = {
    objects: new Map(),
    aborted: [],
    partSizes: [],
    deleted: [],
    async put(key, value) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value.slice()
            : new Uint8Array(await new Response(value).arrayBuffer());
      bucket.objects.set(key, { bytes, customMetadata: {} });
      return {};
    },
    async get(key) {
      const stored = bucket.objects.get(key);
      if (stored === undefined) return null;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(stored.bytes.slice());
          controller.close();
        },
      });
      return { size: stored.bytes.byteLength, body, text: async () => new TextDecoder().decode(stored.bytes) };
    },
    async createMultipartUpload(key, options) {
      const parts = new Map<number, Uint8Array>();
      const upload: BackupMultipartUpload = {
        async uploadPart(partNumber, value): Promise<BackupUploadedPart> {
          if (bucket.failPart === partNumber) throw new Error(`fake r2: part ${partNumber} refused`);
          parts.set(partNumber, value.slice());
          bucket.partSizes.push(value.byteLength);
          return { partNumber, etag: `etag-${partNumber}` };
        },
        async complete(uploaded) {
          const ordered = uploaded.map((part) => parts.get(part.partNumber) ?? new Uint8Array());
          const bytes = new Uint8Array(ordered.reduce((sum, part) => sum + part.byteLength, 0));
          let offset = 0;
          for (const part of ordered) {
            bytes.set(part, offset);
            offset += part.byteLength;
          }
          bucket.objects.set(key, { bytes, customMetadata: options?.customMetadata ?? {} });
          return {};
        },
        async abort() {
          bucket.aborted.push(key);
        },
      };
      return upload;
    },
    async list(options) {
      const keys = [...bucket.objects.keys()].filter((key) => key.startsWith(options?.prefix ?? "")).sort();
      const start = options?.cursor === undefined ? 0 : Number(options.cursor);
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      const objects = page.map((key) => ({ key, size: bucket.objects.get(key)?.bytes.byteLength ?? 0 }));
      return truncated ? { objects, truncated, cursor: String(start + pageSize) } : { objects, truncated };
    },
    async delete(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      bucket.deleted.push([...list]);
      for (const key of list) bucket.objects.delete(key);
    },
  };
  return bucket;
}

/** A step that runs each callback once, recording the name and config it was given. */
export function fakeStep(): BackupWorkflowStep & { readonly ran: { name: string; config: BackupStepConfig; result: unknown }[] } {
  const ran: { name: string; config: BackupStepConfig; result: unknown }[] = [];
  return {
    ran,
    async do<T>(name: string, config: BackupStepConfig, callback: () => Promise<T>): Promise<T> {
      const result = await callback();
      ran.push({ name, config, result });
      return result;
    },
  };
}

/** A Cloudflare success envelope around an export state. */
export function exportReply(result: unknown, status = 200): Response {
  return Response.json({ success: true, errors: [], messages: [], result }, { status });
}

/** Installs workerd's `crypto.DigestStream` on Bun's `crypto`, hashing with node's incremental hashes. */
export function installDigestStream(): void {
  if (crypto.DigestStream !== undefined) return;
  class DigestStream extends WritableStream<ArrayBufferView> {
    readonly digest: Promise<ArrayBuffer>;
    constructor(algorithm: string) {
      const hash = createHash(algorithm.replace("-", "").toLowerCase());
      let resolve: (digest: ArrayBuffer) => void = () => {};
      const digest = new Promise<ArrayBuffer>((done) => (resolve = done));
      super({
        write: (chunk) => void hash.update(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
        close: () => resolve(new Uint8Array(hash.digest()).buffer),
      });
      this.digest = digest;
    }
  }
  Object.defineProperty(crypto, "DigestStream", { value: DigestStream, configurable: true });
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

/** A binding whose every query answers `results`, and whose miniflare export answers `dump`. */
export function stubDatabase(results: Record<string, unknown>[], dump: unknown[][] = []): BackupDatabase {
  return { prepare: () => ({ all: async () => ({ results }), bind: () => ({ raw: async () => dump }) }), batch: async () => [] };
}

/** D1's REST API over one in-memory SQLite target per database id: create, get, query, and the import's init → PUT → ingest → poll. */
export function fakeD1Rest(options: { uploaded?: boolean; importError?: string; etag?: (md5: string) => string } = {}) {
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
      databases.set(`uuid-${name}`, fakeDatabase());
      return envelope({ uuid: `uuid-${name}`, name });
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
