/** Plain-object form of a thrown value, safe to put in a `LogRecord`'s `data`. @public */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Converts any thrown value into a JSON-safe `{ name, message, stack? }` object.
 * Never throws — hostile values (throwing `toString`, cyclic objects) degrade to a
 * placeholder rather than breaking the log path. @public
 */
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
