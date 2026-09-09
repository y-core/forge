import type { Session } from "@remix-run/session";

import { contextVar } from "../../context/accessor";
import type { UserStore } from "../types";

/** The session key the signed-in user's id is stored under. @public */
export const AUTH_SESSION_KEY = "auth.userId";

/** The session key recording when this session completed a step-up verification. @public */
export const AUTH_STEP_UP_SESSION_KEY = "auth.stepUpAt";

// The address rides the session and not the URL: `AuthSigninFlow.complete` needs the address the
// code was issued to, and a query parameter carrying it lands in history, `Referer` and proxy logs.
/** The session key an unfinished sign-in keeps the address it challenged under. @public */
export const AUTH_PENDING_SIGNIN_SESSION_KEY = "auth.pendingSignin";

/** Who the request is, established from the session and re-read from the user store every request. @public */
export interface AuthIdentity {
  readonly userId: string;
  readonly email: string;
  readonly isAdmin: boolean;
  /** When this session completed a step-up verification, or `null` when it has not. */
  readonly stepUpAt: number | null;
}

/** Per-request accessor for the identity `requireAuth` establishes. @public */
export const authCtx = contextVar<AuthIdentity>("auth.identity");

/** The step-up timestamp `session` carries, or `null` when it carries none. */
function readStepUpAt(session: Session): number | null {
  const at = session.get(AUTH_STEP_UP_SESSION_KEY);
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

// The mark is cleared here rather than left for the caller: a new sign-in has proven the primary
// factor and nothing else, so a carried-over step-up would satisfy the demand it has to meet.
/** Binds a signed-in user to `session`, clearing any step-up mark and rotating the session id. @public */
export function establishAuthSession(session: Session, userId: string): void {
  session.set(AUTH_SESSION_KEY, userId);
  session.unset(AUTH_STEP_UP_SESSION_KEY);
  session.unset(AUTH_PENDING_SIGNIN_SESSION_KEY);
  session.regenerateId(true);
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

/** Drops the three auth keys from `session`, leaving the session id alone. @internal */
function revokeAuthSession(session: Session): void {
  session.unset(AUTH_SESSION_KEY);
  session.unset(AUTH_STEP_UP_SESSION_KEY);
  session.unset(AUTH_PENDING_SIGNIN_SESSION_KEY);
}

/** Drops the signed-in user and the step-up mark from `session`, rotating the session id. @public */
export function clearAuthSession(session: Session): void {
  revokeAuthSession(session);
  session.regenerateId(true);
}

/** Reads the identity `session` claims and confirms it against the store, dropping the session's auth keys when the store refuses the id outright; a store outage denies without clearing. @public */
export async function resolveAuthIdentity(session: Session, users: Pick<UserStore, "findById">): Promise<AuthIdentity | null> {
  const userId = session.get(AUTH_SESSION_KEY);
  // No clear on the anonymous path: `Session.unset` dirties even an absent key, so every anonymous GET would carry a `Set-Cookie`.
  if (typeof userId !== "string" || userId.length === 0) return null;

  const found = await users.findById(userId);
  // A store failure denies rather than admits: an unavailable database must not read as "not an admin".
  // It leaves the session alone, though — clearing on a blip would sign every user out of it.
  if (!found.ok) return null;

  // Revoke, or reactivating the account revives every cookie issued before it. No rotation — the
  // session is being emptied, not gaining privilege.
  if (found.data === null || found.data.deactivatedAt !== null) {
    revokeAuthSession(session);
    return null;
  }

  return { userId: found.data.id, email: found.data.email, isAdmin: found.data.isAdmin, stepUpAt: readStepUpAt(session) };
}
