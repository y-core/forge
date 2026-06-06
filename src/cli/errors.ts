import type { CliErrorKind } from "./types";

export class CliError extends Error {
  readonly kind: CliErrorKind;

  constructor(kind: CliErrorKind, message: string) {
    super(message);
    this.name = "CliError";
    this.kind = kind;
  }
}

export function formatError(err: CliError): string {
  return `Error: ${err.message}`;
}
