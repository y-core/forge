import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CopyEntry } from "../types";
import { safeJoin } from "./paths";

export function copyAssets(copies: CopyEntry[], publicDir: string): void {
  for (const entry of copies) {
    const dest = safeJoin(publicDir, entry.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(entry.from, dest);
  }
}
