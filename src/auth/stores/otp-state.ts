import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { OtpState, OtpStateStore } from "../types";
import { storeError, uuidKey } from "./rows";
import type { OtpStateRow } from "./types";

function readOtpState(row: OtpStateRow): OtpState {
  return { token: row.token, attempts: row.attempts, issuedAt: row.issued_at, expiresAt: row.expires_at };
}

const COLUMNS = sql`token, attempts, issued_at, expires_at`;

/** Creates the `OtpStateStore` over a SQL database — both counters decided by the statement, never by a prior read. @public */
export function createOtpStateStore(db: D1Client): OtpStateStore {
  return {
    async issue(userId, state, cooldownMs, binding) {
      const key = uuidKey(userId);
      if (!key) return ok(false);
      // One upsert, so the cooldown is the row's own condition. Read the row first and every
      // parallel request sees the same last issue, and each one sends its own mail.
      const outcome = await db.execute(
        sql`INSERT INTO auth_otp_state (user_id, token, attempts, issued_at, expires_at, binding)
            VALUES (${key}, ${state.token}, 0, ${state.issuedAt}, ${state.expiresAt}, ${binding})
            ON CONFLICT (user_id) DO UPDATE
              SET token = excluded.token, issued_at = excluded.issued_at, expires_at = excluded.expires_at, binding = excluded.binding
              WHERE auth_otp_state.issued_at <= ${state.issuedAt - cooldownMs}`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("otpState.issue", outcome.error));
    },

    async countAttempt(userId, maxAttempts, at, windowMs, binding) {
      const key = uuidKey(userId);
      if (!key) return ok(null);
      // The guess is spent in the statement that admits it, so N parallel guesses spend N of the
      // budget rather than each comparing against a count none of them has written yet.
      const lapsed = at - windowMs;
      const outcome = await db.queryOne<OtpStateRow>(
        sql`UPDATE auth_otp_state
            SET attempts = CASE WHEN window_started_at > ${lapsed} THEN attempts + 1 ELSE 1 END,
                window_started_at = CASE WHEN window_started_at > ${lapsed} THEN window_started_at ELSE ${at} END
            WHERE user_id = ${key} AND expires_at > ${at} AND binding = ${binding}
              AND (window_started_at IS NULL OR window_started_at <= ${lapsed} OR attempts < ${maxAttempts})
            RETURNING ${COLUMNS}`,
      );
      return outcome.ok ? ok(outcome.data ? readOtpState(outcome.data) : null) : err(storeError("otpState.countAttempt", outcome.error));
    },

    async read(userId, at, binding) {
      const key = uuidKey(userId);
      if (!key) return ok(null);
      const outcome = await db.queryOne<OtpStateRow>(
        sql`SELECT ${COLUMNS} FROM auth_otp_state WHERE user_id = ${key} AND expires_at > ${at} AND binding = ${binding}`,
      );
      return outcome.ok ? ok(outcome.data ? readOtpState(outcome.data) : null) : err(storeError("otpState.read", outcome.error));
    },

    // The token is in the statement, so an undelivered issue cannot wipe a racing one that was sent;
    // the row is retired rather than deleted, or a failed delivery would reopen the guess window.
    async discard(userId, token) {
      const key = uuidKey(userId);
      if (!key) return ok();
      const outcome = await db.execute(sql`UPDATE auth_otp_state SET issued_at = 0, expires_at = 0 WHERE user_id = ${key} AND token = ${token}`);
      return outcome.ok ? ok() : err(storeError("otpState.discard", outcome.error));
    },

    async clear(userId) {
      const key = uuidKey(userId);
      if (!key) return ok();
      const outcome = await db.execute(sql`DELETE FROM auth_otp_state WHERE user_id = ${key}`);
      return outcome.ok ? ok() : err(storeError("otpState.clear", outcome.error));
    },
  };
}
