import { createLogger } from "../logging/logger";
import { isDevBuildArmed, whenArmed } from "../relax/armed";
import { admitsAbsentLimiter as refuseAbsentLimiter } from "./rate-limit.strict";
import type { RelaxAbsentLimiter } from "./types";

/** Admits a request past a rate limiter whose binding is absent, warning that enforcement was skipped. @internal */
export function skipAbsentLimiter(): boolean {
  createLogger("rate-limit").warn("Rate limiter binding not configured — skipping");
  return true;
}

/** Admits a request past an absent limiter binding in a build armed for development, and refuses it otherwise. @internal */
export const admitsAbsentLimiter: RelaxAbsentLimiter = whenArmed(isDevBuildArmed, skipAbsentLimiter, refuseAbsentLimiter);
