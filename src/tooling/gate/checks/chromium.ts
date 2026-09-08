import { existsSync } from "node:fs";

/** The system Chromium path, if `CHROME_PATH` names one that exists on disk. @public */
export function resolveChromiumPath(): string | undefined {
  // Playwright reads no env var for its own browser path — CHROME_PATH must be joined in here.
  const fromEnv = process.env.CHROME_PATH;
  return fromEnv && existsSync(fromEnv) ? fromEnv : undefined;
}
