import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import type { AuthStoreError } from "../errors";
import { authNonceKey, authNonceTtlSeconds, decodeAuthToken, encodeAuthToken } from "../keys/token";
import { authLimit } from "../limits";
import { normalizeEmail } from "../stores/email";
import type { AuthEmailChangeConfirm, AuthEmailChangeReason, AuthIssueOutcome } from "./types";
import type { AuthEmailChangeFlow, AuthEmailChangeOptions } from "./types";

const DEFAULT_TTL_MS = 3_600_000;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 86_400_000;
const PAYLOAD_SEPARATOR = " ";

/** `approve` is answered by the address the account holds; only `move` — mailed to the new address — changes the row. */
type Stage = "approve" | "move";

/** The three fields a token payload carries, or `undefined` for a payload this flow did not write. */
function readPayload(payload: string): { stage: Stage; userId: string; address: string } | undefined {
  const first = payload.indexOf(PAYLOAD_SEPARATOR);
  if (first < 0) return undefined;
  const second = payload.indexOf(PAYLOAD_SEPARATOR, first + 1);
  if (second < 0) return undefined;
  const stage = payload.slice(0, first);
  if (stage !== "approve" && stage !== "move") return undefined;
  const address = payload.slice(second + 1);
  if (address.length === 0) return undefined;
  return { stage, userId: payload.slice(first + 1, second), address };
}

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

  function mint(stage: Stage, userId: string, address: string, at: number): Promise<string> {
    return encodeAuthToken(options.keys, "identity", [stage, userId, address].join(PAYLOAD_SEPARATOR), ttlMs, { now: at });
  }

  async function deliver(to: string, token: string, expiresAt: number): Promise<AuthIssueOutcome> {
    const sent = await options.notifier.send({ to, kind: "email-change", url: options.confirmUrl(token), expiresAt });
    return sent.ok ? "challenged" : "unavailable";
  }

  // Only ever minted here, on an unverified account, or by `confirm` on an answered `approve`: a
  // session alone cannot produce a token that moves the row.
  async function forward(userId: string, address: string, at: number): Promise<{ sentTo: string; expiresAt: number }> {
    const token = await mint("move", userId, address, at);
    const expiresAt = at + ttlMs;
    options.defer(deliver(address, token, expiresAt));
    return { sentTo: address, expiresAt };
  }

  async function move(
    userId: string,
    address: string,
    at: number,
  ): Promise<Result<AuthEmailChangeConfirm, AuthEmailChangeReason | AuthStoreError>> {
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

    // The address is the account's identity, so a session established under the old one must not
    // outlive the move — including sessions on devices this request cannot see. The confirmation
    // link is answered from whatever browser opened it, so every session goes, this one included.
    const revoked = await options.users.revokeSessions(userId, at);
    if (!revoked.ok) return err(revoked.error);

    return ok({
      status: "moved",
      user: { ...found.data, email: address, emailKey, emailVerifiedAt: at, sessionsInvalidBefore: at, updatedAt: at },
    });
  }

  return {
    async request(userId, email, at) {
      const found = await options.users.findById(userId);
      if (!found.ok) return err("unavailable");
      if (!found.data) return err("unrecognised");
      if (found.data.deactivatedAt !== null) return err("deactivated");

      const address = email.trim();
      if (normalizeEmail(address) === found.data.emailKey) return err("unchanged");

      // The new address is never looked up here: answering "already registered" is the same
      // enumeration answer the sign-in flow refuses to give. The unique index refuses it at confirm.
      // An unverified address has proved nothing, so there the new one is the only address to ask.
      if (found.data.emailVerifiedAt === null) return ok(await forward(userId, address, at));

      // The first link goes to the address the account already holds, so the move is authorised by
      // whoever owns that mailbox rather than by whoever holds the session — without which a stolen
      // cookie moves the account to the thief's inbox and locks the owner out of the primary factor.
      // Answering it only forwards a second link to the new address, which is the one that proves
      // the new mailbox is read: a row is never marked verified on an address that answered nothing.
      const token = await mint("approve", userId, address, at);
      const expiresAt = at + ttlMs;
      options.defer(deliver(found.data.email, token, expiresAt));
      return ok({ expiresAt, sentTo: found.data.email });
    },

    async confirm(token, at) {
      // Both the account and the address come out of the token, so there is no second argument a
      // caller could point at a different mailbox — the binding is the payload, not a check.
      const decoded = await decodeAuthToken(options.keys, "identity", token, { now: at });
      if (!decoded.ok) return err(decoded.error === "expired" ? "expired" : "unrecognised");
      const payload = readPayload(decoded.data.payload);
      if (!payload) return err("unrecognised");

      const nonce = await authNonceKey(options.keys, token);
      if (!nonce.ok) return err("unrecognised");
      const fresh = await options.nonces.markConsumed(nonce.data, authNonceTtlSeconds(ttlMs));
      if (!fresh.ok) return err("unavailable");
      if (!fresh.data) return err("consumed");

      if (payload.stage === "move") return move(payload.userId, payload.address, at);

      const found = await options.users.findById(payload.userId);
      if (!found.ok) return err(found.error);
      if (!found.data) return err("unrecognised");
      if (found.data.deactivatedAt !== null) return err("deactivated");
      return ok({ status: "forwarded", ...(await forward(payload.userId, payload.address, at)) });
    },
  };
}
