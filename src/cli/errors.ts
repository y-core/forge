import type { CliErrorKind } from "./types";

/** Error carrying a `CliErrorKind`, thrown for a user-facing CLI failure rather than a programming error. @public */
export class CliError extends Error {
  readonly kind: CliErrorKind;

  constructor(kind: CliErrorKind, message: string) {
    super(message);
    this.name = "CliError";
    this.kind = kind;
  }
}

/** Renders a `CliError` as the single `Error: <message>` line written to stderr. @public */
export function formatError(err: CliError): string {
  return `Error: ${err.message}`;
}
