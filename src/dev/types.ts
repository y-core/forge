// Not exported, so the interface cannot be satisfied by an object literal written anywhere else:
// minting one means importing `devAllowance`, which is what `validate-dev-boundary` rule C sees.
declare const brand: unique symbol;

/** A capability only a development entry may mint; every relaxation below one requires it. @public */
export interface DevAllowance {
  readonly [brand]: true;
  readonly options: DevAllowanceOptions;
}

/** The relaxations a development entry point may grant; every key is optional and every one is off by default. @public */
export interface DevAllowanceOptions {
  /** Lets `rateLimit` skip enforcement when its binding is absent, instead of answering 503. */
  rateLimitOptional?: true;
  /** Lets the Fetch-Metadata guard accept a request carrying no `Sec-Fetch-Site` header. */
  missingFetchMetadata?: true;
  /** Lets the error page print the thrown message instead of a fixed sentence. */
  errorDetail?: true;
  /** Lets `verifyTurnstile` skip the hostname comparison under one of Cloudflare's published testing secrets. */
  turnstileTestingSecrets?: true;
  /** Origins appended to the derived allowlist — a dev tunnel or a loopback port, never a production origin. */
  extraOrigins?: string[];
}
