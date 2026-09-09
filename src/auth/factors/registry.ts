import { type Result, err, ok } from "../../result/result";
import { AUTH_ADMIN_ROLE } from "../config";
import type { AuthFactor, AuthFactorKind, AuthStoreResult, FactorStore } from "../types";

/** What a factor may be used for. Enrolment is not here — it is the service's own discriminant. @public */
export interface AuthFactorCapabilities {
  readonly primary: boolean;
  readonly stepUp: boolean;
}

/** What a factor challenge hands back to the caller that must present it. @public */
export interface AuthFactorChallenge {
  readonly kind: AuthFactorKind;
  readonly expiresAt: number;
  readonly options?: Readonly<Record<string, unknown>>;
}

/** What a passing verification establishes. @public */
export interface AuthFactorVerified {
  readonly kind: AuthFactorKind;
  readonly userId: string;
  readonly verifiedAt: number;
}

/** Why a factor refused. Uniform at the surface — never echoed to a client. @public */
export type AuthFactorReason =
  | "expired"
  | "consumed"
  | "already-enrolled"
  | "not-enrolled"
  | "too-many-attempts"
  | "too-soon"
  | "unrecognised"
  | "unavailable";

/** The parts of a factor contract every factor has, whatever its enrolment story. @public */
interface FactorServiceBase {
  readonly kind: AuthFactorKind;
  readonly capabilities: AuthFactorCapabilities;
  // The one place the lifetime lives, so a flow reporting an expiry before it has a challenge to
  // read cannot report a number the factor does not enforce. An upper bound where a factor's
  // challenge ends on a clock of its own — a TOTP step ends where the step ends.
  /** How long a challenge this factor issues lasts, in milliseconds. */
  readonly challengeTtlMs: number;
  // For the same reason the lifetime is here: a page presenting this factor must not be able to ask
  // for a width the factor will refuse, and the width is the factor's own configuration.
  /** How many digits the code this factor asks for has, or `null` for a factor answered by a ceremony. */
  readonly codeDigits: number | null;
  readonly reissueAfterMs: number | null;
  createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>>;
  listEnrolments(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>>;
}

/** A factor whose enrolment is a side effect of something else — a verified email is the enrolment. @public */
export interface ImplicitFactorService extends FactorServiceBase {
  readonly enrolment: "implicit";
}

/** A factor a user enrols in deliberately, through a ceremony of its own. @public */
export interface EnrollableFactorService extends FactorServiceBase {
  readonly enrolment: "explicit";
  beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  completeEnrolment(userId: string, presented: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>>;
}

// `enrolment` sits on the service and not on `capabilities` because TypeScript narrows a union only
// on a *direct* discriminant — a nested one leaves it unnarrowed, which is what gets papered over.
/** One factor's whole contract. Test `service.enrolment` to reach the enrolment ceremony. @public */
export type AuthFactorService = EnrollableFactorService | ImplicitFactorService;

/** How many factors a sign-in needs, and when the second one is demanded. @public */
export type AuthFactorPolicy =
  | { readonly mode: "single" }
  | { readonly mode: "second-factor"; readonly required: "always" }
  | { readonly mode: "second-factor"; readonly required: "when-enrolled" }
  | { readonly mode: "second-factor"; readonly required: "for-roles"; readonly roles: readonly string[] };

/** @public */
export interface AuthFactorsOptions {
  readonly offered: readonly AuthFactorService[];
  readonly primary?: AuthFactorKind;
  readonly policy: AuthFactorPolicy;
}

/** What the user's own request knows that the policy does not. @public */
export interface AuthFactorContext {
  readonly roles?: readonly string[];
}

/** The factor context a subject's roles amount to — the one place `isAdmin` becomes a role name. @public */
export function authFactorContext(subject: { readonly isAdmin: boolean }): AuthFactorContext {
  return subject.isAdmin ? { roles: [AUTH_ADMIN_ROLE] } : {};
}

/** What a second factor demands of this sign-in. `enrolment-required` is an outcome, not a failure. @public */
export type AuthFactorResolution =
  | { readonly status: "satisfied" }
  | { readonly status: "step-up-required"; readonly kinds: readonly AuthFactorKind[] }
  | { readonly status: "enrolment-required"; readonly kinds: readonly AuthFactorKind[] };

/** @public */
export interface AuthFactorRegistry {
  readonly primary: AuthFactorService;
  readonly offered: readonly AuthFactorService[];
  readonly policy: AuthFactorPolicy;
  /** The kinds that can satisfy a step-up, in offered order — empty when nothing here can re-authenticate. */
  readonly stepUp: readonly AuthFactorKind[];
  find(kind: AuthFactorKind): AuthFactorService | undefined;
  resolve(userId: string, context?: AuthFactorContext): Promise<AuthStoreResult<AuthFactorResolution>>;
}

function pickPrimary(options: AuthFactorsOptions): AuthFactorService {
  if (options.offered.length === 0) throw new Error("createFactorRegistry: at least one factor must be offered");
  if (options.primary !== undefined) {
    const named = options.offered.find((service) => service.kind === options.primary);
    if (!named) throw new Error(`createFactorRegistry: "${options.primary}" is named as primary but is not offered`);
    if (!named.capabilities.primary) throw new Error(`createFactorRegistry: "${options.primary}" cannot be a primary factor`);
    return named;
  }
  const candidates = options.offered.filter((service) => service.capabilities.primary);
  const [only] = candidates;
  if (!only) throw new Error("createFactorRegistry: no offered factor can act as the primary one");
  if (candidates.length > 1) {
    throw new Error(`createFactorRegistry: ${candidates.length} offered factors can be primary — name one with \`primary\``);
  }
  return only;
}

function stepUpDemanded(policy: AuthFactorPolicy, context: AuthFactorContext): "always" | "when-enrolled" | "never" {
  if (policy.mode === "single") return "never";
  if (policy.required === "always") return "always";
  if (policy.required === "when-enrolled") return "when-enrolled";
  // Forge sources no roles of its own — the caller passes the ones this request carries, which
  // every caller in forge derives through `authFactorContext`.
  const roles = context.roles ?? [];
  return policy.roles.some((role) => roles.includes(role)) ? "always" : "when-enrolled";
}

/** Builds the registry that resolves the offered factors against one user's enrolments. @public */
export function createFactorRegistry(store: FactorStore, options: AuthFactorsOptions): AuthFactorRegistry {
  const primary = pickPrimary(options);
  const stepUp = options.offered.filter((service) => service.capabilities.stepUp && service.kind !== primary.kind);
  if (options.policy.mode === "second-factor" && stepUp.length === 0) {
    throw new Error(
      `createFactorRegistry: a second-factor policy is configured but no offered factor other than the primary "${primary.kind}" can step up`,
    );
  }
  const stepUpKinds = stepUp.map((service) => service.kind);
  // An implicit factor has no enrolment row by design, so asking the store about it always answers
  // "no": offering it *is* the enrolment, which puts it in the confirmed set unconditionally.
  const implicitKinds = new Set(stepUp.filter((service) => service.enrolment === "implicit").map((service) => service.kind));
  const enrollableKinds = stepUp.filter((service) => service.enrolment === "explicit").map((service) => service.kind);

  return {
    primary,
    offered: options.offered,
    policy: options.policy,
    stepUp: stepUpKinds,

    find(kind) {
      return options.offered.find((service) => service.kind === kind);
    },

    async resolve(userId, context = {}) {
      const demanded = stepUpDemanded(options.policy, context);
      if (demanded === "never") return ok({ status: "satisfied" });

      const confirmed = new Set(implicitKinds);
      if (enrollableKinds.length > 0) {
        const enrolled = await store.findEnrolled(userId, enrollableKinds);
        if (!enrolled.ok) return err(enrolled.error);
        for (const factor of enrolled.data) if (factor.confirmedAt !== null) confirmed.add(factor.kind);
      }

      const kinds = stepUpKinds.filter((kind) => confirmed.has(kind));
      if (kinds.length > 0) return ok({ status: "step-up-required", kinds });
      if (demanded === "when-enrolled") return ok({ status: "satisfied" });
      // A successful outcome, not an `err`: needing to enrol is a normal onboarding step, and
      // modelling it as a failure pushes it onto the error path every caller treats as exceptional.
      return ok({ status: "enrolment-required", kinds: enrollableKinds });
    },
  };
}
