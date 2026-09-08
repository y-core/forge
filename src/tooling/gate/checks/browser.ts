import { existsSync } from "node:fs";

import { chromium } from "@playwright/test";

import { resolveChromiumPath } from "./chromium";

/** Whether a launchable Chromium exists, either the system one or playwright's own download. @public */
export function hasChromium(): boolean {
  // A stale download from an earlier playwright version reads as absent, not present.
  return resolveChromiumPath() !== undefined || existsSync(chromium.executablePath());
}
