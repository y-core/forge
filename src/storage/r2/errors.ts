/** Thrown by a storage backend when a `Range` lies wholly outside the object. @public */
export class UnsatisfiableRangeError extends Error {
  readonly key: string;
  readonly size?: number | undefined;

  constructor(key: string, options?: { size?: number | undefined; cause?: unknown }) {
    super(`Range not satisfiable for "${key}"`, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "UnsatisfiableRangeError";
    this.key = key;
    this.size = options?.size;
  }
}

/** Recognizes the platform error R2 throws for a range outside the object, across its shapes. @internal */
export function isUnsatisfiableRange(thrown: unknown): boolean {
  if (typeof thrown !== "object" || thrown === null) return false;
  // A `TypeError` is R2 refusing the option value itself — a caller bug, not a range outside the object.
  if (thrown instanceof TypeError) return false;
  const candidate = thrown as { name?: unknown; code?: unknown; message?: unknown };
  if (candidate.code === 10039) return true;
  return typeof candidate.message === "string" && /range is not satisfiable|InvalidRange/i.test(candidate.message);
}
