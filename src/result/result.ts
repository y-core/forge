import type { Result } from "./types";

/** Converts any thrown value to an `Error` instance. @public */
export function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** Constructs a successful `Result`; call with no argument for a `Result<void>`. @public */
export function ok(): Result<void, never>;
export function ok<T>(data: T): Result<T, never>;
export function ok<T>(data?: T): Result<T, never> {
  return { ok: true, data: data as T };
}

/** Constructs a failed `Result` carrying `error` in the failure channel. @public */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Runs a function or awaits a promise, capturing a thrown value as a failed `Result`. @public */
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
