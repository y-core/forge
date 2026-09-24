import type { DevAllowance } from "./types";
import type { DevAllowanceOptions } from "./types";

/** Mints the allowances a development entry point grants, and production never imports. @public */
export function devAllowance(options: DevAllowanceOptions): DevAllowance {
  return { options: { ...options } } as DevAllowance;
}
