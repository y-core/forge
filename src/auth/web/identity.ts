import type { Session } from "@remix-run/session";

import { contextVar } from "../../context/accessor";
import { AUTH_SESSION_MAX_MS } from "../config";
import type { UserStore } from "../types";
import type { AuthIdentity } from "./types";

/** The session key the signed-in user's id is stored under. @public */
export const AUTH_SESSION_KEY = "auth.userId";

// The absolute lifetime is measured from here, and it is what a cross-session revocation compares
// against, so it is written once at sign-in and never refreshed.
/** The session key recording when this session was established. @public */
export const AUTH_SIGNED_IN_SESSION_KEY = "auth.signedInAt";

/** The session key recording when this session completed a step-up verification. @public */
export const AUTH_STEP_UP_SESSION_KEY = "auth.stepUpAt";

// The address rides the session and not the URL: `AuthSigninFlow.complete` needs the address the
// code was issued to, and a query parameter carrying it lands in history, `Referer` and proxy logs.
/** The session key an unfinished sign-in keeps the address it challenged under. @public */
export const AUTH_PENDING_SIGNIN_SESSION_KEY = "auth.pendingSignin";

/** Per-request accessor for the identity `requireAuth` or `resolveAuth` establishes. @public */
export const authCtx = contextVar<AuthIdentity>("auth.identity");

/** The finite timestamp `session` holds under `key`, or `null` when it holds none. */
function readStamp(session: Session, key: string): number | null {
  const at = session.get(key);
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

// The mark is cleared here rather than left for the caller: a new sign-in has proven the primary
// factor and nothing else, so a carried-over step-up would satisfy the demand it has to meet.
/** Binds a signed-in user to `session` as of `at`, clearing any step-up mark and rotating the session id. @public */
export function establishAuthSession(session: Session, userId: string, at: number): void {
  session.set(AUTH_SESSION_KEY, userId);
  // Never later than now, for the reason `markAuthStepUp` clamps: a stamp in the future is a
  // lifetime that never runs out and a revocation that never reaches this session.
  session.set(AUTH_SIGNED_IN_SESSION_KEY, Math.min(at, Date.now()));
  session.unset(AUTH_STEP_UP_SESSION_KEY);
  session.unset(AUTH_PENDING_SIGNIN_SESSION_KEY);
  session.regenerateId(true);
}

// `UserStore.revokeSessions` raises a barrier refusing every session established at or before it,
// the one that raised it included, so the actor's own stamp is moved past it.
/** Moves `session` past a revocation barrier raised at `at`, so a caller's own session survives it. @public */
export function renewAuthSession(session: Session, at: number): void {
  session.set(AUTH_SIGNED_IN_SESSION_KEY, at + 1);
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

// A mark is a memory of something that happened, so it cannot be in the future; a skewed clock or
// an injected one must not be able to make one last forever.
/** Records on `session` that its step-up verification passed at `at`, never later than now. @public */
export function markAuthStepUp(session: Session, at: number): void {
  session.set(AUTH_STEP_UP_SESSION_KEY, Math.min(at, Date.now()));
}

/** Drops every auth key from `session`, leaving the session id alone. @internal */
function revokeAuthSession(session: Session): void {
  session.unset(AUTH_SESSION_KEY);
  session.unset(AUTH_SIGNED_IN_SESSION_KEY);
  session.unset(AUTH_STEP_UP_SESSION_KEY);
  session.unset(AUTH_PENDING_SIGNIN_SESSION_KEY);
}

/** Drops the signed-in user and the step-up mark from `session`, rotating the session id. @public */
export function clearAuthSession(session: Session): void {
  revokeAuthSession(session);
  session.regenerateId(true);
}

/** Reads the identity `session` claims and confirms it against the store as of `at`. @public */
export async function resolveAuthIdentity(session: Session, users: Pick<UserStore, "findById">, at: number): Promise<AuthIdentity | null> {
  const userId = session.get(AUTH_SESSION_KEY);
  // No clear on the anonymous path: `Session.unset` dirties even an absent key, so under KV every
  // anonymous GET would perform a real `kv.put` before returning an id the middleware then suppresses.
  if (typeof userId !== "string" || userId.length === 0) return null;

  // A session with no stamp predates this field, and there is no bound that could be checked
  // against it, so it is over rather than unbounded.
  const signedInAt = readStamp(session, AUTH_SIGNED_IN_SESSION_KEY);
  if (signedInAt === null || at - signedInAt >= AUTH_SESSION_MAX_MS) {
    revokeAuthSession(session);
    return null;
  }

  const found = await users.findById(userId);
  // A store failure denies rather than admits: an unavailable database must not read as "not an admin".
  // It leaves the session alone, though — clearing on a blip would sign every user out of it.
  if (!found.ok) return null;

  // Without this, reactivating an account revives every cookie issued before it, and the barrier
  // reaches the sessions this request cannot see only on their own next request.
  const invalidBefore = found.data?.sessionsInvalidBefore ?? null;
  if (found.data === null || found.data.deactivatedAt !== null || (invalidBefore !== null && signedInAt <= invalidBefore)) {
    revokeAuthSession(session);
    return null;
  }

  return { userId: found.data.id, email: found.data.email, isAdmin: found.data.isAdmin, stepUpAt: readStamp(session, AUTH_STEP_UP_SESSION_KEY) };
}
