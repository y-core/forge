import type { Result } from "../../result/types";
import type { AuthStoreError } from "../errors";
import type { AccessTokenStore, AuthAccessToken, AuthStoreResult } from "../types";

/** Why a presented token was refused. Never echoed to a client. @public */
export type AccessTokenReason = "checksum-mismatch" | "expired" | "insufficient-scope" | "malformed" | "revoked" | "unknown";

/** Why an access token was not issued. @public */
export type AccessTokenIssueReason = "expiry-out-of-range" | "expiry-required" | "no-scope" | "scope-unknown";

/** What a caller supplies to issue an access token. @public */
export interface AccessTokenIssueInput<Scope extends string> {
  readonly userId: string;
  readonly label: string;
  readonly scopes: readonly Scope[];
  readonly expiresAt: number | null;
}

/** `token` is the only copy of the secret there will ever be. @public */
export interface AccessTokenIssued<Scope extends string> {
  readonly token: string;
  readonly accessToken: AuthAccessToken<Scope>;
}

/** What `createAccessTokenService` is configured with. @public */
export interface AccessTokenServiceOptions<Scope extends string> {
  readonly store: AccessTokenStore;
  /** What a secret scanner keys on; checked when the service is created. */
  readonly prefix: string;
  readonly scopes: readonly Scope[];
  /** Defaults to `AUTH_ACCESS_TOKEN_MAX_LIFETIME_MS`; `null` admits a token with no expiry. */
  readonly maxLifetimeMs?: number | null;
  /** Defaults to `AUTH_ACCESS_TOKEN_USE_INTERVAL_MS`. */
  readonly useIntervalMs?: number;
}

/** Issues, verifies, lists and revokes one deployment's access tokens. @public */
export interface AccessTokenService<Scope extends string> {
  issue(input: AccessTokenIssueInput<Scope>, at: number): Promise<Result<AccessTokenIssued<Scope>, AccessTokenIssueReason | AuthStoreError>>;
  verify(presented: string, at: number, required?: readonly Scope[]): Promise<Result<AuthAccessToken<Scope>, AccessTokenReason | AuthStoreError>>;
  list(userId: string): Promise<AuthStoreResult<readonly AuthAccessToken<Scope>[]>>;
  revoke(id: string, userId: string, at: number): Promise<AuthStoreResult<boolean>>;
}
