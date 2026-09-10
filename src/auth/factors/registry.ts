import { err, ok } from "../../result/result";
import { AUTH_ADMIN_ROLE } from "../config";
import type { FactorStore } from "../types";
import type { AuthFactorContext, AuthFactorPolicy, AuthFactorRegistry, AuthFactorService, AuthFactorsOptions } from "./types";

/** The factor context a subject's roles amount to — the one place `isAdmin` becomes a role name. @public */
export function authFactorContext(subject: { readonly isAdmin: boolean }): AuthFactorContext {
  return subject.isAdmin ? { roles: [AUTH_ADMIN_ROLE] } : {};
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
