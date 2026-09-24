import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A throwaway repository root holding exactly `files`, keyed by repo-relative path, directories created as needed. */
export function gateFixtureRoot(files: Record<string, string> = {}, prefix = "forge-gate-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, "utf-8");
  }
  return root;
}
