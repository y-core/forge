/** Every value the CTAP2 canonical CBOR subset can carry. @internal */
export type CborValue = number | bigint | string | boolean | null | undefined | Uint8Array<ArrayBuffer> | CborValue[] | Map<CborValue, CborValue>;

/** A decoded value together with how many bytes it consumed. @internal */
export interface CborDecoded {
  readonly value: CborValue;
  readonly bytesRead: number;
}

/** The COSE algorithm identifiers a WebAuthn credential may be verified under. @internal */
export type CoseAlgorithm = -7 | -8 | -257;

/** A COSE public key reduced to the algorithm and the raw material WebCrypto imports. @internal */
export type CosePublicKey =
  | { readonly algorithm: -7; readonly curve: "P-256"; readonly point: Uint8Array<ArrayBuffer> }
  | { readonly algorithm: -8; readonly curve: "Ed25519"; readonly point: Uint8Array<ArrayBuffer> }
  | { readonly algorithm: -257; readonly modulus: Uint8Array<ArrayBuffer>; readonly exponent: Uint8Array<ArrayBuffer> };

/** The SHA family an authenticator app may be provisioned with, per RFC 6238 §1.2. @internal */
export type HotpHash = "SHA-1" | "SHA-256" | "SHA-512";

/** @internal */
export interface HotpOptions {
  digits?: number;
  hash?: HotpHash;
}

/** @internal */
export interface TotpOptions extends HotpOptions {
  period?: number;
  epoch?: number;
}

/** The byte encodings a UUID may arrive in — `readonly number[]` is what D1 returns for a `BLOB` column. @public */
export type UuidByteInput = readonly number[] | Uint8Array | ArrayBuffer;

/** Options for {@link createUuidv7Bytes} and {@link createUuidv7}. @public */
export interface Uuidv7Options {
  now?: () => number;
}
