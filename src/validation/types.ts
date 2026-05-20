export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };
