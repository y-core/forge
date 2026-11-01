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

/** Whether no retry can change the outcome: the options, the token or the database id is wrong. @internal */
export function isPermanentBackupFailure(error: unknown): boolean {
  return error instanceof D1BackupError && (error.kind === "options" || error.kind === "auth" || error.kind === "not-found");
}
