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

/** What `openAtRest` answers: the bytes, and the key id whose subkey opened them. @internal */
export interface AuthAtRestOpened {
  readonly plaintext: Uint8Array<ArrayBuffer>;
  readonly kid: string;
}

// The two are told apart because they are different people's problems: `no-key` is an operator who
// retired a key too early and can put it back, `unopenable` is a row that will never open again.
/** Why a sealed frame did not open: its key is off the ring, or the frame itself did not stand up. @internal */
export type AuthAtRestRefusal = "no-key" | "unopenable";
