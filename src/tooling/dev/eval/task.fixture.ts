import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { EvalTaskSpec } from "./types";

/** A task spec with one trap of each detector kind, for a test to adjust. */
export function sampleSpec(id = "sample-task"): EvalTaskSpec {
  return {
    id,
    tree: "forge",
    model: "opus",
    timeoutMinutes: 20,
    bait: ["bait/helper.patch"],
    accept: ["src/sample/sample.accept.test.ts"],
    traps: [
      { id: "node-import", rules: ["project:docs/FORGE_REVIEW.md#3b"], detector: { kind: "rg", pattern: 'from "node:', paths: ["src/sample"] } },
      { id: "co-location", rules: ["project:docs/TEST_RUNNERS.md#2"], detector: { kind: "step", label: "validate-co-location" } },
      {
        id: "refusal-shape",
        rules: ["project:docs/SECURITY_HARDENING.md#1"],
        detector: { kind: "test", file: "src/sample/refusal.accept.test.ts" },
      },
    ],
  };
}

/** Writes a task directory under a fresh temporary root, holding every file `spec` names except those in `omit`. */
export function writeTaskDir(spec: unknown, files: readonly string[], omit: readonly string[] = []): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "forge-eval-task-"));
  const id = typeof spec === "object" && spec !== null && "id" in spec && typeof spec.id === "string" ? spec.id : "sample-task";
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "task.json"), JSON.stringify(spec, null, 2), "utf-8");
  for (const file of files) {
    if (omit.includes(file)) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), `${file}\n`, "utf-8");
  }
  return { root, dir };
}

/** Every file `sampleSpec()` names, relative to its task directory. */
export const SAMPLE_FILES = [
  "prompt.md",
  "reference.patch",
  "plants/node-import.patch",
  "plants/co-location.patch",
  "plants/refusal-shape.patch",
  "bait/helper.patch",
  "accept/src/sample/sample.accept.test.ts",
  "accept/src/sample/refusal.accept.test.ts",
];

/** Removes the roots `writeTaskDir` made. */
export function removeAll(roots: readonly string[]): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
