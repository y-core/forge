import { base64urlEncode, randomBytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AuthStoreError } from "../errors";
import { verifyPasskeyAuthentication } from "../passkey/authenticate";
import { createPasskeyRegistrationOptions, createPasskeyRequestOptions, passkeyTtlSeconds } from "../passkey/options";
import { verifyPasskeyRegistration } from "../passkey/register";
import type { PasskeyAssertionCredential, PasskeyAuthenticationReason } from "../passkey/types";
import type { PasskeyCeremonyOptions, UserVerification } from "../passkey/types";
import type { PasskeyRegistrationCredential, PasskeyRegistrationReason } from "../passkey/types";
import type { AuthFactor, AuthStoreResult } from "../types";
import type { AuthFactorChallenge, AuthFactorReason, AuthFactorVerified, EnrollableFactorService } from "./types";
import type { PasskeyFactorOptions, PasskeyFactorRole } from "./types";

// A step-up exists to demand a fresh human gesture, so verification is required; as the primary
// factor it would only lock out authenticators that cannot do it and buy the sign-in nothing.
const PASSKEY_USER_VERIFICATION: Readonly<Record<PasskeyFactorRole, UserVerification>> = { primary: "preferred", "step-up": "required" };

/** Bytes of the WebAuthn user handle a discoverable login resolves the account from. */
const WEBAUTHN_HANDLE_BYTES = 64;

function jsonObject(presented: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(presented);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function ceremonyFields(value: unknown): { id: string; response: Record<string, unknown> } | null {
  const parsed = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  const id = parsed?.id;
  const response = parsed?.response;
  if (typeof id !== "string" || typeof response !== "object" || response === null) return null;
  return { id, response: response as Record<string, unknown> };
}

function parseRegistrationCredential(presented: unknown): PasskeyRegistrationCredential | null {
  const fields = ceremonyFields(presented);
  if (!fields) return null;
  const { clientDataJSON, attestationObject, transports } = fields.response;
  if (typeof clientDataJSON !== "string" || typeof attestationObject !== "string") return null;
  return {
    id: fields.id,
    response: {
      clientDataJSON,
      attestationObject,
      ...(Array.isArray(transports) ? { transports: transports.filter((value): value is string => typeof value === "string") } : {}),
    },
  };
}

// The name the visitor typed rides in the factor's own opaque payload rather than in a fourth
// parameter on `completeEnrolment`, which every other factor would then carry for nothing.
/** The enrolment envelope the finish endpoint forwards: the ceremony credential and the name for it. */
function parseEnrolment(presented: string): { credential: PasskeyRegistrationCredential; label: string | null } | null {
  const envelope = jsonObject(presented);
  const credential = parseRegistrationCredential(envelope?.credential);
  if (credential === null) return null;
  const nickname = envelope?.nickname;
  const label = typeof nickname === "string" ? nickname.trim() : "";
  return { credential, label: label === "" ? null : label };
}

function parseAssertionCredential(presented: string): PasskeyAssertionCredential | null {
  const fields = ceremonyFields(jsonObject(presented));
  if (!fields) return null;
  const { clientDataJSON, authenticatorData, signature, userHandle } = fields.response;
  if (typeof clientDataJSON !== "string" || typeof authenticatorData !== "string" || typeof signature !== "string") return null;
  return { id: fields.id, response: { clientDataJSON, authenticatorData, signature, ...(typeof userHandle === "string" ? { userHandle } : {}) } };
}

function ceremonyReason(error: PasskeyAuthenticationReason | PasskeyRegistrationReason | AuthStoreError): AuthFactorReason {
  if (error instanceof AuthStoreError) return "unavailable";
  return error === "challenge-not-found" ? "expired" : "unrecognised";
}

/** Runs the passkey ceremonies behind the factor contract, at the verification strength its role demands. @public */
export function createPasskeyFactor(options: PasskeyFactorOptions): EnrollableFactorService {
  const userVerification = PASSKEY_USER_VERIFICATION[options.role];
  const requireUserVerification = userVerification === "required";
  const ttlSeconds = passkeyTtlSeconds("createPasskeyFactor", options.ttlSeconds);

  function ceremonyOptions(): PasskeyCeremonyOptions {
    return {
      rpId: options.rpId,
      rpName: options.rpName,
      challenges: options.challenges,
      credentials: options.credentials,
      userVerification,
      ttlSeconds,
      ...(options.algorithms ? { algorithms: options.algorithms } : {}),
    };
  }

  function verifyOptions() {
    return {
      rpId: options.rpId,
      origin: options.origin,
      challenges: options.challenges,
      credentials: options.credentials,
      requireUserVerification,
      ...(options.algorithms ? { algorithms: options.algorithms } : {}),
    };
  }

  async function resolveUserHandle(userId: string, at: number): Promise<Result<Uint8Array<ArrayBuffer>, AuthFactorReason>> {
    const found = await options.users.findById(userId);
    if (!found.ok) return err("unavailable");
    if (!found.data) return err("unrecognised");
    if (found.data.webauthnId) return ok(found.data.webauthnId);
    // Minted lazily and set only if absent, so a request that lost the race reads back the handle
    // the winner minted rather than failing on a conflict it can do nothing about.
    const minted = await options.users.setWebAuthnIdIfAbsent(userId, randomBytes(WEBAUTHN_HANDLE_BYTES), at);
    if (!minted.ok) return err("unavailable");
    const handle = minted.data?.webauthnId;
    return handle ? ok(handle) : err("unrecognised");
  }

  async function createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const built = await createPasskeyRequestOptions(ceremonyOptions(), { sessionId: options.sessionId, userId });
    if (!built.ok) return err("unavailable");
    return ok({ kind: "passkey", expiresAt: at + ttlSeconds * 1000, options: { ...built.data } });
  }

  async function verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>> {
    const credential = parseAssertionCredential(presented);
    if (!credential) return err("unrecognised");
    const verified = await verifyPasskeyAuthentication(
      { ...verifyOptions(), users: options.users },
      { sessionId: options.sessionId, credential },
      at,
    );
    if (!verified.ok) return err(ceremonyReason(verified.error));
    if (verified.data.user.id !== userId) return err("unrecognised");
    return ok({ kind: "passkey", userId, verifiedAt: at });
  }

  async function beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const handle = await resolveUserHandle(userId, at);
    if (!handle.ok) return err(handle.error);
    const subject = await options.subject(userId);
    const built = await createPasskeyRegistrationOptions(ceremonyOptions(), {
      userId,
      userHandle: base64urlEncode(handle.data),
      name: subject.name,
      displayName: subject.displayName,
      sessionId: options.sessionId,
    });
    if (!built.ok) return err("unavailable");
    return ok({ kind: "passkey", expiresAt: at + ttlSeconds * 1000, options: { ...built.data } });
  }

  async function completeEnrolment(userId: string, presented: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>> {
    const enrolment = parseEnrolment(presented);
    if (!enrolment) return err("unrecognised");
    const verified = await verifyPasskeyRegistration(
      verifyOptions(),
      { sessionId: options.sessionId, userId, credential: enrolment.credential, label: enrolment.label },
      at,
    );
    if (!verified.ok) return err(ceremonyReason(verified.error));

    // The ceremony is the confirmation: the user held the authenticator and answered its prompt,
    // which is the same proof a later step-up would ask for.
    const existing = await options.factors.find(userId, "passkey");
    if (!existing.ok) return err("unavailable");
    if (existing.data?.confirmedAt != null) return ok(existing.data);
    if (existing.data) {
      const confirmed = await options.factors.confirm(existing.data.id, userId, at);
      if (!confirmed.ok) return err("unavailable");
      return ok({ ...existing.data, confirmedAt: at, updatedAt: at });
    }
    const enrolled = await options.factors.enrol({ userId, kind: "passkey", confirmedAt: at }, at);
    return enrolled.ok ? ok(enrolled.data) : err("unavailable");
  }

  async function listEnrolments(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>> {
    const found = await options.factors.find(userId, "passkey");
    return found.ok ? ok(found.data ? [found.data] : []) : err(found.error);
  }

  return {
    kind: "passkey",
    enrolment: "explicit",
    capabilities: { primary: true, stepUp: true },
    challengeTtlMs: ttlSeconds * 1000,
    // A ceremony, not a code: there is no field for a page to size.
    codeDigits: null,
    reissueAfterMs: null,
    createChallenge,
    verifyChallenge,
    beginEnrolment,
    completeEnrolment,
    listEnrolments,
  };
}
