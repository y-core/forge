import type { D1BackupFailureKind } from "./types";

/** Thrown by a backup step; a Workflow retries the step unless the kind is one no retry can change. @public */
export class D1BackupError extends Error {
  readonly kind: D1BackupFailureKind;
  readonly status: number | undefined;

  constructor(kind: D1BackupFailureKind, message: string, options: { status?: number } = {}) {
    super(message);
    this.name = "D1BackupError";
    this.kind = kind;
    this.status = options.status;
  }
}

const PERMANENT: ReadonlySet<D1BackupFailureKind> = new Set(["options", "auth", "not-found", "unsupported", "incomplete", "target", "import"]);

/** Whether no retry can change the outcome: the options, the token, the database id, the database's own shape, the dump or the target is wrong. @internal */
export function isPermanentBackupFailure(error: unknown): boolean {
  return error instanceof D1BackupError && PERMANENT.has(error.kind);
}

/** Wraps a step's callback so a failure no retry can change reaches the Workflow through `nonRetryable`, and any other is thrown as it was. @internal */
export function permanentFailures<T>(
  options: { readonly nonRetryable?: ((message: string) => Error) | undefined },
  run: () => Promise<T>,
): () => Promise<T> {
  return async () => {
    try {
      return await run();
    } catch (error) {
      if (options.nonRetryable !== undefined && isPermanentBackupFailure(error)) throw options.nonRetryable((error as Error).message);
      throw error;
    }
  };
}

/** Resolves after `ms`, the pause between two polls of an export or an import. @internal */
export const wait = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
