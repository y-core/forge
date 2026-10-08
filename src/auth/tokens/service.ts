import { randomBytes, sha256 } from "../../crypto/primitives/mod";
import { err, ok } from "../../result/result";
import { AUTH_ACCESS_TOKEN_MAX_LIFETIME_MS, AUTH_ACCESS_TOKEN_USE_INTERVAL_MS } from "../config";
import { authLimit } from "../limits";
import type { AuthAccessToken } from "../types";
import { ACCESS_TOKEN_SECRET_BYTES, assertAccessTokenPrefix, checkAccessToken, formatAccessToken } from "./codec";
import type { AccessTokenService, AccessTokenServiceOptions } from "./types";

const OPERATION = "createAccessTokenService";

const SCOPE_SHAPE = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

function assertAccessTokenScopes(scopes: readonly string[]): void {
  if (scopes.length === 0) throw new Error(`${OPERATION}: scopes is empty, so no token could ever be issued — list at least one scope.`);
  const duplicate = scopes.find((scope, index) => scopes.indexOf(scope) !== index);
  if (duplicate !== undefined) throw new Error(`${OPERATION}: scope "${duplicate}" is listed more than once.`);
  const unsayable = scopes.find((scope) => !SCOPE_SHAPE.test(scope));
  if (unsayable !== undefined) {
    throw new Error(`${OPERATION}: scope "${unsayable}" cannot be written in a WWW-Authenticate header — no spaces, quotes or backslashes.`);
  }
}

function narrowAccessToken<Scope extends string>(token: AuthAccessToken, configured: ReadonlySet<string>): AuthAccessToken<Scope> {
  return { ...token, scopes: token.scopes.filter((scope): scope is Scope => configured.has(scope)) };
}

/** Creates the access token service over a store — issue once, verify by hash, list and revoke. @public */
export function createAccessTokenService<const Scope extends string>(options: AccessTokenServiceOptions<Scope>): AccessTokenService<Scope> {
  const { store, prefix } = options;
  assertAccessTokenPrefix(OPERATION, prefix);
  assertAccessTokenScopes(options.scopes);
  const configured: ReadonlySet<string> = new Set(options.scopes);
  const maxLifetimeMs =
    options.maxLifetimeMs === null
      ? null
      : authLimit(OPERATION, "maxLifetimeMs", options.maxLifetimeMs, {
          fallback: AUTH_ACCESS_TOKEN_MAX_LIFETIME_MS,
          min: 60_000,
          unit: "millisecond",
          floor: "a token that lapses inside a minute cannot reach the client that needs it",
        });
  const useIntervalMs = authLimit(OPERATION, "useIntervalMs", options.useIntervalMs, {
    fallback: AUTH_ACCESS_TOKEN_USE_INTERVAL_MS,
    min: 0,
    unit: "millisecond",
    floor: "a negative interval is a throttle that never admits a write",
  });

  return {
    async issue(input, at) {
      if (input.scopes.length === 0) return err("no-scope");
      if (input.scopes.some((scope) => !configured.has(scope))) return err("scope-unknown");
      if (maxLifetimeMs !== null && input.expiresAt === null) return err("expiry-required");
      const expiresAt = input.expiresAt;
      if (expiresAt !== null && (!Number.isInteger(expiresAt) || expiresAt <= at || (maxLifetimeMs !== null && expiresAt > at + maxLifetimeMs))) {
        return err("expiry-out-of-range");
      }

      const token = formatAccessToken(prefix, randomBytes(ACCESS_TOKEN_SECRET_BYTES));
      const created = await store.create(
        { userId: input.userId, tokenHash: await sha256(token), label: input.label, scopes: [...new Set(input.scopes)].sort(), expiresAt },
        at,
      );
      if (!created.ok) return err(created.error);
      return ok({ token, accessToken: narrowAccessToken<Scope>(created.data, configured) });
    },

    async verify(presented, at, required = []) {
      const unconfigured = required.find((scope) => !configured.has(scope));
      if (unconfigured !== undefined) {
        throw new Error(`${OPERATION}: verify was asked for scope "${unconfigured}", which this service was not configured with.`);
      }

      const shape = checkAccessToken(prefix, presented);
      if (!shape.ok) return err(shape.error);
      const found = await store.findByHash(await sha256(presented));
      if (!found.ok) return err(found.error);
      if (found.data === null) return err("unknown");
      if (found.data.revokedAt !== null) return err("revoked");
      if (found.data.expiresAt !== null && at >= found.data.expiresAt) return err("expired");

      const accessToken = narrowAccessToken<Scope>(found.data, configured);
      if (!required.every((scope) => accessToken.scopes.includes(scope))) return err("insufficient-scope");

      const used = await store.recordUse(accessToken.id, at, useIntervalMs);
      if (!used.ok) return err(used.error);
      return ok(accessToken);
    },

    async list(userId) {
      const listed = await store.listByUser(userId);
      return listed.ok ? ok(listed.data.map((token) => narrowAccessToken<Scope>(token, configured))) : listed;
    },

    revoke(id, userId, at) {
      return store.revoke(id, userId, at);
    },
  };
}
