/** Root key material for at-rest sealing — the active key id, plus every id still valid for opening. @public */
export interface KeyRing {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
}

/** What a frame is bound to: an app-named purpose selecting the subkey, and the stored row as associated data. @public */
export interface AtRestBinding {
  readonly purpose: string;
  readonly context: Uint8Array<ArrayBuffer>;
}

/** What `openAtRest` answers: the bytes, and the key id whose subkey opened them. @public */
export interface AtRestOpened {
  readonly plaintext: Uint8Array<ArrayBuffer>;
  readonly kid: string;
}

/** Why a frame did not open: its key is off the ring, or the frame itself did not stand up. @public */
export type AtRestRefusal = "no-key" | "unopenable";

/** The labels a ring fingerprints key ids and expands versioned subkeys under. @internal */
export interface KeyRingDomain {
  readonly keyIdLabel: string;
  readonly subkeyLabel: string;
}

/** One subkey's coordinates within a ring. @internal */
export interface KeyRingSubkeyRequest {
  readonly domain: KeyRingDomain;
  readonly kid: string;
  readonly purpose: string;
}

/** Which Web Crypto algorithm a subkey is imported under. @internal */
export type KeyRingKeyUse = "aead" | "hmac";

/** An HMAC and the id of the key whose subkey made it. @internal */
export interface KeyRingSignature {
  readonly kid: string;
  readonly mac: Uint8Array<ArrayBuffer>;
}

/** Why a MAC did or did not check out: its key is off the ring, or the MAC is not the one that key makes. @internal */
export type KeyRingVerdict = "verified" | "no-key" | "forged";

/** What `derivePseudonym` keys: an app-named purpose selecting the subkey, and the id it stands in for. @public */
export interface PseudonymRequest {
  readonly purpose: string;
  readonly value: string | Uint8Array<ArrayBuffer>;
}
