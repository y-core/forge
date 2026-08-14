import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

/** The system Chromium path, if `CHROME_PATH` names one that exists on disk. */
export function resolveChromiumPath(): string | undefined {
  // Playwright reads no env var for its own browser path — CHROME_PATH must be joined in here.
  const fromEnv = process.env.CHROME_PATH;
  return fromEnv && existsSync(fromEnv) ? fromEnv : undefined;
}

/** Whether a launchable Chromium exists, either the system one or playwright's own download. */
export function hasChromium(): boolean {
  // A stale download from an earlier playwright version reads as absent, not present.
  return resolveChromiumPath() !== undefined || existsSync(chromium.executablePath());
}
