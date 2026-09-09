import { base64urlEncode, randomBytes } from "../../crypto/mod";
import { type Result, err, ok } from "../../result/result";
import {
  AUTH_PASSKEY_CHALLENGE_BYTES,
  AUTH_PASSKEY_CHALLENGE_MIN_BYTES,
  AUTH_PASSKEY_TTL_MAX_SECONDS,
  AUTH_PASSKEY_TTL_MIN_SECONDS,
  AUTH_PASSKEY_TTL_SECONDS,
  AUTH_SUPPORTED_ALGORITHMS,
} from "../config";
import type { AuthStoreError } from "../errors";
import { authLimit } from "../limits";
import type { AuthAlgorithm, AuthChallenge, ChallengeStore, CredentialStore } from "../types";

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

function descriptorsOf(credentials: readonly { credentialId: string; transports: readonly string[] }[]): PublicKeyCredentialDescriptor[] {
  return credentials.map((credential) =>
    credential.transports.length > 0
      ? { type: "public-key" as const, id: credential.credentialId, transports: credential.transports }
      : { type: "public-key" as const, id: credential.credentialId },
  );
}

/** Bytes of challenge entropy this deployment asked for, refused below the specification's floor. */
function challengeBytes(operation: string, requested: number | undefined): number {
  return authLimit(operation, "challengeBytes", requested, {
    fallback: AUTH_PASSKEY_CHALLENGE_BYTES,
    min: AUTH_PASSKEY_CHALLENGE_MIN_BYTES,
    unit: "byte",
    floor: "the floor WebAuthn states for a ceremony challenge",
  });
}

/** Seconds a ceremony this deployment starts stays answerable, refused outside the range a ceremony can use. @internal */
export function passkeyTtlSeconds(operation: string, requested: number | undefined): number {
  return authLimit(operation, "ttlSeconds", requested, {
    fallback: AUTH_PASSKEY_TTL_SECONDS,
    min: AUTH_PASSKEY_TTL_MIN_SECONDS,
    max: AUTH_PASSKEY_TTL_MAX_SECONDS,
    unit: "second",
    floor: "the shortest expiration the challenge store accepts, and less time than an authenticator prompt takes to answer",
    ceiling: "a replayable ceremony challenge must not stay live longer than an emailed code",
  });
}

/** The key a ceremony's challenge is stored under, bound to the session that started it. @internal */
export function passkeyChallengeKey(ceremony: "register" | "authenticate", sessionId: string): string {
  return `passkey:${ceremony}:${sessionId}`;
}

/** Builds the registration options, storing the challenge against the session that asked for it. @public */
export async function createPasskeyRegistrationOptions(
  options: PasskeyCeremonyOptions,
  subject: PasskeyRegistrationSubject,
): Promise<Result<PasskeyRegistrationOptions, AuthStoreError>> {
  const existing = await options.credentials.listByUser(subject.userId);
  if (!existing.ok) return err(existing.error);

  const challenge = base64urlEncode(randomBytes(challengeBytes("createPasskeyRegistrationOptions", options.challengeBytes)));
  const ttlSeconds = passkeyTtlSeconds("createPasskeyRegistrationOptions", options.ttlSeconds);
  const record: AuthChallenge = { challenge, sessionId: subject.sessionId, userId: subject.userId };
  const stored = await options.challenges.put(passkeyChallengeKey("register", subject.sessionId), record, ttlSeconds);
  if (!stored.ok) return err(stored.error);

  return ok({
    rp: { id: options.rpId, name: options.rpName },
    user: { id: subject.userHandle, name: subject.name, displayName: subject.displayName },
    challenge,
    // Built from the configured set, so the browser is never offered an algorithm this deployment
    // cannot verify — enrolling one would lock the user out of the account they just created.
    pubKeyCredParams: (options.algorithms ?? AUTH_SUPPORTED_ALGORITHMS).map((alg) => ({ type: "public-key" as const, alg })),
    timeout: ttlSeconds * 1000,
    // `none` only: every attestation format forge would otherwise have to parse is a verification
    // path it does not implement, and a format it cannot check is one it must not claim to.
    attestation: "none",
    // The browser refuses a re-enrolment of an authenticator already registered here, so the
    // conflict surfaces in the ceremony rather than as a unique-constraint failure afterwards.
    excludeCredentials: descriptorsOf(existing.data),
    authenticatorSelection: { residentKey: options.residentKey ?? "preferred", userVerification: options.userVerification ?? "preferred" },
  });
}

/** Builds the authentication options, storing the challenge against the session that asked for it. @public */
export async function createPasskeyRequestOptions(
  options: PasskeyCeremonyOptions,
  subject: { readonly sessionId: string; readonly userId?: string },
): Promise<Result<PasskeyRequestOptions, AuthStoreError>> {
  // No `userId` is a discoverable sign-in: the authenticator names the user, so an empty
  // `allowCredentials` is what lets it, rather than a list that would leak who is enrolled.
  const allow = subject.userId === undefined ? ok([]) : await options.credentials.listByUser(subject.userId);
  if (!allow.ok) return err(allow.error);

  const challenge = base64urlEncode(randomBytes(challengeBytes("createPasskeyRequestOptions", options.challengeBytes)));
  const ttlSeconds = passkeyTtlSeconds("createPasskeyRequestOptions", options.ttlSeconds);
  const record: AuthChallenge =
    subject.userId === undefined
      ? { challenge, sessionId: subject.sessionId }
      : { challenge, sessionId: subject.sessionId, userId: subject.userId };
  const stored = await options.challenges.put(passkeyChallengeKey("authenticate", subject.sessionId), record, ttlSeconds);
  if (!stored.ok) return err(stored.error);

  return ok({
    rpId: options.rpId,
    challenge,
    timeout: ttlSeconds * 1000,
    userVerification: options.userVerification ?? "preferred",
    allowCredentials: descriptorsOf(allow.data),
  });
}
