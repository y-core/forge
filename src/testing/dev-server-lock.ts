import { closeSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";

/** The lock file's name under the system temp directory, shared by every process starting a dev server. @internal */
export const DEV_SERVER_LOCK = "forge-dev-server.lock";

interface DevServerLockOptions {
  path: string;
  staleAfterMs: number;
  pollMs?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

interface LockRecord {
  pid: number;
  startedAt: number;
  token: string;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function parseRecord(text: string): LockRecord | undefined {
  try {
    const record: unknown = JSON.parse(text);
    if (typeof record !== "object" || record === null) return undefined;
    const { pid, startedAt, token } = record as Partial<LockRecord>;
    if (typeof pid !== "number" || typeof startedAt !== "number" || typeof token !== "string") return undefined;
    return { pid, startedAt, token };
  } catch {
    return undefined;
  }
}

function readLock(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function createExclusive(path: string, text: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
  return true;
}

function isStale(path: string, text: string, options: DevServerLockOptions, now: number): boolean {
  const record = parseRecord(text);
  if (record === undefined) {
    const written = lstatSync(path, { throwIfNoEntry: false })?.mtimeMs;
    return written !== undefined && now - written > options.staleAfterMs;
  }
  return now - record.startedAt > options.staleAfterMs || !(options.isAlive ?? isProcessAlive)(record.pid);
}

function takeOver(path: string, judged: string): void {
  const aside = `${path}.${process.pid}.${crypto.randomUUID()}.stale`;
  try {
    renameSync(path, aside);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  const moved = readFileSync(aside, "utf-8");
  // Another waiter may have taken the stale lock over between this one's judgement and its move.
  if (moved !== judged) createExclusive(path, moved);
  rmSync(aside, { force: true });
}

/** Waits for the cross-process dev-server startup lock and answers the function that releases it. @internal */
export async function acquireDevServerLock(options: DevServerLockOptions): Promise<() => void> {
  const { path } = options;
  const now = options.now ?? Date.now;
  const token = crypto.randomUUID();
  for (;;) {
    if (createExclusive(path, JSON.stringify({ pid: process.pid, startedAt: now(), token }))) break;
    const text = readLock(path);
    if (text === undefined) continue;
    if (isStale(path, text, options, now())) {
      takeOver(path, text);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const text = readLock(path);
    if (text !== undefined && parseRecord(text)?.token === token) rmSync(path, { force: true });
  };
}
