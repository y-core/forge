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
