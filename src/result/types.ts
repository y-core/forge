/** Discriminated-union result type aligned with forge's `{ ok }` convention. @public */
export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

/** A `Result` with no success value whose failure channel carries a machine-readable reason code. @public */
export type GuardResult<R = string> = Result<void, R>;

/** A `Result` whose failure channel carries a per-field message list rather than an `Error`. @public */
export type ValidationResult<T> = Result<T, readonly string[]>;
