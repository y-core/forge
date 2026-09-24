import { join } from "node:path";
import process from "node:process";

import { CliError } from "../../cli/errors";
import type { DbIo, Home } from "../types";

/** How long a lock file is believed before it is treated as left behind by a dead process. @internal */
export const APPLY_LOCK_TTL_MS = 60 * 60 * 1000;

/** Where the apply lock for one home lives. @internal */
export function applyLockPath(home: Home): string {
  return join(home.dir, ".forge", "db-apply.lock");
}

/** What the lock file holds: who took it, and when. */
interface ApplyLock {
  pid: number;
  startedAt: number;
}

function readLock(io: DbIo, path: string): ApplyLock | null {
  try {
    const parsed = JSON.parse(io.readText(path)) as Partial<ApplyLock>;
    if (typeof parsed.startedAt !== "number" || !Number.isFinite(parsed.startedAt)) return null;
    return { pid: typeof parsed.pid === "number" ? parsed.pid : 0, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

const iso = (ms: number): string => new Date(ms).toISOString();

function heldError(verb: string, path: string, holder: string): CliError {
  return new CliError(
    "invalid-args",
    `Another ${verb} holds ${path} (${holder}). Wait for it to finish, or delete that file if the process is gone.`,
  );
}

/** How the refusal names whoever holds the file now: its own record of itself, else the file's own date. */
function heldBy(io: DbIo, path: string, fallback: number): string {
  const lock = readLock(io, path);
  if (lock !== null) return `pid ${lock.pid}, since ${iso(lock.startedAt)}`;
  return `unreadable lock, modified ${iso(io.mtime(path) ?? fallback)}`;
}

/** Claims the right to apply migrations against a home, returning the call that gives it back. @internal */
export function acquireApplyLock(io: DbIo, home: Home, verb = "apply"): () => void {
  const path = applyLockPath(home);
  const now = io.now().getTime();
  const body = `${JSON.stringify({ pid: process.pid, startedAt: now })}\n`;
  // Conditional, because a run outliving the TTL has its lock taken over as stale: an unconditional
  // remove would then delete the successor's.
  const release = () => {
    const holder = readLock(io, path);
    if (holder !== null && holder.pid === process.pid && holder.startedAt === now) io.remove(path);
  };

  io.mkdir(join(home.dir, ".forge"));
  if (io.createExclusive(path, body)) return release;

  const held = readLock(io, path);
  if (held !== null && now - held.startedAt < APPLY_LOCK_TTL_MS) throw heldError(verb, path, `pid ${held.pid}, since ${iso(held.startedAt)}`);
  if (held === null) {
    // A lock that says nothing about itself is dated by the file; an absent one vanished between the read and this stat.
    const modified = io.mtime(path);
    if (modified !== null && now - modified < APPLY_LOCK_TTL_MS) throw heldError(verb, path, `unreadable lock, modified ${iso(modified)}`);
  }

  // A rename is atomic, so of two takers only one gets the stale file; the other finds it gone.
  const stale = `${path}.${process.pid}.stale`;
  try {
    io.rename(path, stale);
  } catch {
    throw heldError(verb, path, heldBy(io, path, now));
  }
  const taken = readLock(io, stale);
  if (taken !== null && held !== null && taken.startedAt !== held.startedAt) {
    io.createExclusive(path, io.readText(stale));
    io.remove(stale);
    throw heldError(verb, path, `pid ${taken.pid}, since ${iso(taken.startedAt)}`);
  }
  io.remove(stale);
  if (io.createExclusive(path, body)) return release;
  throw heldError(verb, path, heldBy(io, path, now));
}
