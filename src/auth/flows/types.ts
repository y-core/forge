import type { Result } from "../../result/types";
import type { AuthStoreError } from "../errors";
import type { AuthFactorReason } from "../factors/types";
import type { AuthFactorRegistry } from "../factors/types";
import type { AuthFactorResolution } from "../factors/types";
import type { AuthFactorVerified } from "../factors/types";
import type { AuthFactorKind } from "../types";
import type { AuthKeyRing } from "../types";
import type { AuthNotifier } from "../types";
import type { AuthUser } from "../types";
import type { NonceStore } from "../types";
import type { UserStore } from "../types";

/** Where a flow hands work that must outlive the response — `executionCtx.waitUntil` in a Worker. @public */
export type AuthDeferral = (work: Promise<AuthIssueOutcome>) => void;

/** What one deferred issue did. Server-internal: the caller of `request` is told the same thing either way. @public */
export type AuthIssueOutcome = "challenged" | "decoyed" | "unavailable";

/** What a flow tells a visitor it has done, which is the same sentence for an address it knows and one it does not. @public */
export interface AuthFlowChallenge {
  readonly kind: AuthFactorKind;
  readonly expiresAt: number;
}

/** Why an address change was refused. @public */
export type AuthEmailChangeReason = "consumed" | "deactivated" | "expired" | "unavailable" | "unchanged" | "unrecognised";

/** When the confirmation link a change request mailed stops working. @public */
export interface AuthEmailChangeRequest {
  readonly expiresAt: number;
}

/** @public */
export interface AuthEmailChangeOptions {
  keys: AuthKeyRing;
  users: UserStore;
  nonces: NonceStore;
  notifier: AuthNotifier;
  defer: AuthDeferral;
  /** The link a confirmation mail carries, given the token that authorises the change. */
  confirmUrl: (token: string) => string;
  ttlMs?: number;
}

/** Moves an account to a new address only once that address has answered a link sent to it. @public */
export interface AuthEmailChangeFlow {
  request(userId: string, email: string, at: number): Promise<Result<AuthEmailChangeRequest, AuthEmailChangeReason>>;
  confirm(token: string, at: number): Promise<Result<AuthUser, AuthEmailChangeReason | AuthStoreError>>;
}

/** Why a sign-in was refused, in the detail an operator's log keeps. Never rendered — see `redactSigninReason`. @public */
export type AuthSigninReason = AuthFactorReason | "deactivated";

/** The one refusal a visitor may be shown, so a deactivated account and an unknown one read alike. @public */
export type AuthSigninNotice = "throttled" | "unavailable" | "unrecognised";

/** What a completed sign-in establishes, including what the second-factor policy still demands. @public */
export interface AuthSignin {
  readonly user: AuthUser;
  readonly kind: AuthFactorKind;
  readonly resolution: AuthFactorResolution;
}

/** @public */
export interface AuthSigninOptions {
  keys: AuthKeyRing;
  users: UserStore;
  factors: AuthFactorRegistry;
  defer: AuthDeferral;
}

/** Signs a visitor in through the registry's primary factor, then applies the second-factor policy. @public */
export interface AuthSigninFlow {
  request(email: string, at: number): AuthFlowChallenge;
  complete(email: string, presented: string, at: number): Promise<Result<AuthSignin, AuthSigninReason>>;
  requestStepUp(userId: string, kind: AuthFactorKind, at: number): Promise<Result<AuthFlowChallenge, AuthSigninReason>>;
  stepUp(userId: string, kind: AuthFactorKind, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthSigninReason>>;
}

/** @public */
export interface AuthSignupOptions {
  users: UserStore;
  factors: AuthFactorRegistry;
  defer: AuthDeferral;
}

/** Starts an account from an address, telling a registered address and a new one apart nowhere the caller can see. @public */
export interface AuthSignupFlow {
  request(email: string, at: number): AuthFlowChallenge;
}
