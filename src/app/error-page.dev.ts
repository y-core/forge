import { isDevBuildArmed, whenArmed } from "../context/armed.dev";
import { disclosedErrorMessage as discloseNothing } from "./error-page.strict";
import type { RelaxErrorDisclosure } from "./types";

/** The thrown message a development error page discloses, as plain text the page escapes. @internal */
export function discloseThrownMessage(error: Error): string {
  return error.message;
}

/** Discloses the thrown message in a build armed for development, and nothing otherwise. @internal */
export const disclosedErrorMessage: RelaxErrorDisclosure = whenArmed(isDevBuildArmed, discloseThrownMessage, discloseNothing);
