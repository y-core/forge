import type { ScopedLogger } from "./types";

/** Create a `ScopedLogger` whose every line is prefixed with `[scope]`. */
export function scopeLogger(scope: string): ScopedLogger {
  return {
    info: (msg) => console.log(`[${scope}] ${msg}`),
    warn: (msg) => console.error(`[${scope}] ${msg}`),
    done: (msg) => console.log(`[${scope}] ${msg}`),
  };
}
