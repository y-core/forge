/** log.ts — scoped, prefixed progress logging for forge CLI scripts.
 *
 *  A trivial `[scope]`-prefixed console printer, declared once so each script
 *  stops hand-rolling `console.log("[scope] …")` literals. Distinct from the
 *  heavyweight structured request logger in `@y-core/forge/logging`.
 */

import type { ScopedLogger } from "./types";

/** Create a `ScopedLogger` whose every line is prefixed with `[scope]`. */
export function scopeLogger(scope: string): ScopedLogger {
  return {
    info: (msg) => console.log(`[${scope}] ${msg}`),
    warn: (msg) => console.error(`[${scope}] ${msg}`),
    done: (msg) => console.log(`[${scope}] ${msg}`),
  };
}
