import { createLogger } from "../../logging/logger";
import { serializeError } from "../../logging/serialize-error";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_EMAIL_CHANGE_COOLDOWN_MS, AUTH_NOTIFY_TIMEOUT_MS } from "../config";
import type { AuthStoreError } from "../errors";
import { authNonceKey, authNonceTtlSeconds, decodeAuthToken, encodeAuthToken } from "../keys/token";
import { authLimit } from "../limits";
import { normalizeEmail } from "../stores/email";
import { deliverAuthSecurityNotice } from "./security-notices";
import type { AuthEmailChangeConfirm, AuthEmailChangeReason, AuthEmailChangeStage, AuthIssueOutcome } from "./types";
import type { AuthEmailChangeFlow, AuthEmailChangeOptions } from "./types";

const DEFAULT_TTL_MS = 3_600_000;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 86_400_000;
const MIN_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 86_400_000;
const PAYLOAD_SEPARATOR = " ";

function readPayload(payload: string): { stage: AuthEmailChangeStage; userId: string; address: string } | undefined {
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
  const cooldownMs = authLimit("createEmailChangeFlow", "cooldownMs", options.cooldownMs, {
    fallback: AUTH_EMAIL_CHANGE_COOLDOWN_MS,
    min: MIN_COOLDOWN_MS,
    max: MAX_COOLDOWN_MS,
    unit: "millisecond",
    floor: "the cooldown is the only bound on how much mail one account can send to an address it names",
    ceiling: "a wait longer than a day keeps a user from correcting a mistyped address",
  });
  const logger = options.logger ?? createLogger("auth/flows");

  function mint(stage: AuthEmailChangeStage, userId: string, address: string, at: number): Promise<string> {
    return encodeAuthToken(options.keys, "identity", [stage, userId, address].join(PAYLOAD_SEPARATOR), ttlMs, { now: at });
  }

  async function deliver(to: string, token: string, expiresAt: number): Promise<AuthIssueOutcome> {
    const sent = await options.notifier.send(
      { to, kind: "email-change", url: options.confirmUrl(token), expiresAt },
      AbortSignal.timeout(AUTH_NOTIFY_TIMEOUT_MS),
    );
    return sent.ok ? "challenged" : "unavailable";
  }

  function settled(work: Promise<AuthIssueOutcome>): Promise<AuthIssueOutcome> {
    return work.catch((error: unknown) => {
      logger.error("auth.email-change.deliver.failed", { error: serializeError(error) });
      return "unavailable";
    });
  }

  async function forward(userId: string, address: string, at: number): Promise<{ sentTo: string; expiresAt: number }> {
    const token = await mint("move", userId, address, at);
    const expiresAt = at + ttlMs;
    options.defer(settled(deliver(address, token, expiresAt)));
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

    deliverAuthSecurityNotice(options, found.data.email, { type: "email-changed", factorKind: null, at });
    return ok({ status: "moved", user: { ...found.data, email: address, emailKey, emailVerifiedAt: at, updatedAt: at } });
  }

  async function read(
    token: string,
    at: number,
  ): Promise<Result<{ stage: AuthEmailChangeStage; userId: string; address: string }, AuthEmailChangeReason>> {
    const decoded = await decodeAuthToken(options.keys, "identity", token, { now: at });
    if (!decoded.ok) return err(decoded.error === "expired" ? "expired" : "unrecognised");
    const payload = readPayload(decoded.data.payload);
    if (!payload) return err("unrecognised");
    return ok(payload);
  }

  return {
    async request(userId, email, at) {
      const found = await options.users.findById(userId);
      if (!found.ok) return err("unavailable");
      if (!found.data) return err("unrecognised");
      if (found.data.deactivatedAt !== null) return err("deactivated");

      const address = email.trim();
      if (normalizeEmail(address) === found.data.emailKey) return err("unchanged");

      const claimed = await options.users.claimEmailChange(userId, at, cooldownMs);
      if (!claimed.ok) return err("unavailable");
      if (!claimed.data) return err("too-soon");

      if (found.data.emailVerifiedAt === null) return ok(await forward(userId, address, at));

      // The first link goes to the address the account already holds, so a stolen cookie cannot move
      // the account to the thief's inbox; answering it only forwards a second link to the new one.
      const token = await mint("approve", userId, address, at);
      const expiresAt = at + ttlMs;
      options.defer(settled(deliver(found.data.email, token, expiresAt)));
      return ok({ expiresAt, sentTo: found.data.email });
    },

    async inspect(token, at) {
      const link = await read(token, at);
      if (!link.ok) return link;
      return ok({ stage: link.data.stage, address: link.data.address });
    },

    async confirm(token, at) {
      const link = await read(token, at);
      if (!link.ok) return link;
      const payload = link.data;

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
