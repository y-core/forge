import type { D1BackupFailureKind } from "./types";

/** Thrown by a backup reader for an object that is not one `forge db backup` wrote. @public */
export class D1BackupError extends Error {
  readonly kind: D1BackupFailureKind;

  constructor(kind: D1BackupFailureKind, message: string) {
    super(message);
    this.name = "D1BackupError";
    this.kind = kind;
  }
}
