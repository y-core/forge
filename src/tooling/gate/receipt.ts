import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

import { GATE_MODES } from "./types";
import type { GateMode, GateReceipt } from "./types";
import { worktreeGitPath } from "./worktree";

const RECEIPT_FILE = "forge-verify-receipt.json";

function isReceipt(value: unknown): value is GateReceipt {
  if (typeof value !== "object" || value === null) return false;
  const { tree, mode, labels } = value as Record<string, unknown>;
  return (
    typeof tree === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tree) &&
    GATE_MODES.some((known) => known === mode) &&
    Array.isArray(labels) &&
    labels.every((label) => typeof label === "string")
  );
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    return;
  }
}

function rank(mode: GateMode): number {
  return GATE_MODES.indexOf(mode);
}

/** Reads the receipt recorded in the git directory of the work tree at `cwd`, or `undefined` when there is no valid one. */
export function readReceipt(cwd: string): GateReceipt | undefined {
  const path = worktreeGitPath(cwd, RECEIPT_FILE);
  if (path === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isReceipt(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Records `receipt` atomically, unless the existing one names the same tree at a higher mode. */
export function recordReceipt(cwd: string, receipt: GateReceipt): void {
  const path = worktreeGitPath(cwd, RECEIPT_FILE);
  if (path === undefined) return;
  const existing = readReceipt(cwd);
  if (existing !== undefined && existing.tree === receipt.tree && rank(existing.mode) > rank(receipt.mode)) return;
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify({ tree: receipt.tree, mode: receipt.mode, labels: receipt.labels })}\n`, "utf-8");
    renameSync(tmp, path);
  } catch {
    removeQuietly(tmp);
  }
}

/** Removes the recorded receipt, if any. */
export function clearReceipt(cwd: string): void {
  const path = worktreeGitPath(cwd, RECEIPT_FILE);
  if (path !== undefined) removeQuietly(path);
}

/** Answers whether `receipt` vouches for a run of `wanted.labels` at `wanted.mode` over `wanted.tree`. */
export function receiptCovers(receipt: GateReceipt, wanted: { tree: string; mode: GateMode; labels: readonly string[] }): boolean {
  return receipt.tree === wanted.tree && rank(receipt.mode) >= rank(wanted.mode) && wanted.labels.every((label) => receipt.labels.includes(label));
}
