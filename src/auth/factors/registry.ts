import { err, ok } from "../../result/result";
import { AUTH_ADMIN_ROLE } from "../config";
import type { AuthFactorKind, FactorStore } from "../types";
import type { AuthFactorContext, AuthFactorOffer, AuthFactorRegistry, AuthFactorRequirement, AuthFactorService, AuthFactorsOptions } from "./types";

type SecondOffer = Extract<AuthFactorOffer, { role: "second" }>;

/** The factor context a subject's roles amount to — the one place `isAdmin` becomes a role name. @public */
export function authFactorContext(subject: { readonly isAdmin: boolean }): AuthFactorContext {
  return subject.isAdmin ? { roles: [AUTH_ADMIN_ROLE] } : {};
}

function pickPrimary(options: AuthFactorsOptions): AuthFactorService {
  if (options.offered.length === 0) throw new Error("createFactorRegistry: at least one factor must be offered");
  const primaries = options.offered.filter((offer) => offer.role === "primary");
  const [only] = primaries;
  if (!only) throw new Error("createFactorRegistry: no offered factor is declared primary");
  if (primaries.length > 1) {
    const named = primaries.map((offer) => `"${offer.service.kind}"`).join(", ");
    throw new Error(`createFactorRegistry: ${primaries.length} offered factors are declared primary — ${named}`);
  }
  if (!only.service.capabilities.primary) throw new Error(`createFactorRegistry: "${only.service.kind}" cannot be a primary factor`);
  return only.service;
}

function demanded(requirement: AuthFactorRequirement, context: AuthFactorContext): boolean {
  if (requirement === "optional") return false;
  if (requirement === "mandatory") return true;
  // Forge sources no roles of its own — the caller passes the ones this request carries, which
  // every caller in forge derives through `authFactorContext`.
  const roles = context.roles ?? [];
  return requirement.mandatoryForRoles.some((role) => roles.includes(role));
}

/** Builds the registry that resolves the offered factors against one user's enrolments. @public */
export function createFactorRegistry(store: FactorStore, options: AuthFactorsOptions): AuthFactorRegistry {
  const primary = pickPrimary(options);
  const seconds = options.offered.filter((offer): offer is SecondOffer => offer.role === "second");
  for (const offer of seconds) {
    if (!offer.service.capabilities.stepUp) throw new Error(`createFactorRegistry: "${offer.service.kind}" cannot be a second factor`);
  }
  const services = options.offered.map((offer) => offer.service);
  const seen = new Set<AuthFactorKind>();
  for (const service of services) {
    if (seen.has(service.kind)) throw new Error(`createFactorRegistry: "${service.kind}" is offered twice`);
    seen.add(service.kind);
  }
  const secondKinds = seconds.map((offer) => offer.service.kind);
  // An implicit factor has no enrolment row by design, so asking the store about it always answers
  // "no": offering it *is* the enrolment, which puts it in the confirmed set unconditionally.
  const implicitKinds = new Set(seconds.filter((offer) => offer.service.enrolment === "implicit").map((offer) => offer.service.kind));
  const enrollableKinds = seconds.filter((offer) => offer.service.enrolment === "explicit").map((offer) => offer.service.kind);

  return {
    primary,
    offered: services,
    seconds,

    find(kind) {
      return services.find((service) => service.kind === kind);
    },

    async resolve(userId, context = {}) {
      if (seconds.length === 0) return ok({ status: "satisfied" });

      const confirmed = new Set(implicitKinds);
      if (enrollableKinds.length > 0) {
        const enrolled = await store.findEnrolled(userId, enrollableKinds);
        if (!enrolled.ok) return err(enrolled.error);
        for (const factor of enrolled.data) if (factor.confirmedAt !== null) confirmed.add(factor.kind);
      }

      const owed = seconds
        .filter((offer) => demanded(offer.requirement, context) && !confirmed.has(offer.service.kind))
        .map((offer) => offer.service.kind);
      // A successful outcome, not an `err`: needing to enrol is a normal onboarding step, and
      // modelling it as a failure pushes it onto the error path every caller treats as exceptional.
      if (owed.length > 0) return ok({ status: "enrolment-required", kinds: owed });

      const usable = secondKinds.filter((kind) => confirmed.has(kind));
      if (usable.length > 0) return ok({ status: "step-up-required", kinds: usable });
      return ok({ status: "satisfied" });
    },
  };
}
