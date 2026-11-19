import { err, ok } from "../../result/result";
import { AUTH_IDENTIFYING_FACTORS, AUTH_SECOND_FACTORS } from "../config";
import type { AuthFactorKind, FactorStore } from "../types";
import type {
  AuthFactorRegistry,
  AuthFactorService,
  AuthFactorsOptions,
  AuthIdentifyingFactorKind,
  AuthIdentifyingFactorService,
  AuthSecondFactorKind,
  AuthSecondFactorOffering,
  AuthSecondFactorRequirement,
  AuthSecondFactorService,
} from "./types";

const REQUIREMENTS: readonly AuthSecondFactorRequirement[] = ["mandatory", "optional"];

/** Whether `kind` identifies the visitor, and so may start a sign-in. @public */
export function authIdentifies(kind: AuthFactorKind): kind is AuthIdentifyingFactorKind {
  return (AUTH_IDENTIFYING_FACTORS as readonly AuthFactorKind[]).includes(kind);
}

/** The refusal an offer of a non-identifying kind as primary earns, built from the const so it cannot drift. @internal */
export function authPrimaryRefusal(kind: AuthFactorKind): string {
  const identifying = AUTH_IDENTIFYING_FACTORS.map((named) => `"${named}"`).join(", ");
  return `createFactorRegistry: "${kind}" cannot be a primary factor — a primary factor must identify the visitor, which only ${identifying} does`;
}

function isSecondFactorKind(kind: AuthFactorKind): kind is AuthSecondFactorKind {
  return (AUTH_SECOND_FACTORS as readonly AuthFactorKind[]).includes(kind);
}

// The types already forbid each of these; the checks are what a consumer casting past them meets.
function pickPrimary(options: AuthFactorsOptions): AuthIdentifyingFactorService {
  const { primary } = options;
  if (!authIdentifies(primary.kind)) throw new Error(authPrimaryRefusal(primary.kind));
  return primary;
}

function refuseSecondOffering(second: AuthSecondFactorOffering): void {
  if ("requirement" in second) {
    throw new Error(
      'createFactorRegistry: a second-factor offering carries no requirement of its own — give each offer its own `requirement`, "mandatory" or "optional"',
    );
  }
  if (second.offered.length === 0) throw new Error("createFactorRegistry: a second-factor offering must offer at least one second factor");
  for (const offer of second.offered) {
    if (!("service" in offer) || !REQUIREMENTS.includes(offer.requirement)) {
      throw new Error(
        'createFactorRegistry: each offered second factor is `{ service, requirement }`, with `requirement` "mandatory" or "optional"',
      );
    }
    if (!isSecondFactorKind(offer.service.kind)) {
      const named = AUTH_SECOND_FACTORS.map((kind) => `"${kind}"`).join(", ");
      throw new Error(`createFactorRegistry: "${offer.service.kind}" cannot be a second factor — only ${named} may be offered as one`);
    }
  }
  if (!second.recovery) {
    const kind = second.offered[0].service.kind;
    throw new Error(
      `createFactorRegistry: "${kind}" is offered as a second factor without "recovery-code" — a lost device or key would lock its users out`,
    );
  }
  for (const service of [...second.offered.map((offer) => offer.service), second.recovery]) {
    if (!service.capabilities.stepUp) throw new Error(`createFactorRegistry: "${service.kind}" cannot be a second factor`);
  }
}

function refuseDuplicates(services: readonly AuthFactorService[]): void {
  const seen = new Set<AuthFactorKind>();
  for (const { kind } of services) {
    if (seen.has(kind)) throw new Error(`createFactorRegistry: "${kind}" is offered twice`);
    seen.add(kind);
  }
}

/** Builds the registry that resolves the offered factors against one user's enrolments. @public */
export function createFactorRegistry(store: FactorStore, options: AuthFactorsOptions): AuthFactorRegistry {
  const primary = pickPrimary(options);
  const second = options.second;
  if (second) refuseSecondOffering(second);
  const seconds: readonly AuthSecondFactorService[] = second ? second.offered.map((offer) => offer.service) : [];
  const mandatory: readonly AuthSecondFactorKind[] = second
    ? second.offered.filter((offer) => offer.requirement === "mandatory").map((offer) => offer.service.kind)
    : [];
  const recovery = second?.recovery ?? null;
  const services: AuthFactorService[] = [primary, ...seconds, ...(recovery ? [recovery] : [])];
  refuseDuplicates(services);
  const secondKinds: readonly AuthFactorKind[] = seconds.map((service) => service.kind);
  const readKinds: readonly AuthFactorKind[] = [...secondKinds, "recovery-code"];

  return {
    primary,
    offered: services,
    seconds,
    recovery,
    mandatory,

    find(kind) {
      return services.find((service) => service.kind === kind);
    },

    async resolve(userId) {
      if (seconds.length === 0) return ok({ status: "satisfied" });

      const enrolled = await store.listConfirmedKinds(userId, readKinds);
      if (!enrolled.ok) return err(enrolled.error);
      const held = secondKinds.filter((kind) => enrolled.data.includes(kind));
      const owed = mandatory.filter((kind) => !enrolled.data.includes(kind));
      const codes: readonly AuthFactorKind[] = enrolled.data.includes("recovery-code") ? ["recovery-code"] : [];

      // A success, not an `err`: enrolling is onboarding. A held optional factor is stepped up with
      // first, so a session alone never mints a second factor.
      if (owed.length > 0) return ok({ status: "enrolment-required", kinds: owed, stepUpKinds: [...held, ...codes] });
      if (held.length > 0) return ok({ status: "step-up-required", kinds: [...held, ...codes] });
      return ok({ status: "satisfied" });
    },
  };
}
