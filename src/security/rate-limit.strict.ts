import type { RelaxAbsentLimiter } from "./types";

/** Refuses a request past a rate limiter whose binding is absent. @internal */
export const admitsAbsentLimiter: RelaxAbsentLimiter = () => false;
