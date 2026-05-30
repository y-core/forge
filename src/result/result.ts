/**
 * Discriminated-union result type aligned with forge's `{ ok }` convention.
 * Use `result()` to wrap synchronous or async operations without try/catch at every call site.
 * @public
 */
export type Result<T, E = Error> =
  | { ok: true; data: T }
  | { ok: false; error: E };

/** Validation result — success carries parsed data, failure carries an array of error messages. @public */
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

/** Converts any thrown value to an `Error` instance; safe to use in `catch (err)` blocks where `err` is `unknown`. @public */
export function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

function result<E = Error>(fn: () => never): Result<never, E>;
function result<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>>;
function result<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>>;
function result<T, E = Error>(fn: () => T): Result<T, E>;
function result<T, E = Error>(
  arg: (() => T | Promise<T>) | Promise<T>,
): Result<T, E> | Promise<Result<T, E>> {
  if (typeof arg === "function") {
    let val: T | Promise<T>;
    try {
      val = (arg as () => T | Promise<T>)();
    } catch (thrown) {
      return { ok: false, error: toError(thrown) as E };
    }
    if (val instanceof Promise) {
      return val.then(
        (data) => ({ ok: true as const, data }),
        (thrown) => ({ ok: false as const, error: toError(thrown) as E }),
      );
    }
    return { ok: true, data: val };
  }
  return (arg as Promise<T>).then(
    (data) => ({ ok: true as const, data }),
    (thrown) => ({ ok: false as const, error: toError(thrown) as E }),
  );
}

export { result };
