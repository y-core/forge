import { uuidFromBytes, uuidv7Bytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { IdentityLinkStore } from "../types";
import { readIdentityLink, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import type { IdentityLinkRow } from "./types";

/** Creates the `IdentityLinkStore` over a SQL database. @public */
export function createIdentityLinkStore(db: D1Client): IdentityLinkStore {
  return {
    async find(provider, subject) {
      const outcome = await db.queryOne<IdentityLinkRow>(
        sql`SELECT * FROM auth_identity_links WHERE provider = ${provider} AND subject = ${subject}`,
      );
      return outcome.ok ? readMaybe("identityLinks.find", outcome.data, readIdentityLink) : err(storeError("identityLinks.find", outcome.error));
    },

    async listByUser(userId) {
      const key = uuidKey(userId);
      if (!key) return ok([]);
      const outcome = await db.query<IdentityLinkRow>(sql`SELECT * FROM auth_identity_links WHERE user_id = ${key} ORDER BY id`);
      return outcome.ok
        ? readRow("identityLinks.listByUser", () => outcome.data.map(readIdentityLink))
        : err(storeError("identityLinks.listByUser", outcome.error));
    },

    async link(input, at) {
      const owner = uuidKey(input.userId);
      if (!owner) return err(unknownOwner("identityLinks.link"));
      const idBytes = uuidv7Bytes();
      const outcome = await db.execute(
        sql`INSERT INTO auth_identity_links (id, user_id, provider, subject, created_at, updated_at)
            VALUES (${idBytes}, ${owner}, ${input.provider}, ${input.subject}, ${at}, ${at})`,
      );
      if (!outcome.ok) return err(storeError("identityLinks.link", outcome.error));
      return ok({
        id: uuidFromBytes(idBytes),
        userId: input.userId,
        provider: input.provider,
        subject: input.subject,
        createdAt: at,
        updatedAt: at,
      });
    },

    // The owner is in the statement and not in a prior read, matching every other child-table
    // delete: a link id belonging to somebody else removes no row.
    async unlink(id, userId) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(sql`DELETE FROM auth_identity_links WHERE id = ${key} AND user_id = ${owner}`);
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("identityLinks.unlink", outcome.error));
    },
  };
}
