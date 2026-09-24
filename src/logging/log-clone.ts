import { logSafeUrl } from "./log-value";
import type { LogKeyVerdict } from "./types";

const CIRCULAR_MARKER = "[circular]";

/** Replaces a redacted value; a fixed literal, never derived from the value. @public */
export const LOG_REDACTED = "[redacted]";

/** The sole field of a record whose `data` could not be redacted, so none of it was written. @public */
export const LOG_REDACTION_FAILED = "redactionFailed";

/** Deep-clones `value` into a JSON-stable shape, marking cycles, applying `decide` to every own key it meets. @internal */
export function cloneLogValue(value: unknown, decide: (key: string) => LogKeyVerdict): unknown {
  const openPath = new WeakSet<object>();

  function walk(input: unknown): unknown {
    if (input === null || typeof input !== "object") return input;
    // An invalid Date has no representable instant, and `toISOString` would throw on the log path.
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
    // Ahead of the `toJSON` consult: `URL.prototype.toJSON` returns the full href, query string included.
    if (input instanceof URL) return logSafeUrl(input);
    if (openPath.has(input)) return CIRCULAR_MARKER;

    openPath.add(input);
    try {
      const toJson = (input as { toJSON?: () => unknown }).toJSON;
      if (typeof toJson === "function") return walk(toJson.call(input));
      if (Array.isArray(input)) return input.map((item) => walk(item));
      if (input instanceof Map) return { type: "Map", entries: [...input].map(([key, val]) => [walk(key), walk(val)]) };
      if (input instanceof Set) return { type: "Set", values: [...input].map((item) => walk(item)) };
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).flatMap(([key, val]) => {
          const verdict = decide(key);
          if (verdict === "remove") return [];
          return [[key, verdict === "mask" ? LOG_REDACTED : walk(val)]];
        }),
      );
    } finally {
      openPath.delete(input);
    }
  }

  return walk(value);
}
