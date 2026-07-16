/**
 * Discriminated-union result type aligned with forge's `{ ok }` convention.
 * Use `result()` to wrap synchronous or async operations without try/catch at every call site.
 * @public
 */
export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

/**
 * Predicate/authorization check result — a domain alias of `Result` with no success value; the
 * failure channel carries a machine-readable reason code (typically a string-literal union).
 * Use for guard-style checks (origin, CSRF, Turnstile) rather than value-producing operations. @public
 */
export type GuardResult<R = string> = Result<void, R>;

/**
 * Validation result — a domain alias of `Result` whose failure channel carries the per-field message
 * list as `error: readonly string[]` (rather than a single `Error`). Use for `v`-backed validation. @public
 */
export type ValidationResult<T> = Result<T, readonly string[]>;

/** Converts any thrown value to an `Error` instance; safe to use in `catch (err)` blocks where `err` is `unknown`. @public */
export function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** Constructs a successful `Result`; call with no argument for a `Result<void>` (e.g. a passing `GuardResult`). @public */
export function ok(): Result<void, never>;
export function ok<T>(data: T): Result<T, never>;
export function ok<T>(data?: T): Result<T, never> {
  return { ok: true, data: data as T };
}

/** Constructs a failed `Result` carrying `error` in the failure channel (an `Error`, reason code, or message list). @public */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

function result<E = Error>(fn: () => never): Result<never, E>;
function result<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>>;
function result<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>>;
function result<T, E = Error>(fn: () => T): Result<T, E>;
function result<T, E = Error>(arg: (() => T | Promise<T>) | Promise<T>): Result<T, E> | Promise<Result<T, E>> {
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
