/** Why a store operation failed at the I/O layer. A domain rule refusing is a reason union, never this. @public */
export type AuthStoreErrorCode = "conflict" | "unavailable";

/** The one I/O failure an auth store reports, carried in a `Result`'s error channel. @public */
export class AuthStoreError extends Error {
  readonly code: AuthStoreErrorCode;
  readonly operation: string;
  readonly constraint?: string | undefined;

  constructor(code: AuthStoreErrorCode, operation: string, options?: { constraint?: string | undefined; cause?: unknown }) {
    super(`auth store ${code} during "${operation}"`, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AuthStoreError";
    this.code = code;
    this.operation = operation;
    this.constraint = options?.constraint;
  }
}
