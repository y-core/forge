import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { safeJoin } from "./paths";
import type { CopyEntry } from "./types";

/** Copies each entry into `publicDir`, creating parent directories as needed. @public */
export function copyAssets(copies: CopyEntry[], publicDir: string): void {
  for (const entry of copies) {
    const dest = safeJoin(publicDir, entry.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(entry.from, dest);
  }
}
