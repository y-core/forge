import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { authFactorContext } from "../factors/registry";
import { normalizeEmail } from "../stores/email";
import type { AuthFactorKind, AuthUser } from "../types";
import { issueAuthDecoy, verifyAuthDecoy } from "./decoy";
import type { AuthIssueOutcome } from "./types";
import type { AuthSigninFlow, AuthSigninNotice, AuthSigninOptions, AuthSigninReason } from "./types";

// A deactivated account answering differently from an unknown one is the enumeration oracle the
// deferred work exists to close, and an expired code on a known address is the same tell.
/** Folds an operator's refusal to the one a visitor may see. @public */
export function redactSigninReason(reason: AuthSigninReason): AuthSigninNotice {
  if (reason === "unavailable") return "unavailable";
  if (reason === "too-many-attempts" || reason === "too-soon") return "throttled";
  return "unrecognised";
}

/** Builds the signin flow. It produces no `Response` and touches no `Session` — `auth/web` owns both. @public */
export function createSigninFlow(options: AuthSigninOptions): AuthSigninFlow {
  async function issue(email: string, at: number): Promise<AuthIssueOutcome> {
    const found = await options.users.findByEmailKey(normalizeEmail(email));
    if (!found.ok) return "unavailable";
    if (!found.data) return issueAuthDecoy(options.keys, at);
    const challenge = await options.factors.primary.createChallenge(found.data.id, at);
    return challenge.ok ? "challenged" : "unavailable";
  }

  async function loadActive(userId: string): Promise<Result<AuthUser, AuthSigninReason>> {
    const found = await options.users.findById(userId);
    if (!found.ok) return err("unavailable");
    if (!found.data) return err("unrecognised");
    if (found.data.deactivatedAt !== null) return err("deactivated");
    return ok(found.data);
  }

  function stepUpService(kind: AuthFactorKind) {
    const service = options.factors.find(kind);
    if (!service || !service.capabilities.stepUp || kind === options.factors.primary.kind) return undefined;
    return service;
  }

  return {
    request(email, at) {
      // Nothing about the address is read before this returns, and both branches hand one promise to
      // the same deferral, so a registered address and an unknown one differ in neither shape nor time.
      options.defer(issue(email, at));
      // Read off the factor that will issue the code rather than off a knob of this flow's own: the
      // page must not be able to promise a lifetime the factor does not enforce. It is a property
      // known at construction, so reading it costs nothing the deferral exists to avoid.
      return { kind: options.factors.primary.kind, expiresAt: at + options.factors.primary.challengeTtlMs };
    },

    async complete(email, presented, at) {
      const found = await options.users.findByEmailKey(normalizeEmail(email));
      if (!found.ok) return err("unavailable");
      const user = found.data;
      // Both refusals below cost what verifying a real code costs. Returning here on the lookup
      // alone bins an address list by latency, which is the enumeration `request` already refuses.
      if (!user || user.deactivatedAt !== null) {
        await verifyAuthDecoy(options.keys, options.users, at);
        return err(user ? "deactivated" : "unrecognised");
      }

      const verified = await options.factors.primary.verifyChallenge(user.id, presented, at);
      if (!verified.ok) return err(verified.error);

      // An implicit factor's enrolment *is* the verified address, so passing its challenge is the
      // proof the row waits for; without this no account verifies and the passkey verifier refuses all.
      let signedIn = user;
      if (user.emailVerifiedAt === null && options.factors.primary.enrolment === "implicit") {
        const marked = await options.users.markEmailVerified(user.id, at);
        if (!marked.ok) return err("unavailable");
        signedIn = { ...user, emailVerifiedAt: at, updatedAt: at };
      }

      // The caller cannot know the subject's roles before this call: identifying the user is what the
      // call does. So the roles are read off the row it has just loaded.
      const resolution = await options.factors.resolve(user.id, authFactorContext(user));
      if (!resolution.ok) return err("unavailable");
      // `enrolment-required` arrives here inside `ok`: needing to enrol a second factor is a
      // legitimate end to a correct sign-in, not a failure to sign in.
      return ok({ user: signedIn, kind: options.factors.primary.kind, resolution: resolution.data });
    },

    async requestStepUp(userId, kind, at) {
      const active = await loadActive(userId);
      if (!active.ok) return err(active.error);
      const service = stepUpService(kind);
      if (!service) return err("not-enrolled");
      const challenge = await service.createChallenge(userId, at);
      return challenge.ok ? ok({ kind, expiresAt: challenge.data.expiresAt }) : err(challenge.error);
    },

    async stepUp(userId, kind, presented, at) {
      const active = await loadActive(userId);
      if (!active.ok) return err(active.error);
      const service = stepUpService(kind);
      if (!service) return err("not-enrolled");
      return service.verifyChallenge(userId, presented, at);
    },
  };
}
