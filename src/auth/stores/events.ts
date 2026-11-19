import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client, SqlFragment } from "../../storage/db/types";
import { uuidv7Bytes } from "../../storage/db/uuid";
import type { AuthSecurityEventStore, AuthUserPage } from "../types";
import { pageLimit, readRow, readSecurityEvent, storeError, uuidKey } from "./rows";
import type { AuthSecurityEventWrite, SecurityEventRow } from "./types";

/** The statement recording `event`, inserting its row only where `guard` holds. @internal */
export function authSecurityEventStatement(event: AuthSecurityEventWrite, guard: SqlFragment = sql`1`): SqlFragment {
  const session = event.keep === null ? sql`NULL` : sql`(SELECT id FROM auth_sessions WHERE token_hash = ${event.keep})`;
  return sql`INSERT INTO auth_security_events (id, user_id, type, factor_kind, session_id, admin_id, at)
             SELECT ${uuidv7Bytes()}, ${event.userKey}, ${event.type}, ${event.factorKind}, ${session}, ${event.adminKey}, ${event.at}
             WHERE ${guard}`;
}

/** Creates the `AuthSecurityEventStore` over a SQL database — the reading half; each mutation's own batch writes the rows. @public */
export function createSecurityEventStore(db: D1Client): AuthSecurityEventStore {
  return {
    async listByUser(userId, page: AuthUserPage = {}) {
      const key = uuidKey(userId);
      const cursor = page.after === undefined ? null : uuidKey(page.after);
      if (!key || (page.after !== undefined && !cursor)) return ok([]);
      const limit = pageLimit(page.limit);
      const fragment = cursor
        ? sql`SELECT * FROM auth_security_events WHERE user_id = ${key} AND id < ${cursor} ORDER BY id DESC LIMIT ${limit}`
        : sql`SELECT * FROM auth_security_events WHERE user_id = ${key} ORDER BY id DESC LIMIT ${limit}`;
      const outcome = await db.query<SecurityEventRow>(fragment);
      return outcome.ok
        ? readRow("securityEvents.listByUser", () => outcome.data.map(readSecurityEvent))
        : err(storeError("securityEvents.listByUser", outcome.error));
    },
  };
}
