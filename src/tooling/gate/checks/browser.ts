import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import type { BrowserType } from "@playwright/test";

import { resolveChromiumPath } from "./chromium";

/** Whether a launchable Chromium exists, either the system one or playwright's own download. @public */
export function hasChromium(): boolean {
  if (resolveChromiumPath() !== undefined) return true;
  // A stale download from an earlier playwright version reads as absent, not present.
  const { chromium } = createRequire(import.meta.url)("@playwright/test") as { chromium: BrowserType };
  return existsSync(chromium.executablePath());
}
