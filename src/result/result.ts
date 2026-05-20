export type Result<T, E = Error> =
  | readonly [data: T, error: null]
  | readonly [data: null, error: E];

function toError(thrown: unknown): Error {
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
      return [null, toError(thrown) as E] as const;
    }
    if (val instanceof Promise) {
      return val.then(
        (data) => [data, null] as const,
        (thrown) => [null, toError(thrown) as E] as const,
      );
    }
    return [val, null] as const;
  }
  return (arg as Promise<T>).then(
    (data) => [data, null] as const,
    (thrown) => [null, toError(thrown) as E] as const,
  );
}

export { result };
