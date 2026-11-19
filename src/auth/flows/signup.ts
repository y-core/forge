import { createLogger } from "../../logging/logger";
import { serializeError } from "../../logging/serialize-error";
import { err, ok } from "../../result/result";
import type { AuthFactorCaller } from "../factors/types";
import { normalizeEmail } from "../stores/email";
import type { AuthStoreResult, AuthUser } from "../types";
import type { AuthIssueOutcome } from "./types";
import type { AuthSignupFlow, AuthSignupOptions } from "./types";

/** Builds the signup flow. It produces no `Response` and touches no `Session` — `auth/web` owns both. @public */
export function createSignupFlow(options: AuthSignupOptions): AuthSignupFlow {
  const logger = options.logger ?? createLogger("auth/flows");

  function settled(work: Promise<AuthIssueOutcome>): Promise<AuthIssueOutcome> {
    return work.catch((error: unknown) => {
      logger.error("auth.signup.issue.failed", { error: serializeError(error) });
      return "unavailable";
    });
  }

  async function accountFor(email: string, at: number): Promise<AuthStoreResult<AuthUser>> {
    const emailKey = normalizeEmail(email);
    const found = await options.users.findByEmailKey(emailKey);
    if (!found.ok) return err(found.error);
    // An address already registered is challenged rather than refused: "that email is taken" is the
    // enumeration answer this flow exists not to give, and a code sent to its owner is harmless.
    if (found.data) return ok(found.data);
    const created = await options.users.create({ email: email.trim(), emailKey }, at);
    if (created.ok || created.error.code !== "conflict") return created;
    const raced = await options.users.findByEmailKey(emailKey);
    if (!raced.ok) return err(raced.error);
    return raced.data ? ok(raced.data) : created;
  }

  async function issue(email: string, at: number, caller: AuthFactorCaller): Promise<AuthIssueOutcome> {
    const account = await accountFor(email, at);
    if (!account.ok) {
      logger.error("auth.signup.issue.failed", { error: serializeError(account.error) });
      return "unavailable";
    }
    const challenge = await options.factors.primary.createChallenge(account.data.id, at, caller);
    return challenge.ok ? "challenged" : "unavailable";
  }

  return {
    request(email, at, caller) {
      // Nothing about the address is read before this returns, so the lookup, the insert and the
      // delivery are all off the caller's clock, and the registered address and the new one are one code path.
      options.defer(settled(issue(email, at, caller)));
      return { kind: options.factors.primary.kind, expiresAt: at + options.factors.primary.challengeTtlMs };
    },
  };
}
