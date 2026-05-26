import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CopyEntry } from "../types";

export function copyAssets(copies: CopyEntry[], publicDir: string): void {
  for (const entry of copies) {
    const dest = join(publicDir, entry.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(entry.from, dest);
  }
}
