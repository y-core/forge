import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireDevServerLock } from "./dev-server-lock";

const dirs: string[] = [];

function lockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-lock-"));
  dirs.push(dir);
  return join(dir, "server.lock");
}

function holder(path: string): { pid: number; startedAt: number; token: string } {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Whether `promise` is still pending after the waiter has had time to poll several times. */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  return !settled;
}

const DEAD_PID = 2 ** 22 + 7;
const alive = (pid: number): boolean => pid !== DEAD_PID;

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("acquireDevServerLock()", () => {
  it("takes a free lock and records this process as its holder", async () => {
    const path = lockPath();
    await acquireDevServerLock({ path, staleAfterMs: 1_000, pollMs: 5, isAlive: alive });

    expect(holder(path).pid).toBe(process.pid);
  });

  it("keeps a second caller waiting until the first releases, then hands the lock over", async () => {
    const path = lockPath();
    const release = await acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 5, isAlive: alive });
    const first = holder(path).token;
    const second = acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 5, isAlive: alive });

    expect(await stillPending(second)).toBe(true);
    release();
    await second;
    expect(holder(path).token).not.toBe(first);
  });

  it("takes over a lock held for longer than `staleAfterMs`", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: 1_000, token: "old" }));
    await acquireDevServerLock({ path, staleAfterMs: 1_000, pollMs: 5, now: () => 2_001, isAlive: alive });

    expect(holder(path).token).not.toBe("old");
  });

  it("takes over a fresh lock whose holder is no longer running", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: DEAD_PID, startedAt: Date.now(), token: "orphan" }));
    await acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 5, isAlive: alive });

    expect(holder(path)).toMatchObject({ pid: process.pid });
  });

  it("waits on an unreadable lock written within `staleAfterMs`, since its holder may still be writing it", async () => {
    const path = lockPath();
    writeFileSync(path, "{");
    const waiting = acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 5, isAlive: alive });

    expect(await stillPending(waiting)).toBe(true);
    rmSync(path);
    await waiting;
    expect(holder(path).pid).toBe(process.pid);
  });

  it("takes over an unreadable lock last written longer than `staleAfterMs` ago", async () => {
    const path = lockPath();
    writeFileSync(path, "{");
    const past = new Date(Date.now() - 120_000);
    utimesSync(path, past, past);
    await acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 5, isAlive: alive });

    expect(holder(path).pid).toBe(process.pid);
  });

  it("leaves a successor's lock in place when the holder it took over from releases late", async () => {
    const path = lockPath();
    const late = await acquireDevServerLock({ path, staleAfterMs: 1_000, pollMs: 5, isAlive: alive });
    await acquireDevServerLock({ path, staleAfterMs: 1_000, pollMs: 5, now: () => Date.now() + 5_000, isAlive: alive });
    const successor = holder(path).token;
    late();

    expect(holder(path).token).toBe(successor);
  });

  it("releases once, however many times release is called", async () => {
    const path = lockPath();
    const release = await acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 5, isAlive: alive });
    release();
    expect(existsSync(path)).toBe(false);
    await acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 5, isAlive: alive });
    const next = holder(path).token;
    release();

    expect(holder(path).token).toBe(next);
  });
});
