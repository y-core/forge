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
import type { OtpStateStore } from "../types";
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

/** Where the confirmation link a change request mailed went, and when it stops working. @public */
export interface AuthEmailChangeRequest {
  readonly expiresAt: number;
  /** The address the mail actually went to — the account's own when it is verified, the new one otherwise. */
  readonly sentTo: string;
}

/** What answering a link did: forwarded a second link to the new address, or moved the account onto it. @public */
export type AuthEmailChangeConfirm =
  | { readonly status: "forwarded"; readonly sentTo: string; readonly expiresAt: number }
  | { readonly status: "moved"; readonly user: AuthUser };

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

/** Moves an account to a new address only once the old one has approved it and the new one has answered a link of its own. @public */
export interface AuthEmailChangeFlow {
  request(userId: string, email: string, at: number): Promise<Result<AuthEmailChangeRequest, AuthEmailChangeReason>>;
  confirm(token: string, at: number): Promise<Result<AuthEmailChangeConfirm, AuthEmailChangeReason | AuthStoreError>>;
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

// The decoy exists to make the unknown-address branch cost what the known one costs, so it has to
// spend the statements the known one spends — which are the emailed-code factor's stores, whatever
// this deployment's primary factor turns out to be. That coupling is the price of the branches
// being indistinguishable; a decoy holding no store is a latency oracle.
/** The stores an unknown address is answered with, so that branch spends what a known one spends. @public */
export interface AuthDecoyStores {
  keys: AuthKeyRing;
  users: UserStore;
  state: OtpStateStore;
  nonces: NonceStore;
}

/** @public */
export interface AuthSigninOptions {
  keys: AuthKeyRing;
  users: UserStore;
  state: OtpStateStore;
  nonces: NonceStore;
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
