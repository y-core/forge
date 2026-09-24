import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { D1DatabaseLike } from "../../storage/db/types";
import { CliError } from "../cli/errors";
import { persistRoot } from "./home";
import { retryWithBackoff } from "./retry";
import { isReadOnlyBatch } from "./sql";
import type { BackoffPolicy, DbIo, Home, Spawned } from "./types";

/** Every `node_modules/.bin` on the way up from `from`, nearest first, so the app's wrangler wins over forge's own. */
function binDirs(from: string): string[] {
  const found: string[] = [];
  for (let dir = from; ; dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin");
    if (existsSync(bin)) found.push(bin);
    if (dirname(dir) === dir) return found;
  }
}

/** One open binding over a local home's state, and the workerd process behind it. */
interface LocalD1 {
  readonly db: D1DatabaseLike;
  readonly split: (sql: string) => string[];
  readonly dispose: () => Promise<void>;
}

/** Which handle a home has: two homes share one only when they name the same state through the same config. */
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

// Read together and before anything opens: the query-time read `split` used to get reported a
// version problem as "query `SELECT …` failed", with the diagnostic gone.
/** The first export `forge db` needs that a loaded wrangler does not have, or `null` when it has both. @internal */
export function missingWranglerExport(module: { getPlatformProxy?: unknown; unstable_splitSqlQuery?: unknown }): string | null {
  if (module.getPlatformProxy === undefined) return "getPlatformProxy";
  if (module.unstable_splitSqlQuery === undefined) return "unstable_splitSqlQuery";
  return null;
}

/** Five tries of a refused batch, 100 ms before the second and doubling to 800 ms before the fifth. @internal */
export const D1_BUSY_BACKOFF: BackoffPolicy = { attempts: 5, firstDelayMs: 100 };

// workerd logs the SQLITE_BUSY behind this to its own stderr alone; what reaches this process is
// D1's opaque internal error, with no cause naming the lock.
/** True for the error a local D1 answers a batch with when another process held the database's lock. @internal */
export function isD1BusyRefusal(error: unknown): boolean {
  return error instanceof Error && /^D1_ERROR: .*\binternal error; reference = \w+/s.test(error.message);
}

// Imported rather than named at the top: wrangler is an optional peer, and a static import would
// fail a consumer that installed forge without it before any verb could say so.
async function openLocalD1(home: Home): Promise<LocalD1> {
  // In process, wrangler's own logger writes to this tool's stderr, where a spawned one wrote to a
  // pipe nothing read. `error` keeps that parity: its chatter never was part of forge's output.
  process.env.WRANGLER_LOG ??= "error";
  const wrangler = await import("wrangler").catch((error: unknown) => {
    throw wranglerUnreachable(home, { error });
  });
  const missing = missingWranglerExport(wrangler);
  if (missing !== null) throw wranglerUnreachable(home, { missing });
  const proxy = await wrangler.getPlatformProxy<Record<string, D1DatabaseLike>>({
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
  return { db, split: wrangler.unstable_splitSqlQuery, dispose: proxy.dispose };
}

/** The real side effects: node's filesystem, a spawned wrangler, and the process environment. @internal */
export function realDbIo(root: string, log: (line: string) => void = (line) => console.error(line)): DbIo {
  const handles = new Map<string, Promise<LocalD1>>();
  const answered = new Set<string>();

  function reach(home: Home, key: string): Promise<LocalD1> {
    const held = handles.get(key);
    if (held !== undefined) return held;
    const opening = openLocalD1(home);
    handles.set(key, opening);
    // An open that failed holds nothing, so it is not kept: a later call opens again rather than
    // meeting the first failure a second time, from wherever it next reaches this database.
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

  const path = [...binDirs(root), ...binDirs(dirname(fileURLToPath(import.meta.url))), process.env.PATH ?? ""].join(delimiter);
  // `FORCE_COLOR: "0"`: bun 1.4 colourises a pipe, and `parseJsonOutput` reads a line starting with
  // an escape byte as "printed no JSON".
  const env = { ...process.env, PATH: path, WRANGLER_SEND_METRICS: "false", FORCE_COLOR: "0" };
  return {
    spawn(cmd, args, opts): Spawned {
      const r = spawnSync(cmd, [...args], {
        cwd: opts.cwd,
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
      });
      const reason = r.error ? `${r.error.message}\n` : "";
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${reason}` };
    },
    async d1(home, sql): Promise<Record<string, unknown>[][]> {
      if (home.persistTo === null) {
        throw new CliError("invalid-args", `${home.label} (${home.database}) is deployed, and nothing reaches a deployed database in process`);
      }
      const key = handleKey(home);
      const fresh = !answered.has(key);
      let readOnly = false;
      const answers = await retryWithBackoff(
        async (tried) => {
          // Nothing says workerd's D1 object reopens a database it failed to open, so a retry starts a new one.
          if (tried > 1) await release(key);
          const handle = await reach(home, key);
          const statements = sql.flatMap((text) => handle.split(text)).filter((statement) => statement.trim() !== "");
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
    // Total, because every caller releases from a `finally`: one key's failure must not abandon the
    // handles after it, and an error raised here would replace the one the run is already failing on.
    async closeD1(home): Promise<void> {
      for (const key of home === null ? [...handles.keys()] : [handleKey(home)]) await release(key);
    },
    exists: (p) => existsSync(p),
    readText: (p) => readFileSync(p, "utf-8"),
    writeText: (p, text) => writeFileSync(p, text, { encoding: "utf-8", mode: 0o600 }),
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
    env: process.env,
    log,
  };
}
