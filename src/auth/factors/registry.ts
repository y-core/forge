import { err, ok } from "../../result/result";
import { AUTH_ADMIN_ROLE, AUTH_IDENTIFYING_FACTORS } from "../config";
import type { AuthFactorKind, FactorStore } from "../types";
import type {
  AuthFactorContext,
  AuthFactorOffer,
  AuthFactorRegistry,
  AuthFactorRequirement,
  AuthFactorsOptions,
  AuthIdentifyingFactorKind,
  AuthIdentifyingFactorService,
} from "./types";

type SecondOffer = Extract<AuthFactorOffer, { role: "second" }>;

/** The factor context a subject's roles amount to — the one place `isAdmin` becomes a role name. @public */
export function authFactorContext(subject: { readonly isAdmin: boolean }): AuthFactorContext {
  return subject.isAdmin ? { roles: [AUTH_ADMIN_ROLE] } : {};
}

/** Whether `kind` identifies the visitor, and so may start a sign-in. @public */
export function authIdentifies(kind: AuthFactorKind): kind is AuthIdentifyingFactorKind {
  return (AUTH_IDENTIFYING_FACTORS as readonly AuthFactorKind[]).includes(kind);
}

/** The refusal an offer of a non-identifying kind as primary earns, built from the const so it cannot drift. @internal */
export function authPrimaryRefusal(kind: AuthFactorKind): string {
  const identifying = AUTH_IDENTIFYING_FACTORS.map((named) => `"${named}"`).join(", ");
  return `createFactorRegistry: "${kind}" cannot be a primary factor — a primary factor must identify the visitor, which only ${identifying} does`;
}

function pickPrimary(options: AuthFactorsOptions): AuthIdentifyingFactorService {
  if (options.offered.length === 0) throw new Error("createFactorRegistry: at least one factor must be offered");
  const primaries = options.offered.filter((offer) => offer.role === "primary");
  const [only] = primaries;
  if (!only) throw new Error("createFactorRegistry: no offered factor is declared primary");
  if (primaries.length > 1) {
    const named = primaries.map((offer) => `"${offer.service.kind}"`).join(", ");
    throw new Error(`createFactorRegistry: ${primaries.length} offered factors are declared primary — ${named}`);
  }
  // The type already forbids this offer; the check is what a consumer casting past it meets.
  if (!authIdentifies(only.service.kind)) throw new Error(authPrimaryRefusal(only.service.kind));
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
  for (const offer of options.offered) {
    const { kind } = offer.service;
    if (seen.has(kind)) throw new Error(`createFactorRegistry: "${kind}" is offered twice`);
    seen.add(kind);
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
