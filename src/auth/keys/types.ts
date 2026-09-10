/** What a token's subkey is derived for. Two purposes never share key material. @public */
export type AuthTokenPurpose = "identity" | "nonce" | "totpWrap" | "verify";

/** Why a token did not decode. Never echoed to a client — see `ERROR_HANDLING.md` §1c. @public */
export type AuthTokenReason = "expired" | "malformed" | "not-authentic" | "unknown-key" | "unsupported-version";

/** A decoded token's payload and its two timestamps, in epoch milliseconds. @public */
export interface AuthTokenClaims {
  readonly payload: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** @public */
export interface AuthTokenOptions {
  now?: number;
}
