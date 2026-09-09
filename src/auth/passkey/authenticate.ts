import { type CosePublicKey, base64urlDecodeOrNull, concatBytes, decodeCosePublicKey, sha256 } from "../../crypto/mod";
import { type Result, err, ok } from "../../result/result";
import type { AuthStoreError } from "../errors";
import type { AuthCredential, AuthStoreResult, AuthUser, ChallengeStore, CredentialStore, UserStore } from "../types";
import { type AuthDataReason, verifyAuthData } from "./auth-data";
import { type ClientDataReason, verifyClientData } from "./client-data";
import { passkeyChallengeKey } from "./options";
import { verifyPasskeySignature } from "./signature";

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

function storedKey(credential: AuthCredential): CosePublicKey | null {
  try {
    return decodeCosePublicKey(credential.publicKey).key;
  } catch {
    return null;
  }
}

/** Concatenates the two halves WebAuthn signs: the authenticator data, then the client data's hash. */
async function signedBytes(authenticatorData: Uint8Array<ArrayBuffer>, clientData: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return concatBytes(authenticatorData, await sha256(clientData));
}

function resolveSubject(options: PasskeyAuthenticationVerifyOptions, credential: AuthCredential, handle: string | undefined) {
  if (handle === undefined) return options.users.findById(credential.userId);
  const bytes = base64urlDecodeOrNull(handle);
  // A discoverable login: the authenticator names the account through its own user handle, which is
  // a BLOB column and so is decoded once here rather than compared in the base64url the wire uses.
  if (!bytes) return Promise.resolve(ok(null) as AuthStoreResult<AuthUser | null>);
  return options.users.findByWebAuthnId(bytes);
}

/** Verifies an authentication ceremony, refreshing the credential's counter and backup flag on success. @public */
export async function verifyPasskeyAuthentication(
  options: PasskeyAuthenticationVerifyOptions,
  input: PasskeyAuthenticationInput,
  at: number,
): Promise<Result<PasskeyAuthentication, PasskeyAuthenticationReason | AuthStoreError>> {
  // Taken before anything is judged, for the reason registration takes it first: a challenge that
  // survives a refusal is a challenge an attacker may keep guessing against.
  const taken = await options.challenges.take(passkeyChallengeKey("authenticate", input.sessionId));
  if (!taken.ok) return err(taken.error);
  if (taken.data === null) return err("challenge-not-found");
  if (taken.data.sessionId !== input.sessionId) return err("session-mismatch");

  const response = input.credential.response;
  const clientDataBytes = base64urlDecodeOrNull(response.clientDataJSON);
  if (!clientDataBytes) return err("malformed");
  const clientData = verifyClientData(clientDataBytes, { ceremony: "authenticate", challenge: taken.data.challenge, origin: options.origin });
  if (!clientData.ok) return err(clientData.error);

  const authenticatorDataBytes = base64urlDecodeOrNull(response.authenticatorData);
  const signature = base64urlDecodeOrNull(response.signature);
  if (!authenticatorDataBytes || !signature) return err("malformed");

  const found = await options.credentials.findByCredentialId(input.credential.id);
  if (!found.ok) return err(found.error);
  // The same reason a bad signature answers with, so the response never distinguishes a credential
  // this deployment has never seen from one whose signature simply did not check out.
  if (found.data === null) return err("unrecognised");
  const credential = found.data;

  const authData = await verifyAuthData(authenticatorDataBytes, {
    rpId: options.rpId,
    requireUserVerification: options.requireUserVerification ?? false,
    requireAttestedCredential: false,
  });
  if (!authData.ok) return err(authData.error);

  // WebAuthn L3 §6.1.3 fixes BE for the life of a credential, so a presented value differing from
  // the enrolled one is an authenticator misreporting its own state — the same class of thing
  // `verifyAuthData` already refuses, and the same reason it names.
  if (authData.data.flags.backupEligible !== credential.backupEligible) return err("invalid-backup-state");

  const key = storedKey(credential);
  if (!key) return err("unsupported-key");
  if (!(await verifyPasskeySignature(key, signature, await signedBytes(authenticatorDataBytes, clientDataBytes)))) return err("unrecognised");

  const subject = await resolveSubject(options, credential, response.userHandle);
  if (!subject.ok) return err(subject.error);
  const user = subject.data;
  if (!user || user.id !== credential.userId) return err("unrecognised");
  if (taken.data.userId !== undefined && taken.data.userId !== user.id) return err("unrecognised");
  // Held however the credential row came to exist: a passkey enrolled during an abandoned signup
  // must not pass the email verification it skipped, and a disabled account must not still sign in.
  if (user.deactivatedAt !== null) return err("account-deactivated");
  if (user.emailVerifiedAt === null) return err("account-unverified");

  const presented = authData.data.signCount;
  // Both zero means the authenticator keeps no counter at all, which is legal and common. Anything
  // else must strictly advance, because a counter that repeats is the cloned-authenticator signal.
  if (!(credential.signCount === 0 && presented === 0) && presented <= credential.signCount) return err("sign-count-reused");

  const backedUp = authData.data.flags.backedUp;
  const recorded = await options.credentials.recordUse(credential.id, presented, backedUp, at);
  if (!recorded.ok) return err(recorded.error);
  // The statement's own counter guard is where the race is decided. The rarer no-row case — the
  // credential deleted mid-ceremony — reads as this too, mis-naming one rather than losing both.
  if (!recorded.data) return err("sign-count-reused");

  return ok({ user, credential, signCount: presented, backedUp, userVerified: authData.data.flags.userVerified });
}
