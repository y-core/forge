import type { CosePublicKey } from "../../crypto/mod";
import type { AuthCredential } from "../types";
import type { AuthUser } from "../types";
import type { ChallengeStore } from "../types";
import type { CredentialStore } from "../types";
import type { UserStore } from "../types";
import type { AuthAlgorithm } from "../types";

/** Why authenticator data was refused. Each condition is its own reason. @public */
export type AuthDataReason = "invalid-backup-state" | "malformed" | "rp-id-mismatch" | "unsupported-key" | "user-not-present" | "user-not-verified";

/** The flags byte, spelled out. @public */
export interface AuthDataFlags {
  readonly userPresent: boolean;
  readonly userVerified: boolean;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
  readonly attestedCredentialData: boolean;
}

/** The attested credential a registration ceremony carries. @public */
export interface AttestedCredential {
  readonly credentialId: string;
  readonly publicKey: CosePublicKey;
  readonly publicKeyBytes: Uint8Array<ArrayBuffer>;
}

/** Authenticator data, parsed. @public */
export interface AuthData {
  readonly rpIdHash: Uint8Array<ArrayBuffer>;
  readonly flags: AuthDataFlags;
  readonly signCount: number;
  readonly attested?: AttestedCredential;
}

/** What the presented authenticator data is held against. @public */
export interface AuthDataExpectation {
  readonly rpId: string;
  readonly requireUserVerification: boolean;
  readonly requireAttestedCredential: boolean;
}

/** Why an authentication ceremony was refused. An unknown credential and a bad signature share one reason. @public */
export type PasskeyAuthenticationReason =
  | AuthDataReason
  | ClientDataReason
  | "account-deactivated"
  | "account-unverified"
  | "challenge-not-found"
  | "session-mismatch"
  | "sign-count-reused"
  | "unrecognised";

/** The assertion response of a finished ceremony, base64url as the browser's JSON carries it. @public */
export interface PasskeyAssertionResponse {
  readonly clientDataJSON: string;
  readonly authenticatorData: string;
  readonly signature: string;
  readonly userHandle?: string;
}

/** The credential a finished authentication ceremony posts back. @public */
export interface PasskeyAssertionCredential {
  readonly id: string;
  readonly response: PasskeyAssertionResponse;
}

/** One authentication ceremony, as it is presented for verification. @public */
export interface PasskeyAuthenticationInput {
  readonly sessionId: string;
  readonly credential: PasskeyAssertionCredential;
}

/** What an authentication ceremony is held against, and where its outcome is recorded. @public */
export interface PasskeyAuthenticationVerifyOptions {
  readonly rpId: string;
  readonly origin: string;
  readonly challenges: ChallengeStore;
  readonly credentials: CredentialStore;
  readonly users: UserStore;
  readonly requireUserVerification?: boolean;
}

/** What a passed authentication ceremony establishes, with the counter and flags it presented. @public */
export interface PasskeyAuthentication {
  readonly user: AuthUser;
  readonly credential: AuthCredential;
  readonly signCount: number;
  readonly backedUp: boolean;
  readonly userVerified: boolean;
}

/** Which ceremony a `clientDataJSON` belongs to. @public */
export type PasskeyCeremony = "authenticate" | "register";

/** Why client data was refused. Each condition is its own reason, so a regression names the check. @public */
export type ClientDataReason = "challenge-mismatch" | "cross-origin" | "malformed" | "origin-mismatch" | "type-mismatch";

/** The fields of `clientDataJSON` this verification reads. @public */
export interface ClientData {
  readonly type: string;
  readonly challenge: string;
  readonly origin: string;
  readonly crossOrigin?: boolean;
}

/** What the presented client data is held against. @public */
export interface ClientDataExpectation {
  readonly ceremony: PasskeyCeremony;
  readonly challenge: string;
  readonly origin: string;
}

/** Anything this fixture's CBOR encoder writes. @internal */
export type CeremonyCborValue = number | string | Uint8Array<ArrayBuffer> | Map<CeremonyCborValue, CeremonyCborValue>;

/** A generated credential key pair, with the COSE encoding of its public half. @internal */
export interface PasskeyKeyPair {
  readonly algorithm: AuthAlgorithm;
  readonly cosePublicKey: Uint8Array<ArrayBuffer>;
  sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

/** What one authenticator-data blob declares. @internal */
export interface AuthenticatorDataFixture {
  readonly rpId: string;
  readonly flags: number;
  readonly signCount?: number;
  readonly credentialId?: Uint8Array<ArrayBuffer>;
  readonly cosePublicKey?: Uint8Array<ArrayBuffer>;
}

/** What one registration ceremony fixture declares. @internal */
export interface PasskeyRegistrationFixture {
  readonly key: PasskeyKeyPair;
  readonly rpId: string;
  readonly origin: string;
  readonly challenge: string;
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly flags?: number;
  readonly signCount?: number;
  readonly fmt?: string;
  readonly attStmt?: Map<CeremonyCborValue, CeremonyCborValue>;
  readonly transports?: readonly string[];
  readonly trailing?: Uint8Array<ArrayBuffer>;
}

/** What one authentication ceremony fixture declares. @internal */
export interface PasskeyAssertionFixture {
  readonly key: PasskeyKeyPair;
  readonly rpId: string;
  readonly origin: string;
  readonly challenge: string;
  readonly credentialId: string;
  readonly flags?: number;
  readonly signCount?: number;
  readonly userHandle?: string;
  readonly signOver?: Uint8Array<ArrayBuffer>;
}

/** How firmly the authenticator must establish that the right person is present. @public */
export type UserVerification = "discouraged" | "preferred" | "required";

/** One entry of `pubKeyCredParams` — the shape `navigator.credentials` reads. @public */
export interface PublicKeyCredentialParameter {
  readonly type: "public-key";
  readonly alg: AuthAlgorithm;
}

/** One entry of `excludeCredentials` or `allowCredentials`. @public */
export interface PublicKeyCredentialDescriptor {
  readonly type: "public-key";
  readonly id: string;
  readonly transports?: readonly string[];
}

/** The options a registration ceremony hands the browser. @public */
export interface PasskeyRegistrationOptions {
  readonly rp: { readonly id: string; readonly name: string };
  readonly user: { readonly id: string; readonly name: string; readonly displayName: string };
  readonly challenge: string;
  readonly pubKeyCredParams: readonly PublicKeyCredentialParameter[];
  readonly timeout: number;
  readonly attestation: "none";
  readonly excludeCredentials: readonly PublicKeyCredentialDescriptor[];
  readonly authenticatorSelection: { readonly residentKey: "preferred" | "required"; readonly userVerification: UserVerification };
}

/** The options an authentication ceremony hands the browser. @public */
export interface PasskeyRequestOptions {
  readonly rpId: string;
  readonly challenge: string;
  readonly timeout: number;
  readonly userVerification: UserVerification;
  readonly allowCredentials: readonly PublicKeyCredentialDescriptor[];
}

/** What both ceremonies need to know about this deployment. @public */
export interface PasskeyCeremonyOptions {
  rpId: string;
  rpName: string;
  challenges: ChallengeStore;
  credentials: CredentialStore;
  algorithms?: readonly AuthAlgorithm[];
  userVerification?: UserVerification;
  residentKey?: "preferred" | "required";
  ttlSeconds?: number;
  challengeBytes?: number;
}

/** Who the credential is being registered for — `userHandle` is the base64url form of the `webauthnId` `UserStore.setWebAuthnIdIfAbsent` mints. @public */
export interface PasskeyRegistrationSubject {
  readonly userId: string;
  readonly userHandle: string;
  readonly name: string;
  readonly displayName: string;
  readonly sessionId: string;
}

/** Why a registration ceremony was refused. Each condition is its own reason. @public */
export type PasskeyRegistrationReason =
  | AuthDataReason
  | ClientDataReason
  | "attestation-not-empty"
  | "challenge-not-found"
  | "credential-id-mismatch"
  | "session-mismatch"
  | "subject-mismatch"
  | "unsupported-algorithm"
  | "unsupported-attestation";

/** The attestation response of a finished ceremony, base64url as the browser's JSON carries it. @public */
export interface PasskeyRegistrationResponse {
  readonly clientDataJSON: string;
  readonly attestationObject: string;
  readonly transports?: readonly string[];
}

/** The credential a finished registration ceremony posts back. @public */
export interface PasskeyRegistrationCredential {
  readonly id: string;
  readonly response: PasskeyRegistrationResponse;
}

/** One registration ceremony, as it is presented for verification. @public */
export interface PasskeyRegistrationInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly credential: PasskeyRegistrationCredential;
  readonly label?: string | null;
}

/** What a registration ceremony is held against, and where the credential it establishes is written. @public */
export interface PasskeyRegistrationVerifyOptions {
  readonly rpId: string;
  readonly origin: string;
  readonly challenges: ChallengeStore;
  readonly credentials: CredentialStore;
  readonly algorithms?: readonly AuthAlgorithm[];
  readonly requireUserVerification?: boolean;
}
