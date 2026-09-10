import { err, ok } from "../../result/result";
import { authNonceKey, authNonceTtlSeconds, decodeAuthToken, encodeAuthToken } from "../keys/token";
import { authLimit } from "../limits";
import { normalizeEmail } from "../stores/email";
import type { AuthIssueOutcome } from "./types";
import type { AuthEmailChangeFlow, AuthEmailChangeOptions } from "./types";

const DEFAULT_TTL_MS = 3_600_000;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 86_400_000;
const PAYLOAD_SEPARATOR = " ";

/** Builds the email-change flow. It produces no `Response` and touches no `Session` — `auth/web` owns both. @public */
export function createEmailChangeFlow(options: AuthEmailChangeOptions): AuthEmailChangeFlow {
  const ttlMs = authLimit("createEmailChangeFlow", "ttlMs", options.ttlMs, {
    fallback: DEFAULT_TTL_MS,
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    unit: "millisecond",
    floor: "the shortest expiration the nonce store accepts, below which the link outlives its own replay guard",
    ceiling: "a change-of-address link that outlives a day is a standing takeover primitive",
  });

  async function deliver(to: string, token: string, expiresAt: number): Promise<AuthIssueOutcome> {
    const sent = await options.notifier.send({ to, kind: "email-change", url: options.confirmUrl(token), expiresAt });
    return sent.ok ? "challenged" : "unavailable";
  }

  return {
    async request(userId, email, at) {
      const found = await options.users.findById(userId);
      if (!found.ok) return err("unavailable");
      if (!found.data) return err("unrecognised");
      if (found.data.deactivatedAt !== null) return err("deactivated");

      const address = email.trim();
      if (normalizeEmail(address) === found.data.emailKey) return err("unchanged");

      // The link goes to the address the account already holds, so the move is authorised by whoever
      // owns the mailbox rather than by whoever holds the session — without which a stolen cookie
      // moves the account to the thief's inbox and locks the owner out of the primary factor.
      // An unverified address has proved nothing, so there the new one is the only address to ask.
      const to = found.data.emailVerifiedAt === null ? address : found.data.email;

      // The new address is never looked up here: answering "already registered" is the same
      // enumeration answer the sign-in flow refuses to give. The unique index refuses it at confirm.
      const token = await encodeAuthToken(options.keys, "identity", `${userId}${PAYLOAD_SEPARATOR}${address}`, ttlMs, { now: at });
      const expiresAt = at + ttlMs;
      options.defer(deliver(to, token, expiresAt));
      return ok({ expiresAt });
    },

    async confirm(token, at) {
      // Both the account and the address come out of the token, so there is no second argument a
      // caller could point at a different mailbox — the binding is the payload, not a check.
      const decoded = await decodeAuthToken(options.keys, "identity", token, { now: at });
      if (!decoded.ok) return err(decoded.error === "expired" ? "expired" : "unrecognised");
      const gap = decoded.data.payload.indexOf(PAYLOAD_SEPARATOR);
      if (gap < 0) return err("unrecognised");
      const userId = decoded.data.payload.slice(0, gap);
      const address = decoded.data.payload.slice(gap + 1);
      if (address.length === 0) return err("unrecognised");

      const nonce = await authNonceKey(options.keys, token);
      if (!nonce.ok) return err("unrecognised");
      const fresh = await options.nonces.markConsumed(nonce.data, authNonceTtlSeconds(ttlMs));
      if (!fresh.ok) return err("unavailable");
      if (!fresh.data) return err("consumed");

      const found = await options.users.findById(userId);
      if (!found.ok) return err(found.error);
      if (!found.data) return err("unrecognised");
      if (found.data.deactivatedAt !== null) return err("deactivated");

      const emailKey = normalizeEmail(address);
      const changed = await options.users.changeEmail(userId, address, emailKey, at);
      // The unique index catching the address in the meantime is the enumeration answer `request`
      // withheld, so it is folded into the same refusal an unknown account gets.
      if (!changed.ok) return err(changed.error.code === "conflict" ? "unrecognised" : changed.error);
      if (!changed.data) return err("unrecognised");

      return ok({ ...found.data, email: address, emailKey, emailVerifiedAt: at, updatedAt: at });
    },
  };
}
