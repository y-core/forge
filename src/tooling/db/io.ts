import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";

import type { BackupBucket } from "../../storage/backup/types";
import { retryWithBackoff } from "../../storage/db/retry";
import type { D1DatabaseLike } from "../../storage/db/types";
import type { D1RetryPolicy } from "../../storage/db/types";
import { CliError } from "../cli/errors";
import { cutSqlStatements } from "./backup/split";
import type { BackupDatabase } from "./backup/types";
import { persistRoot } from "./home";
import { isReadOnlyBatch } from "./sql";
import type { DbIo, Home, WranglerD1Module } from "./types";

interface LocalD1 {
  readonly db: D1DatabaseLike;
  readonly env: Readonly<Record<string, unknown>>;
  readonly dispose: () => Promise<void>;
}

function refuseDeployedHome(home: Home): CliError {
  return new CliError("invalid-args", `${home.label} (${home.database}) is deployed, and nothing reaches a deployed database in process`);
}

function handleKey(home: Home): string {
  return `${home.configPath}\0${home.env ?? ""}\0${persistRoot(home)}`;
}

/** Why wrangler could not answer: the export a loaded module lacks, or the error thrown by one that would not load. @internal */
export function wranglerUnreachable(home: Home, refusal: { readonly missing: string } | { readonly error: unknown }): CliError {
  const reach = `\`forge db\` reaches ${home.label} (${home.database}) through it`;
  if ("missing" in refusal) return new CliError("external", `wrangler is not installed, or is too old to export ${refusal.missing} — ${reach}`);
  const detail = (refusal.error instanceof Error ? refusal.error.message : String(refusal.error)).trim().slice(0, 4000);
  return new CliError("external", `wrangler would not load — ${reach}${detail ? `:\n${detail}` : ""}`, { cause: refusal.error });
}

/** The export `forge db` needs that a loaded wrangler does not have, or `null` when it has it. @internal */
export function missingWranglerExport(module: { getPlatformProxy?: unknown }): string | null {
  return module.getPlatformProxy === undefined ? "getPlatformProxy" : null;
}

const READ_CHUNK_BYTES = 64 * 1024;

function readStreamFromFile(path: string): ReadableStream<Uint8Array> {
  const opening = open(path, "r");
  return new ReadableStream<Uint8Array>({
    async start() {
      await opening;
    },
    async pull(controller) {
      const file = await opening;
      const buffer = new Uint8Array(READ_CHUNK_BYTES);
      const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, null).catch(async (error: unknown) => {
        await file.close();
        throw error;
      });
      if (bytesRead > 0) return controller.enqueue(buffer.subarray(0, bytesRead));
      await file.close();
      controller.close();
    },
    async cancel() {
      await (await opening).close();
    },
  });
}

type ProxyBucket = Omit<BackupBucket, "get"> & { get(key: string): Promise<{ readonly size: number; arrayBuffer(): Promise<ArrayBuffer> } | null> };

// Under Bun the platform proxy's R2 body throws `DataCloneError` on any read, while `arrayBuffer()` works, so a local object is read whole.
function wholeBodies(bucket: ProxyBucket): BackupBucket {
  return {
    put: (key, value, options) => bucket.put(key, value, options),
    list: (options) => bucket.list(options),
    delete: (keys) => bucket.delete(keys),
    async get(key) {
      const object = await bucket.get(key);
      if (object === null) return null;
      const bytes = new Uint8Array(await object.arrayBuffer());
      return { size: object.size, body: new Blob([bytes]).stream(), text: async () => new TextDecoder().decode(bytes) };
    },
  };
}

async function writeStreamToFile(path: string, body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  let file: FileHandle;
  try {
    // Removed first, so a shorter body never leaves a longer file's tail behind it.
    rmSync(path, { force: true });
    file = await open(path, "wx", 0o600);
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await file.write(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
    await file.close();
  }
}

/** The `version` a loaded wrangler `package.json` declares, or `unknown` when it declares none or will not load. @internal */
export function installedWranglerVersion(load: () => unknown): string {
  try {
    const manifest = load() as { version?: unknown } | null;
    return typeof manifest?.version === "string" && manifest.version !== "" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Five tries of a refused batch, each wait a random share of 100 ms doubling up to 800 ms. @internal */
export const D1_BUSY_BACKOFF: D1RetryPolicy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 800 };

// workerd logs the SQLITE_BUSY behind this to its own stderr alone; what reaches this process is
// D1's opaque internal error, with no cause naming the lock.
/** True for the error a local D1 answers a batch with when another process held the database's lock. @internal */
export function isD1BusyRefusal(error: unknown): boolean {
  return error instanceof Error && /^D1_ERROR: .*\binternal error; reference = \w+/s.test(error.message);
}

async function openLocalD1(home: Home, loadWrangler: () => Promise<WranglerD1Module>): Promise<LocalD1> {
  // In process, wrangler's own logger writes to this tool's stderr, and its chatter is not forge's output.
  process.env.WRANGLER_LOG ??= "error";
  const wrangler = await loadWrangler().catch((error: unknown) => {
    throw wranglerUnreachable(home, { error });
  });
  const missing = missingWranglerExport(wrangler);
  if (missing !== null) throw wranglerUnreachable(home, { missing });
  const { getPlatformProxy } = wrangler as Required<WranglerD1Module>;
  const proxy = await getPlatformProxy<Record<string, D1DatabaseLike>>({
    configPath: home.configPath,
    ...(home.env === null ? {} : { environment: home.env }),
    persist: { path: persistRoot(home) },
    // Stated, never defaulted: `remoteBindings` is true by default, and a binding marked remote
    // would open a network session from a handle that answers for local state alone.
    remoteBindings: false,
    envFiles: [],
  });
  const db = proxy.env[home.binding];
  if (db === undefined) {
    await proxy.dispose();
    throw new CliError("invalid-args", `${home.configPath} declares no d1_databases binding named ${home.binding}`);
  }
  return { db, env: proxy.env, dispose: proxy.dispose };
}

/** The real side effects: node's filesystem, wrangler's in-process D1, and the process environment. @internal */
export function realDbIo(
  log: (line: string) => void = (line) => console.error(line),
  // Imported rather than named at the top: wrangler is an optional peer, and a static import would
  // fail a consumer that installed forge without it before any verb could say so.
  loadWrangler: () => Promise<WranglerD1Module> = () => import("wrangler"),
): DbIo {
  const handles = new Map<string, Promise<LocalD1>>();
  const answered = new Set<string>();

  function reach(home: Home, key: string): Promise<LocalD1> {
    const held = handles.get(key);
    if (held !== undefined) return held;
    const opening = openLocalD1(home, loadWrangler);
    handles.set(key, opening);
    void opening.catch(() => handles.delete(key));
    return opening;
  }

  async function release(key: string): Promise<void> {
    const opening = handles.get(key);
    if (opening === undefined) return;
    handles.delete(key);
    answered.delete(key);
    await opening.then(
      (handle) => handle.dispose().catch((error: unknown) => log(`could not release the handle over ${key.split("\0")[2] ?? key}: ${error}`)),
      () => {},
    );
  }

  return {
    async d1(home, sql): Promise<Record<string, unknown>[][]> {
      if (home.persistTo === null) throw refuseDeployedHome(home);
      const key = handleKey(home);
      const fresh = !answered.has(key);
      let readOnly = false;
      const answers = await retryWithBackoff(
        async (tried) => {
          // Nothing says workerd's D1 object reopens a database it failed to open, so a retry starts a new one.
          if (tried > 1) await release(key);
          const handle = await reach(home, key);
          const statements = sql.flatMap((text) => cutSqlStatements(text));
          if (statements.length === 0) return [];
          readOnly = isReadOnlyBatch(statements);
          const batch = handle.db.batch<Record<string, unknown>>(statements.map((statement) => handle.db.prepare(statement)));
          const settled = await batch.catch((error: unknown) => {
            if (!isD1BusyRefusal(error)) answered.add(key);
            throw error;
          });
          answered.add(key);
          return settled;
        },
        // A write batch on a handle that has answered may have committed before the refusal.
        (error) => isD1BusyRefusal(error) && (fresh || readOnly),
        D1_BUSY_BACKOFF,
      );
      return answers.map((answer) => answer.results);
    },
    async splitD1(home, sql): Promise<string[]> {
      if (home.persistTo === null) throw refuseDeployedHome(home);
      return cutSqlStatements(sql);
    },
    async bucket(home, binding): Promise<BackupBucket> {
      if (home.persistTo === null) throw refuseDeployedHome(home);
      const bucket = (await reach(home, handleKey(home))).env[binding] as Partial<BackupBucket> | undefined;
      if (typeof bucket?.list !== "function" || typeof bucket.get !== "function") {
        throw new CliError("invalid-args", `${home.configPath} declares no r2_buckets binding named ${binding}`);
      }
      return wholeBodies(bucket as ProxyBucket);
    },
    async database(home, binding): Promise<BackupDatabase> {
      if (home.persistTo === null) throw refuseDeployedHome(home);
      const database = (await reach(home, handleKey(home))).env[binding] as Partial<BackupDatabase> | undefined;
      if (typeof database?.prepare !== "function" || typeof database.batch !== "function") {
        throw new CliError("invalid-args", `${home.configPath} declares no d1_databases binding named ${binding}`);
      }
      return database as BackupDatabase;
    },
    async closeD1(home): Promise<void> {
      for (const key of home === null ? [...handles.keys()] : [handleKey(home)]) await release(key);
    },
    exists: (p) => existsSync(p),
    readText: (p) => readFileSync(p, "utf-8"),
    writeText: (p, text) => writeFileSync(p, text, { encoding: "utf-8", mode: 0o600 }),
    readStream: (p) => readStreamFromFile(p),
    writeStream: (p, body) => writeStreamToFile(p, body),
    createExclusive: (p, text) => {
      try {
        writeFileSync(p, text, { encoding: "utf-8", flag: "wx", mode: 0o600 });
        return true;
      } catch (error) {
        if ((error as { code?: string }).code === "EEXIST") return false;
        throw error;
      }
    },
    readDir: (p) => readdirSync(p),
    rename: (from, to) => renameSync(from, to),
    mkdir: (p) => mkdirSync(p, { recursive: true, mode: 0o700 }),
    remove: (p) => rmSync(p, { recursive: true, force: true }),
    mtime: (p) => (existsSync(p) ? statSync(p).mtimeMs : null),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    env: process.env,
    fetch: (input, init) => globalThis.fetch(input, init),
    wranglerVersion: () => installedWranglerVersion(() => createRequire(import.meta.url)("wrangler/package.json")),
    log,
  };
}
