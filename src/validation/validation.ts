import * as v from "valibot";

/**
 * Result of a validation pass: success carries the parsed data, failure carries human-readable
 * error messages. Canonically defined in the result module and surfaced here so validation code
 * (and `defineAction`'s `validate`) has a single, documented import. @public
 */
export type { ValidationResult } from "../result/result";
/** The valibot namespace — forge's canonical validation entry point. @public */
export { v };
