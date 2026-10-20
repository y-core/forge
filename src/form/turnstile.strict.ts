import type { RelaxTestingSecret } from "./types";

/** Refuses every Turnstile testing secret. @internal */
export const admitsTestingSecret: RelaxTestingSecret = () => false;
