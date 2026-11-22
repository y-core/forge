import type { Session } from "@remix-run/session";

import { contextVar } from "../../context/accessor";
import { base64urlEncode } from "../../crypto/primitives/base64";
import { randomBytes } from "../../crypto/primitives/bytes";
import { sha256 } from "../../crypto/primitives/digest";
import { err, ok } from "../../result/result";
import type { AuthFactorCaller } from "../factors/types";
import type { AuthFactorKind, AuthSessionRotation, AuthSessionStepUp, AuthSessionStore, AuthStoreResult, AuthWriteOrigin } from "../types";
import type { ApprovalMark, AuthIdentity } from "./types";

/** What auth/web throws on a request no session middleware ran on. @internal */
export const NO_SESSION =
  "auth/web: no session on this request — mount session middleware (`createAnonymousSession`, or `sessionMiddleware` behind your own resolver) ahead of the auth routes and guards, or what they write and check is held nowhere.";

const AUTH_SESSION_TOKEN_BYTES = 32;

const AUTH_SESSION_TOKEN_LENGTH = Math.ceil((AUTH_SESSION_TOKEN_BYTES * 4) / 3);

const AUTH_OTP_BINDING_BYTES = 32;

const AUTH_OTP_BINDING_LENGTH = Math.ceil((AUTH_OTP_BINDING_BYTES * 4) / 3);

/** The session key the signed-in session's token is stored under; its row is keyed by the token's SHA-256. @internal */
export const AUTH_SESSION_TOKEN_KEY = "auth.sessionToken";

// The address rides the session and not the URL: `AuthSigninFlow.complete` needs the address the
// code was issued to, and a query parameter carrying it lands in history, `Referer` and proxy logs.
/** The session key an unfinished sign-in keeps the address it challenged under. @public */
export const AUTH_PENDING_SIGNIN_SESSION_KEY = "auth.pendingSignin";

/** The session key a sign-out leaves set while the browser still owes the storage half of its `Clear-Site-Data`. @public */
export const AUTH_SITE_DATA_OWED_SESSION_KEY = "auth.siteDataOwed";

/** The session key holding the value this browser's emailed codes are bound to. @internal */
export const AUTH_OTP_BINDING_SESSION_KEY = "auth.otpBinding";

/** The session key recording when this session last presented the administrator code. @internal */
export const APPROVAL_SESSION_KEY = "approval.at";

/** The session key holding the keyed digest of the administrator code that approval was presented under, never the code. @internal */
export const APPROVAL_CODE_SESSION_KEY = "approval.code";

/** Per-request accessor for the identity `requireAuth` or `resolveAuth` establishes. @public */
export const authCtx = contextVar<AuthIdentity>("auth.identity");

/** The finite timestamp `session` holds under `key`, or `null` when it holds none. */
function readStamp(session: Session, key: string): number | null {
  const at = session.get(key);
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

function readToken(session: Session): string | null {
  const token = session.get(AUTH_SESSION_TOKEN_KEY);
  return typeof token === "string" && token.length === AUTH_SESSION_TOKEN_LENGTH ? token : null;
}

function mintToken(): string {
  return base64urlEncode(randomBytes(AUTH_SESSION_TOKEN_BYTES));
}

function tokenHash(token: string): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(token);
}

function clearCookieApproval(session: Session): void {
  session.unset(APPROVAL_SESSION_KEY);
  session.unset(APPROVAL_CODE_SESSION_KEY);
}

/** Whether `session` carries a signed-in session's token, read without touching the store. @internal */
export function hasAuthSessionToken(session: Session): boolean {
  return readToken(session) !== null;
}

/** Signs `userId` in on `session` with `options.kind` as of `at` and no later than `now` — a new row and token labelled with `options.device`, replacing any the session held, stepped up at sign-in with that kind where `steppedUp` — and rotates the session id. @public */
export async function establishAuthSession(
  session: Session,
  sessions: Pick<AuthSessionStore, "create">,
  userId: string,
  at: number,
  now: number,
  options: { readonly kind: AuthFactorKind; readonly steppedUp?: boolean; readonly device?: string | null },
): Promise<AuthStoreResult<void>> {
  // Never later than now, for the reason `markAuthStepUp` clamps: a stamp in the future is a
  // lifetime that never runs out.
  const signedInAt = Math.min(at, now);
  const token = mintToken();
  const previous = readToken(session);
  const created = await sessions.create(
    {
      tokenHash: await tokenHash(token),
      userId,
      signedInAt,
      signedInWith: options.kind,
      device: options.device ?? null,
      ...(options.steppedUp === true ? { stepUp: { at: signedInAt, kind: options.kind } } : {}),
    },
    previous === null ? null : await tokenHash(previous),
  );
  if (!created.ok) return created;
  session.set(AUTH_SESSION_TOKEN_KEY, token);
  session.unset(AUTH_PENDING_SIGNIN_SESSION_KEY);
  session.unset(AUTH_SITE_DATA_OWED_SESSION_KEY);
  clearCookieApproval(session);
  session.regenerateId(true);
  return ok();
}

/** Records on `session` the address a started sign-in is waiting on. @public */
export function markAuthSigninPending(session: Session, email: string): void {
  session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, email);
}

/** The address an unfinished sign-in is waiting on, or `null` when this session has none. @public */
export function resolveAuthSigninPending(session: Session): string | null {
  const email = session.get(AUTH_PENDING_SIGNIN_SESSION_KEY);
  return typeof email === "string" && email.length > 0 ? email : null;
}

/** A new token for the row `session` names, and `apply` to put it on the session once the store has moved the row — `null` when it carries no signed-in token. @internal */
export async function mintAuthSessionRotation(
  session: Session,
): Promise<{ readonly rotation: AuthSessionRotation; readonly apply: () => void } | null> {
  const previous = readToken(session);
  if (previous === null) return null;
  const token = mintToken();
  const apply = (): void => {
    session.set(AUTH_SESSION_TOKEN_KEY, token);
    session.regenerateId(true);
  };
  return { rotation: { replaces: await tokenHash(previous), tokenHash: await tokenHash(token) }, apply };
}

/** Moves the row `session` names onto a new token, recording `stepUp` where given, and rotates the session id — so a token read before a privilege change does not carry it. @internal */
export async function rotateAuthSession(
  session: Session,
  sessions: Pick<AuthSessionStore, "rotate">,
  stepUp?: AuthSessionStepUp,
): Promise<AuthStoreResult<boolean>> {
  const minted = await mintAuthSessionRotation(session);
  if (minted === null) return ok(false);
  const rotated = await sessions.rotate(minted.rotation.replaces, minted.rotation.tokenHash, stepUp);
  if (rotated.ok && rotated.data) minted.apply();
  return rotated;
}

// A mark is a memory of something that happened, so it cannot be in the future; a skewed clock or
// an injected one must not be able to make one last forever.
/** Records that a step-up verification with `kind` of the row `session` names passed at `at`, never later than the caller's own `now`, moving the row onto a new token. @public */
export function markAuthStepUp(
  session: Session,
  sessions: Pick<AuthSessionStore, "rotate">,
  at: number,
  now: number,
  kind: AuthFactorKind,
): Promise<AuthStoreResult<boolean>> {
  return rotateAuthSession(session, sessions, { at: Math.min(at, now), kind });
}

/** The SHA-256 the row `session` names is keyed by, or `null` when it carries no signed-in token. @internal */
export async function authSessionTokenHash(session: Session): Promise<Uint8Array<ArrayBuffer> | null> {
  const token = readToken(session);
  return token === null ? null : tokenHash(token);
}

/** The origin a security-relevant write made from `session` carries: the SHA-256 of its signed-in token, or none. @internal */
export async function authWriteOrigin(session: Session): Promise<AuthWriteOrigin> {
  return { keep: await authSessionTokenHash(session) };
}

/** The value `session` binds emailed codes to, minted and stored on first use. @internal */
export function authOtpBinding(session: Session): string {
  const held = session.get(AUTH_OTP_BINDING_SESSION_KEY);
  if (typeof held === "string" && held.length === AUTH_OTP_BINDING_LENGTH) return held;
  const minted = base64urlEncode(randomBytes(AUTH_OTP_BINDING_BYTES));
  session.set(AUTH_OTP_BINDING_SESSION_KEY, minted);
  return minted;
}

/** What `session` contributes to a factor call: its code binding and the SHA-256 of its signed-in token. @internal */
export async function authFactorCaller(session: Session): Promise<AuthFactorCaller> {
  return { binding: authOtpBinding(session), keep: await authSessionTokenHash(session) };
}

/** Records on `session` that the administrator code `mark.digest` names was presented at `mark.presentedAt`, rotating the session id. @internal */
export function markApproval(session: Session, mark: ApprovalMark): void {
  session.set(APPROVAL_SESSION_KEY, mark.presentedAt);
  session.set(APPROVAL_CODE_SESSION_KEY, mark.digest);
  // A privilege change on a session no sign-in may have rotated: a fixated id must not inherit it.
  session.regenerateId(true);
}

/** The administrator approval `session` holds, or `null` when it holds none. @internal */
export function resolveApprovalMark(session: Session): ApprovalMark | null {
  const presentedAt = readStamp(session, APPROVAL_SESSION_KEY);
  const digest = session.get(APPROVAL_CODE_SESSION_KEY);
  return presentedAt === null || typeof digest !== "string" || digest.length === 0 ? null : { presentedAt, digest };
}

/** Deletes the row `session` names, then destroys the session — or, with `keepVisitorData`, drops only its token, pending sign-in, code binding and approval and rotates its id. @public */
export async function clearAuthSession(
  session: Session,
  sessions: Pick<AuthSessionStore, "remove">,
  signOut?: { readonly keepVisitorData?: true | undefined },
): Promise<AuthStoreResult<void>> {
  const token = readToken(session);
  if (token !== null) {
    const removed = await sessions.remove(await tokenHash(token));
    if (!removed.ok) return err(removed.error);
  }
  if (signOut?.keepVisitorData !== true) {
    session.destroy();
    return ok();
  }
  session.unset(AUTH_SESSION_TOKEN_KEY);
  session.unset(AUTH_PENDING_SIGNIN_SESSION_KEY);
  session.unset(AUTH_OTP_BINDING_SESSION_KEY);
  clearCookieApproval(session);
  session.regenerateId(true);
  return ok();
}

/** Deletes every session `userId` holds except the one `session` names, recording `sessions-revoked` as of `at` where any went, and answers how many went. @public */
export async function revokeOtherAuthSessions(
  session: Session,
  sessions: Pick<AuthSessionStore, "revokeOthers">,
  userId: string,
  at: number,
): Promise<AuthStoreResult<number>> {
  const origin = await authWriteOrigin(session);
  if (origin.keep === null) return ok(0);
  return sessions.revokeOthers(userId, at, origin);
}

/** Reads the identity the row `session` names, live as of `at` and owned by an active user. @public */
export async function resolveAuthIdentity(
  session: Session,
  sessions: Pick<AuthSessionStore, "resolve">,
  at: number,
): Promise<AuthStoreResult<AuthIdentity | null>> {
  const token = readToken(session);
  // No clear on the anonymous path: `Session.unset` dirties even an absent key, so under KV every
  // anonymous GET would perform a real `kv.put` before returning an id the middleware then suppresses.
  if (token === null) return ok(null);

  const found = await sessions.resolve(await tokenHash(token), at);
  // A failure leaves the session alone: clearing on a blip would sign every user out of it.
  if (!found.ok) return err(found.error);
  if (found.data === null) {
    session.unset(AUTH_SESSION_TOKEN_KEY);
    return ok(null);
  }

  const { user, session: row } = found.data;
  return ok({ userId: user.id, email: user.email, isAdmin: user.isAdmin, sessionId: row.id, stepUpAt: row.stepUpAt, stepUpKind: row.stepUpKind });
}
