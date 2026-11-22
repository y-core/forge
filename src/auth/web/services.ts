import { contextVar } from "../../context/accessor";
import type { AppContext } from "../../context/types";
import { assertUnwrappedKeyRing } from "../../crypto/keyring/resolver";
import type { KeyRing } from "../../crypto/keyring/types";
import { createLogger } from "../../logging/logger";
import { loggerFor } from "../../logging/request-logger";
import { err, ok } from "../../result/result";
import { sessionCtx } from "../../session/session";
import type { D1Client } from "../../storage/db/types";
import { AuthStoreError } from "../errors";
import { createEmailOtpFactor } from "../factors/email-otp";
import { createPasskeyFactor } from "../factors/passkey";
import { createRecoveryCodeFactor } from "../factors/recovery-code";
import { createFactorRegistry } from "../factors/registry";
import { createTotpAppFactor } from "../factors/totp-app";
import type { AuthSecondFactorOffer, AuthSecondFactorOffering } from "../factors/types";
import { createEmailChangeFlow } from "../flows/email-change";
import { createSecurityNotices } from "../flows/security-notices";
import { createSigninFlow } from "../flows/signin";
import { createSignupFlow } from "../flows/signup";
import { resolveAuthServices } from "../keys/ring";
import { createAdminUserStore } from "../stores/admin-users";
import { createChallengeStore } from "../stores/challenges";
import { createCredentialStore } from "../stores/credentials";
import { EPHEMERAL_SEPARATOR, ephemeralPrefixFault } from "../stores/ephemera";
import { createFactorStore } from "../stores/factors";
import { createNonceStore } from "../stores/nonces";
import { createOtpStateStore } from "../stores/otp-state";
import { createRecoveryCodeStore } from "../stores/recovery-codes";
import { authSessionBounds, createAuthSessionStore } from "../stores/sessions";
import { createUserStore } from "../stores/users";
import type { AuthAlgorithm, AuthSessionStore, AuthStoreResult, ChallengeStore, CredentialStore, FactorStore, UserStore } from "../types";
import type { AuthPerRequest, AuthRequestServices, AuthRequestServicesOptions, AuthRequestServicesResolver, AuthSecondFactorOffers } from "./types";

const fallbackLogger = createLogger("auth");

/** The stores and lookups every second factor is built over. */
interface SecondFactorDeps {
  readonly keys: KeyRing;
  readonly algorithms: readonly AuthAlgorithm[];
  readonly db: D1Client;
  readonly users: UserStore;
  readonly enrolments: FactorStore;
  readonly credentials: CredentialStore;
  readonly challenges: ChallengeStore;
  readonly address: (userId: string) => Promise<string>;
}

async function storedAddress(userId: string, users: UserStore): Promise<AuthStoreResult<string>> {
  const found = await users.findById(userId);
  if (!found.ok) return found;
  return found.data === null ? err(new AuthStoreError("unavailable", "address")) : ok(found.data.email);
}

function perRequest<Bindings, T extends string>(value: AuthPerRequest<Bindings, T>, c: AppContext<Bindings>): T {
  return typeof value === "function" ? value(c) : value;
}

const RP_NAME = "secondFactors.passkey.rpName";
const ISSUER = 'secondFactors["totp-app"].issuer';

function offerName(field: typeof RP_NAME | typeof ISSUER, value: unknown): string {
  const named = `authRequestServices: \`${field}\``;
  if (typeof value !== "string") throw new Error(`${named} must be a string, not ${value === null ? "null" : typeof value}.`);
  if (value.trim() === "") throw new Error(`${named} must not be empty or whitespace only.`);
  return value;
}

function issuerName(value: unknown): string {
  const issuer = offerName(ISSUER, value);
  if (issuer.includes(":")) {
    throw new Error(
      `authRequestServices: \`${ISSUER}\` must not hold \`:\` — an authenticator reads the label up to the first colon as the issuer.`,
    );
  }
  return issuer;
}

function assertOfferNames<Bindings>(offers: AuthSecondFactorOffers<Bindings> | undefined): void {
  const rpName = offers?.passkey?.rpName;
  if (rpName !== undefined && typeof rpName !== "function") offerName(RP_NAME, rpName);
  const issuer = offers?.["totp-app"]?.issuer;
  if (issuer !== undefined && typeof issuer !== "function") issuerName(issuer);
}

function offerOf<Bindings>(
  kind: string,
  offers: AuthSecondFactorOffers<Bindings>,
  c: AppContext<Bindings>,
  deps: SecondFactorDeps,
): AuthSecondFactorOffer | undefined {
  const passkey = offers.passkey;
  if (kind === "passkey" && passkey !== undefined) {
    const service = createPasskeyFactor({
      rpId: perRequest(passkey.rpId, c),
      rpName: offerName(RP_NAME, perRequest(passkey.rpName, c)),
      origin: perRequest(passkey.origin, c),
      sessionId: sessionCtx.get(c).id,
      users: deps.users,
      factors: deps.enrolments,
      credentials: deps.credentials,
      challenges: deps.challenges,
      algorithms: deps.algorithms,
      subject: async (userId) => {
        const email = await deps.address(userId);
        return { name: email, displayName: email };
      },
    });
    return { service, requirement: passkey.requirement };
  }
  const totp = offers["totp-app"];
  if (kind === "totp-app" && totp !== undefined) {
    const service = createTotpAppFactor({
      keys: deps.keys,
      factors: deps.enrolments,
      challenges: deps.challenges,
      issuer: issuerName(perRequest(totp.issuer, c)),
      account: deps.address,
    });
    return { service, requirement: totp.requirement };
  }
  return undefined;
}

function secondOffering<Bindings>(
  offers: AuthSecondFactorOffers<Bindings>,
  c: AppContext<Bindings>,
  deps: SecondFactorDeps,
): AuthSecondFactorOffering | undefined {
  const [first, ...rest] = Object.keys(offers).flatMap((kind) => offerOf(kind, offers, c, deps) ?? []);
  if (first === undefined) return undefined;
  const recovery = createRecoveryCodeFactor({ factors: deps.enrolments, codes: createRecoveryCodeStore(deps.db) });
  return { offered: [first, ...rest], recovery };
}

function assertStorePrefixes(prefixes: AuthRequestServicesOptions["prefixes"]): void {
  for (const [store, prefix] of Object.entries(prefixes ?? {}) as [string, unknown][]) {
    if (prefix === undefined) continue;
    const named = `authRequestServices: \`prefixes.${store}\``;
    if (typeof prefix !== "string") throw new Error(`${named} must be a string — omit it for the default.`);
    const fault = ephemeralPrefixFault(prefix);
    if (fault === "empty") throw new Error(`${named} must not be an empty string — omit it for the default.`);
    if (fault === "separator") throw new Error(`${named} must not hold \`${EPHEMERAL_SEPARATOR}\` or end in \`|\`.`);
  }
}

function prefixed(prefix: string | undefined): { prefix?: string } {
  return prefix === undefined ? {} : { prefix };
}

interface SessionBase {
  readonly keys: KeyRing;
  readonly algorithms: readonly AuthAlgorithm[];
  readonly db: D1Client;
  readonly sessions: AuthSessionStore;
}

async function buildSessionBase<Bindings>(c: AppContext<Bindings>, options: AuthRequestServicesOptions<Bindings>): Promise<SessionBase> {
  const { keys, algorithms } = await resolveAuthServices(c, options.auth);
  const db = options.db(c);
  return { keys, algorithms, db, sessions: createAuthSessionStore(db, options.sessionOptions) };
}

async function buildServices<Bindings>(
  c: AppContext<Bindings>,
  options: AuthRequestServicesOptions<Bindings>,
  base: Promise<SessionBase>,
): Promise<AuthRequestServices> {
  const { keys, algorithms, db, sessions } = await base;
  const users = createUserStore(db);
  const enrolments = createFactorStore(db);
  const credentials = createCredentialStore(db);
  const state = createOtpStateStore(db);
  const nonces = createNonceStore(db, prefixed(options.prefixes?.nonce));
  const notifier = options.notifier(c);
  const defer = options.defer(c);
  const logger = options.logger === undefined ? loggerFor(c, "auth", fallbackLogger) : options.logger(c);
  const lookup = options.address ?? storedAddress;
  const address = (userId: string) => lookup(userId, users);
  // The authenticator label and the passkey name have no refusal to answer with, so a missing address throws there.
  const requiredAddress = async (userId: string): Promise<string> => {
    const found = await address(userId);
    if (!found.ok) throw found.error;
    return found.data;
  };

  const challenges = createChallengeStore(db, prefixed(options.prefixes?.challenge));
  const deps = { keys, algorithms, db, users, enrolments, credentials, challenges, address: requiredAddress };
  const second = options.secondFactors === undefined ? undefined : secondOffering(options.secondFactors, c, deps);
  const primary = createEmailOtpFactor({ keys, state, nonces, notifier, address, logger });
  const factors = createFactorRegistry(enrolments, second === undefined ? { primary } : { primary, second });

  return {
    users,
    sessions,
    credentials,
    factors,
    enrolments,
    signin: createSigninFlow({ keys, users, factors, state, nonces, defer, logger }),
    signup: createSignupFlow({ users, factors, defer, logger }),
    emailChange: createEmailChangeFlow({ keys, users, nonces, notifier, defer, logger, confirmUrl: (token) => options.confirmUrl(c, token) }),
    notices: createSecurityNotices({ notifier, defer, logger }),
    admin: createAdminUserStore(db),
  };
}

/** Builds this request's `AuthRequestServices` over one D1 client, once per request, holding one `FactorStore` and one session lifetime throughout. @public */
export function authRequestServices<Bindings = Record<string, unknown>>(
  options: AuthRequestServicesOptions<Bindings>,
): AuthRequestServicesResolver<Bindings> {
  assertUnwrappedKeyRing("authRequestServices", options.auth.ring);
  assertStorePrefixes(options.prefixes);
  assertOfferNames(options.secondFactors);
  const baseMemo = contextVar<Promise<SessionBase>>("authRequestServices.sessions");
  const memo = contextVar<Promise<AuthRequestServices>>("authRequestServices");
  const base = (c: AppContext<Bindings>): Promise<SessionBase> => {
    const held = baseMemo.getOptional(c);
    if (held !== undefined) return held;
    const building = buildSessionBase(c, options);
    baseMemo.set(c, building);
    return building;
  };
  const resolve = (c: AppContext<Bindings>): Promise<AuthRequestServices> => {
    const held = memo.getOptional(c);
    if (held !== undefined) return held;
    const building = buildServices(c, options, base(c));
    memo.set(c, building);
    return building;
  };
  return Object.assign(resolve, {
    sessions: async (c: AppContext<Bindings>) => (await base(c)).sessions,
    absoluteLifetimeMs: authSessionBounds(options.sessionOptions).absoluteLifetimeMs,
  });
}
