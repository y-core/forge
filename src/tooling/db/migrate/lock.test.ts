import { describe, expect, it } from "bun:test";
import process from "node:process";

import { fakeDbIo } from "../test-support";
import type { Home } from "../types";
import { acquireApplyLock, APPLY_LOCK_TTL_MS, applyLockPath } from "./lock";

const NOW = new Date("2026-09-11T10:00:00Z");

const home: Home = {
  label: "local",
  database: "app-db",
  dir: "/app",
  configPath: "/app/wrangler.jsonc",
  persistTo: "/app/.wrangler/state",
  place: "local",
  env: null,
  synthesized: false,
};

const LOCK = "/app/.forge/db-apply.lock";

describe("applyLockPath()", () => {
  it("puts the lock under the home directory, whatever the place", () => {
    expect(applyLockPath(home)).toBe(LOCK);
    expect(applyLockPath({ ...home, place: "remote", persistTo: null })).toBe(LOCK);
  });
});

describe("acquireApplyLock()", () => {
  it("writes the holder's pid and start instant, and removes the file on release", () => {
    const io = fakeDbIo({}, { now: NOW });
    const release = acquireApplyLock(io, home);
    expect(JSON.parse(io.files.get(LOCK) ?? "{}")).toEqual({ pid: process.pid, startedAt: NOW.getTime() });
    release();
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("refuses while a lock younger than the hour is held, naming the file and how to clear it", () => {
    const held = JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - 60_000 });
    const io = fakeDbIo({ [LOCK]: held }, { now: NOW });
    expect(() => acquireApplyLock(io, home)).toThrow(
      `Another apply holds ${LOCK} (pid 4242, since 2026-09-11T09:59:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    );
    expect(io.files.get(LOCK)).toBe(held);
  });

  it("names the verb it was given, so a backup is not reported as an apply", () => {
    const io = fakeDbIo({ [LOCK]: JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - 60_000 }) }, { now: NOW });
    expect(() => acquireApplyLock(io, home, "backup")).toThrow(
      `Another backup holds ${LOCK} (pid 4242, since 2026-09-11T09:59:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    );
  });

  // A run outliving the TTL is taken over as stale, and its own release must not delete the lock the
  // successor now holds.
  it("leaves a successor's lock alone when a taken-over run releases", () => {
    const io = fakeDbIo({}, { now: NOW });
    const release = acquireApplyLock(io, home);

    const successor = JSON.stringify({ pid: 4242, startedAt: NOW.getTime() + APPLY_LOCK_TTL_MS + 1 });
    io.files.set(LOCK, successor);

    release();
    expect(io.files.get(LOCK)).toBe(successor);
  });

  it("takes over a lock older than the hour", () => {
    const io = fakeDbIo({ [LOCK]: JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - APPLY_LOCK_TTL_MS - 1 }) }, { now: NOW });
    acquireApplyLock(io, home);
    expect(JSON.parse(io.files.get(LOCK) ?? "{}")).toEqual({ pid: process.pid, startedAt: NOW.getTime() });
  });

  it("holds a lock file it cannot read as a lock while the file itself is younger than the hour", () => {
    const io = fakeDbIo({ [LOCK]: "not json" }, { now: NOW });
    expect(() => acquireApplyLock(io, home)).toThrow(
      `Another apply holds ${LOCK} (unreadable lock, modified 2026-09-11T10:00:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    );
    expect(io.files.get(LOCK)).toBe("not json");
  });

  it("takes over an unreadable lock whose file is older than the hour", () => {
    const io = fakeDbIo({ [LOCK]: JSON.stringify({ pid: 1, startedAt: "yesterday" }) }, { now: NOW });
    io.mtime = () => NOW.getTime() - APPLY_LOCK_TTL_MS - 1;
    acquireApplyLock(io, home);
    expect(JSON.parse(io.files.get(LOCK) ?? "{}")).toEqual({ pid: process.pid, startedAt: NOW.getTime() });
  });

  it("refuses a second acquire against the same home while the first still holds it", () => {
    const io = fakeDbIo({}, { now: NOW });
    acquireApplyLock(io, home);
    expect(() => acquireApplyLock(io, home)).toThrow(
      `Another apply holds ${LOCK} (pid ${process.pid}, since 2026-09-11T10:00:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    );
  });

  it("refuses when the takeover loses the file to another run between the remove and the create", () => {
    const io = fakeDbIo({ [LOCK]: JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - APPLY_LOCK_TTL_MS - 1 }) }, { now: NOW });
    io.createExclusive = () => false;
    expect(() => acquireApplyLock(io, home)).toThrow(
      `Another apply holds ${LOCK} (unreadable lock, modified 2026-09-11T10:00:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    );
  });

  it("takes over a crash-left stale lock with a single acquirer and leaves no sidecar behind", () => {
    const io = fakeDbIo({ [LOCK]: JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - APPLY_LOCK_TTL_MS - 1 }) }, { now: NOW });
    acquireApplyLock(io, home);
    expect([...io.files.keys()]).toEqual([LOCK]);
    expect(JSON.parse(io.files.get(LOCK) ?? "{}")).toEqual({ pid: process.pid, startedAt: NOW.getTime() });
  });

  it("puts back a fresh lock another taker wrote between the read and the rename, and refuses naming that holder", () => {
    const stale = JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - APPLY_LOCK_TTL_MS - 1 });
    const io = fakeDbIo({ [LOCK]: stale }, { now: NOW });
    const fresh = `${JSON.stringify({ pid: 7, startedAt: NOW.getTime() })}\n`;
    // A reads the stale file; before A renames it, B completes its own takeover and holds a fresh lock.
    const readText = io.readText;
    let reads = 0;
    io.readText = (p) => {
      const text = readText(p);
      if (p === LOCK && (reads += 1) === 1) io.files.set(LOCK, fresh);
      return text;
    };
    expect(() => acquireApplyLock(io, home)).toThrow(
      `Another apply holds ${LOCK} (pid 7, since 2026-09-11T10:00:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    );
    expect(io.files.get(LOCK)).toBe(fresh);
    expect([...io.files.keys()]).toEqual([LOCK]);
  });

  it("refuses when the stale file is gone before the rename, another taker having claimed it", () => {
    const io = fakeDbIo({ [LOCK]: JSON.stringify({ pid: 4242, startedAt: NOW.getTime() - APPLY_LOCK_TTL_MS - 1 }) }, { now: NOW });
    const winner = `${JSON.stringify({ pid: 9, startedAt: NOW.getTime() })}\n`;
    io.rename = () => {
      io.files.set(LOCK, winner);
      throw new Error("ENOENT");
    };
    expect(() => acquireApplyLock(io, home)).toThrow(
      `Another apply holds ${LOCK} (pid 9, since 2026-09-11T10:00:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    );
    expect(io.files.get(LOCK)).toBe(winner);
  });

  it("takes over an unreadable lock whose file has no modification time, having vanished between the two calls", () => {
    const io = fakeDbIo({ [LOCK]: "not json" }, { now: NOW });
    io.mtime = () => null;
    acquireApplyLock(io, home);
    expect(JSON.parse(io.files.get(LOCK) ?? "{}")).toEqual({ pid: process.pid, startedAt: NOW.getTime() });
  });

  it("is re-acquirable once released", () => {
    const io = fakeDbIo({}, { now: NOW });
    acquireApplyLock(io, home)();
    expect(() => acquireApplyLock(io, home)).not.toThrow();
  });
});
