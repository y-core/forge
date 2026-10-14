import { afterAll, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
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

  it("gives up at the deadline on a lock its holder keeps, naming the lock and the holder's pid", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: 4242, startedAt: Date.now(), token: "kept" }));
    let clock = Date.now();
    const waiting = acquireDevServerLock({ path, staleAfterMs: 60_000, timeoutMs: 3_000, pollMs: 1, now: () => (clock += 1_000), isAlive: alive });

    const error = await waiting.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(path);
    expect((error as Error).message).toContain("pid 4242");
    expect([holder(path).pid, holder(path).token]).toEqual([4242, "kept"]);
  });

  it("names the holder's pid as unknown at the deadline when the lock it keeps cannot be read", async () => {
    const path = lockPath();
    writeFileSync(path, "{");
    let clock = Date.now();
    const waiting = acquireDevServerLock({ path, staleAfterMs: 60_000, timeoutMs: 3_000, pollMs: 1, now: () => (clock += 1_000), isAlive: alive });

    await expect(waiting).rejects.toThrow(path);
    await expect(waiting).rejects.toThrow("pid unknown");
    expect(readFileSync(path, "utf-8")).toBe("{");
  });

  it("waits a poll before retrying when the lock vanishes between the failed create and the read", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: 4242, startedAt: Date.now(), token: "leaving" }));
    const realRead = fs.readFileSync;
    let vanished = false;
    const read = spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof realRead>) => {
      if (vanished) return realRead(...args);
      vanished = true;
      rmSync(path);
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    }) as typeof realRead);
    const timers = spyOn(globalThis, "setTimeout");
    try {
      await acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 7, isAlive: alive });
      expect(timers.mock.calls.some(([, delay]) => delay === 7)).toBe(true);
    } finally {
      read.mockRestore();
      timers.mockRestore();
    }
    expect(holder(path).pid).toBe(process.pid);
  });

  it("takes over a stale lock without waiting a poll first", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: DEAD_PID, startedAt: Date.now(), token: "orphan" }));
    const timers = spyOn(globalThis, "setTimeout");
    try {
      await acquireDevServerLock({ path, staleAfterMs: 60_000, pollMs: 7, isAlive: alive });
      expect(timers.mock.calls.filter(([, delay]) => delay === 7)).toEqual([]);
    } finally {
      timers.mockRestore();
    }
    expect(holder(path).pid).toBe(process.pid);
  });
});
