import { normalizeEmail } from "../stores/email";
import type { AuthUser } from "../types";
import type { AuthIssueOutcome } from "./types";
import type { AuthSignupFlow, AuthSignupOptions } from "./types";

/** Builds the signup flow. It produces no `Response` and touches no `Session` — `auth/web` owns both. @public */
export function createSignupFlow(options: AuthSignupOptions): AuthSignupFlow {
  async function accountFor(email: string, at: number): Promise<AuthUser | null> {
    const emailKey = normalizeEmail(email);
    const found = await options.users.findByEmailKey(emailKey);
    if (!found.ok) return null;
    // An address already registered is challenged rather than refused: "that email is taken" is the
    // enumeration answer this flow exists not to give, and a code sent to its owner is harmless.
    if (found.data) return found.data;
    const created = await options.users.create({ email: email.trim(), emailKey }, at);
    return created.ok ? created.data : null;
  }

  async function issue(email: string, at: number): Promise<AuthIssueOutcome> {
    const user = await accountFor(email, at);
    if (!user) return "unavailable";
    const challenge = await options.factors.primary.createChallenge(user.id, at);
    return challenge.ok ? "challenged" : "unavailable";
  }

  return {
    request(email, at) {
      // Nothing about the address is read before this returns, so the lookup, the insert and the
      // delivery are all off the caller's clock and the two branches are one code path.
      options.defer(issue(email, at));
      // The factor's own lifetime, never a knob of this flow's: a page must not be able to promise
      // an expiry the factor does not enforce. Known at construction, so nothing is awaited here.
      return { kind: options.factors.primary.kind, expiresAt: at + options.factors.primary.challengeTtlMs };
    },
  };
}
