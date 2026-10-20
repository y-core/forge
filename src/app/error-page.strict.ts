import type { RelaxErrorDisclosure } from "./types";

/** Discloses nothing, so the error page stays fixed. @internal */
export const disclosedErrorMessage: RelaxErrorDisclosure = () => undefined;
