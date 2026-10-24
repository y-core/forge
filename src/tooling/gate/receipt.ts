import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

import { worktreeGitPath } from "../cli/worktree";
import { GATE_TIERS } from "./types";
import type { GateReceipt, GateTier } from "./types";

const RECEIPT_FILE = "forge-verify-receipt.json";

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function isReceipt(value: unknown): value is GateReceipt {
  if (typeof value !== "object" || value === null) return false;
  const { tree, tier, base, labels } = value as Record<string, unknown>;
  return (
    typeof tree === "string" &&
    OBJECT_ID.test(tree) &&
    (base === undefined || (typeof base === "string" && OBJECT_ID.test(base))) &&
    GATE_TIERS.some((known) => known === tier) &&
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

function rank(tier: GateTier): number {
  return GATE_TIERS.indexOf(tier);
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

/** Records `receipt` atomically, unless the existing one names the same tree at a higher tier. */
export function recordReceipt(cwd: string, receipt: GateReceipt): void {
  const path = worktreeGitPath(cwd, RECEIPT_FILE);
  if (path === undefined) return;
  const existing = readReceipt(cwd);
  if (existing !== undefined && existing.tree === receipt.tree && rank(existing.tier) > rank(receipt.tier)) return;
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    const { tree, tier, base, labels } = receipt;
    writeFileSync(tmp, `${JSON.stringify({ tree, tier, ...(base === undefined ? {} : { base }), labels })}\n`, "utf-8");
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

/** Answers whether `receipt` vouches for a run of `wanted.labels` at `wanted.tier` over `wanted.tree`; a `runtime` receipt also needs `wanted.base`, since its narrowing read changes against it. */
export function receiptCovers(
  receipt: GateReceipt,
  wanted: { tree: string; tier: GateTier; base?: string | undefined; labels: readonly string[] },
): boolean {
  if (receipt.tier === "runtime" && receipt.base !== wanted.base) return false;
  return receipt.tree === wanted.tree && rank(receipt.tier) >= rank(wanted.tier) && wanted.labels.every((label) => receipt.labels.includes(label));
}
