import type { SerializedError } from "./types";

// `type` and `detail` rather than `name` and `message`: a consumer's `also: ["name"]` masks its own
// `name` field by substring, and a record field spelled the same would go blind with it.
/** Converts any thrown value into a JSON-safe `{ type, detail, stack? }` object, never throwing. @public */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { type: err.name || "Error", detail: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  }
  try {
    return { type: typeof err, detail: String(err) };
  } catch {
    return { type: typeof err, detail: "[unserializable thrown value]" };
  }
}
