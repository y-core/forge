/** Paths the step table and its tests share. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppRoot } from "../src/tooling/cli/app-root";

// Derived from this file's location, never `process.cwd()`: the paths must resolve the same whichever directory the gate ran from.
/** Repository root. */
export const ROOT = resolveAppRoot(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

/** The directory every stylesheet forge ships lives in. */
export const CSS_DIR = "src/ui/assets/css";

/** Every tree the comment budget holds, with the generated bundles a local `wrangler dev` leaves in any `.wrangler` excluded. */
export const COMMENT_BUDGET_SOURCES = ["src", "config", "warden/src", "tests", ".types", "playwright.config.ts", "!**/.wrangler"];
