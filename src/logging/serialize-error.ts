import type { SerializedError } from "./types";

/** Converts any thrown value into a JSON-safe `{ name, message, stack? }` object, never throwing. @public */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name || "Error", message: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  }
  try {
    return { name: typeof err, message: String(err) };
  } catch {
    return { name: typeof err, message: "[unserializable thrown value]" };
  }
}
