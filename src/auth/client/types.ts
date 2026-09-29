import type { PasskeyMode } from "../types";

/** Everything a ceremony needs, read once off the scope root's contract attributes. @internal */
export interface PasskeyContract {
  mode: PasskeyMode;
  optionsPath: string;
  verifyPath: string;
  optionsToken: string;
  verifyToken: string;
  csrfHeader: string;
  redirect: string;
}

/** The `navigator.credentials` slice a ceremony calls, named so a test can hand over a fake. @internal */
export interface PasskeyCredentials {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

/** The realm capabilities a ceremony needs, taken as an argument so the core is DOM-free. @internal */
export interface PasskeyRealm {
  /** Whether the realm exposes WebAuthn at all — checked before any network call is made. */
  supported: boolean;
  credentials: PasskeyCredentials | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  navigate: (path: string) => void;
}

/** What a verified ceremony's PRF evaluation handed the page. @public */
export interface PasskeyPrfResult {
  readonly mode: PasskeyMode;
  /** base64url — the key the step-up salts were given under. */
  readonly credentialId: string;
  /** Exactly 32 bytes, or `null` when the authenticator returned no real result. */
  readonly output: Uint8Array<ArrayBuffer> | null;
}

/** @public */
export type PasskeyPrfHandler = (result: PasskeyPrfResult) => void | Promise<void>;
