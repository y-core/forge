import { uuidFromBytes, uuidv7Bytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { AccessTokenStore } from "../types";
import { readAccessToken, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import type { AccessTokenRow } from "./types";

const COLUMNS = sql`id, user_id, label, scopes, expires_at, last_used_at, revoked_at, created_at`;

/** Creates the `AccessTokenStore` over a SQL database — looked up by the token's hash, revoked only by its owner. @public */
export function createAccessTokenStore(db: D1Client): AccessTokenStore {
  return {
    async create(input, at) {
      const owner = uuidKey(input.userId);
      if (!owner) return err(unknownOwner("accessTokens.create"));
      const idBytes = uuidv7Bytes();
      const outcome = await db.execute(
        sql`INSERT INTO auth_access_tokens (id, user_id, token_hash, label, scopes, expires_at, last_used_at, revoked_at, created_at)
            VALUES (${idBytes}, ${owner}, ${input.tokenHash}, ${input.label}, ${JSON.stringify(input.scopes)}, ${input.expiresAt}, ${null}, ${null}, ${at})`,
      );
      if (!outcome.ok) return err(storeError("accessTokens.create", outcome.error));
      return ok({
        id: uuidFromBytes(idBytes),
        userId: input.userId,
        label: input.label,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: at,
      });
    },

    async findByHash(tokenHash) {
      const outcome = await db.queryOne<AccessTokenRow>(
        sql`SELECT ${COLUMNS} FROM auth_access_tokens
            WHERE token_hash = ${tokenHash}
              AND EXISTS (SELECT 1 FROM auth_users WHERE auth_users.id = auth_access_tokens.user_id AND deactivated_at IS NULL)`,
      );
      return outcome.ok
        ? readMaybe("accessTokens.findByHash", outcome.data, readAccessToken)
        : err(storeError("accessTokens.findByHash", outcome.error));
    },

    async listByUser(userId) {
      const key = uuidKey(userId);
      if (!key) return ok([]);
      const outcome = await db.query<AccessTokenRow>(sql`SELECT ${COLUMNS} FROM auth_access_tokens WHERE user_id = ${key} ORDER BY id`);
      return outcome.ok
        ? readRow("accessTokens.listByUser", () => outcome.data.map(readAccessToken))
        : err(storeError("accessTokens.listByUser", outcome.error));
    },

    async recordUse(id, at, intervalMs) {
      const key = uuidKey(id);
      if (!key) return ok(false);
      const outcome = await db.execute(
        sql`UPDATE auth_access_tokens SET last_used_at = ${at}
            WHERE id = ${key} AND (last_used_at IS NULL OR last_used_at <= ${at - intervalMs})`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("accessTokens.recordUse", outcome.error));
    },

    async revoke(id, userId, at) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(
        sql`UPDATE auth_access_tokens SET revoked_at = ${at}
            WHERE id = ${key} AND user_id = ${owner} AND revoked_at IS NULL`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("accessTokens.revoke", outcome.error));
    },
  };
}
