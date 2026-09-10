/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { AppContext } from "../../context/types";
import { mintCsrf } from "../../form/csrf";
import { redirect } from "../../http/response";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import type { OtpLength } from "../../ui/core/types";
import { v } from "../../validation/mod";
import { authFactorContext } from "../factors/registry";
import type { TotpAppEnrolment } from "../factors/types";
import type { AuthFactorKind } from "../types";
import { authCtx } from "./identity";
import { authNow, authCsrfHeader, authPasskeyContract, authReturnPath, authSettledPath } from "./options";
import { AUTH_RESENT_PARAM, authEnrolTarget, authEnrolmentPaths } from "./paths";
import { AUTH_VIEWS } from "./render";
import { authAdminSearchSchema } from "./schemas";
import type { AuthIdentity } from "./types";
import type { AuthPageState, AuthRequestServices, AuthWebOptions } from "./types";
import type { AuthViewName, AuthViewProps } from "./types";
import type { AuthGuardName } from "./types";
import type { AuthVerifyDemand, AuthViewRequest, AuthViewResolved } from "./types";
import type { AuthAccountPaths } from "./types";
import type { AuthFactorRow, AuthFactorsViewProps } from "./views/types";
import type { PasskeyListViewProps } from "./views/types";
import type { TotpEnrolState, TotpEnrolViewProps } from "./views/types";

/** How many accounts one administrative page lists before the forward cursor takes over. */
const ADMIN_PAGE_SIZE = 25;

const UNAVAILABLE = "Service Unavailable";

const NOT_FOUND = "Not Found";

const FORBIDDEN = "Forbidden";

/** 303 for the same reason every auth redirect is: the detour may follow a POST, which must not replay. */
const VERIFY_DETOUR_STATUS = 303;

/** The refusal every resolver gives when the store behind the page it is reading is down. @internal */
export function unavailable(): Response {
  return new Response(UNAVAILABLE, { status: 503 });
}

/** @internal */
export function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404 });
}

// `authCtx` and nothing else: a page's data is read for whoever a guard established, so a route that
// ran neither `requireAuth` nor `resolveAuth` resolves nobody rather than reading an identity off the
// session the guards were meant to judge. The verify group runs `resolveAuth` for exactly this reason.
/** Who this request is, as the guards established it. @internal */
export function resolveAuthViewer<Bindings>(c: AppContext<Bindings>): AuthIdentity | null {
  return authCtx.getOptional(c) ?? null;
}

/** Factors other than the passkey that would still admit `userId` once every passkey is gone. */
async function resolveFallbackFactors(services: AuthRequestServices, userId: string): Promise<AuthFactorKind[]> {
  const kinds: AuthFactorKind[] = [];
  for (const service of services.factors.offered) {
    if (service.kind === "passkey") continue;
    // An implicit factor has no enrolment row to read: offering it is the enrolment.
    if (service.enrolment === "implicit") {
      kinds.push(service.kind);
      continue;
    }
    const enrolled = await service.listEnrolments(userId);
    if (enrolled.ok && enrolled.data.some((factor) => factor.confirmedAt !== null)) kinds.push(service.kind);
  }
  return kinds;
}

// The page serves two ceremonies that look alike: the second half of a sign-in, and a step-up owed
// by a session that is already signed in. Which one it is follows from whether there is an identity,
// which the `["auth","verify"]` group's `resolve-auth` guard establishes.
//
// With two step-up factors offered the first in `offered` order is the one demanded — forge renders
// no chooser, so a deployment picks the factor its visitors get by the order it offers them in.
/** What the verify page is presenting, read off the request rather than off a query parameter. @internal */
export async function resolveAuthVerifyDemand<Bindings>(c: AppContext<Bindings>, services: AuthRequestServices): Promise<AuthVerifyDemand> {
  const identity = resolveAuthViewer(c);
  const primary = services.factors.primary;
  if (identity === null) return { factor: primary.kind, digits: primary.codeDigits, identity: null, owed: null, kinds: [] };

  const resolved = await services.factors.resolve(identity.userId, authFactorContext(identity));
  if (!resolved.ok) return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "unknown", kinds: [] };
  if (resolved.data.status === "enrolment-required") {
    return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "enrolment", kinds: resolved.data.kinds };
  }
  if (resolved.data.status !== "step-up-required") {
    return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "none", kinds: [] };
  }

  const kind = resolved.data.kinds[0];
  const service = kind === undefined ? primary : (services.factors.find(kind) ?? primary);
  return { factor: service.kind, digits: service.codeDigits, identity, owed: "step-up", kinds: [] };
}

// The verify page is legitimate for exactly two things: a step-up an established session owes, and
// the second half of a sign-in. For anything else `signin.stepUp` refuses — it excludes the primary
// factor by design — so rendering the code field would build a form nothing can accept, and a
// visitor owing an enrolment would read a correct code as "that did not match", forever.
/** Where an established identity that owes no step-up belongs instead, or `null` when the page stands. @internal */
export function authVerifyDetour<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, demand: AuthVerifyDemand): Response | null {
  if (demand.owed === null || demand.owed === "step-up") return null;
  if (demand.owed === "unknown") return unavailable();
  if (demand.owed === "none") return redirect(authReturnPath(c, options), VERIFY_DETOUR_STATUS);
  const enrolment = authEnrolTarget(authEnrolmentPaths(options.paths.auth), demand.kinds) ?? authSettledPath(options);
  return redirect(enrolment, VERIFY_DETOUR_STATUS);
}

// Both code factors are bounded 6–8 at construction, so this narrows rather than clamps: a width the
// field cannot render is one no factor can be configured with.
/** Every width the one-time-code field renders. */
const FIELD_WIDTHS: readonly OtpLength[] = [4, 5, 6, 7, 8];

/** The presented factor's code width as a field size, or `undefined` for a factor answered by a ceremony. */
function codeWidth(digits: number | null): OtpLength | undefined {
  return FIELD_WIDTHS.find((width) => width === digits);
}

/** One page's props, or the refusal its data answered with. */
type AuthViewResolver<Name extends AuthViewName> = <Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
) => Promise<Result<AuthViewProps[Name], Response>>;

async function resolveSignin<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["signin"], Response>> {
  const services = await options.resolveServices(c);
  const { auth } = options.paths;
  const submitPath = auth.signinSubmit();
  const offersPasskey = services.passkey !== undefined && services.factors.find("passkey") !== undefined;

  return ok({
    primaryFactor: services.factors.primary.kind,
    passkey: offersPasskey
      ? await authPasskeyContract(
          c,
          "authentication",
          auth.passkey.authenticateBegin(),
          auth.passkey.authenticateFinish(),
          authReturnPath(c, options),
        )
      : undefined,
    submitPath,
    signupPath: auth.signup(),
    csrfToken: await mintCsrf(c, submitPath),
    ...authCsrfHeader(c),
    email: state.email,
    fieldError: state.fieldError,
    error: state.error,
    icon: options.icon,
  });
}

// Read off the registry rather than assumed, so the page describes the deployment a visitor is
// looking at. Both halves are needed: `offered` alone cannot tell a demanded factor from one merely
// available, and the policy alone does not say which. An implicit factor is never an enrolment —
// offering it is the enrolment.
/** The factor a new account is asked to enrol once the address is confirmed, or `undefined` for none. */
function signupEnrols(services: AuthRequestServices): AuthFactorKind | undefined {
  const { policy, offered } = services.factors;
  if (policy.mode !== "second-factor" || policy.required !== "always") return undefined;
  return offered.find((service) => service.enrolment === "explicit")?.kind;
}

async function resolveSignup<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["signup"], Response>> {
  const services = await options.resolveServices(c);
  const { auth } = options.paths;
  const submitPath = auth.signupSubmit();
  const enrols = signupEnrols(services);

  return ok({
    submitPath,
    signinPath: auth.signin(),
    ...(enrols === undefined ? {} : { enrols }),
    csrfToken: await mintCsrf(c, submitPath),
    ...authCsrfHeader(c),
    email: state.email,
    fieldError: state.fieldError,
    error: state.error,
    icon: options.icon,
  });
}

async function resolveVerify<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["verify"], Response>> {
  const services = await options.resolveServices(c);
  const { auth } = options.paths;
  const submitPath = auth.verify.submit();
  const demand = await resolveAuthVerifyDemand(c, services);
  const detour = authVerifyDetour(c, options, demand);
  if (detour !== null) return err(detour);
  const usesPasskey = demand.factor === "passkey" && services.passkey !== undefined;
  const resendPath = demand.factor === "email-otp" ? auth.verify.resend() : undefined;
  const reissueAfterMs = services.factors.find(demand.factor)?.reissueAfterMs ?? null;
  // A step-up runs its own ceremony pair. `auth.passkey.authenticate*` is the discoverable sign-in,
  // which establishes a session and so clears the very mark a step-up exists to write.
  const ceremony = demand.identity === null ? auth.passkey.authenticateBegin() : auth.verify.ceremony.begin();
  const ceremonyFinish = demand.identity === null ? auth.passkey.authenticateFinish() : auth.verify.ceremony.finish();

  return ok({
    factor: demand.factor,
    ...(codeWidth(demand.digits) === undefined ? {} : { codeDigits: codeWidth(demand.digits) }),
    passkey: usesPasskey ? await authPasskeyContract(c, "authentication", ceremony, ceremonyFinish, authReturnPath(c, options)) : undefined,
    submitPath,
    resendPath,
    signinPath: auth.signin(),
    csrfToken: await mintCsrf(c, submitPath),
    // Its own token, because `csrfProtection` binds one to the path it was minted for and this page
    // posts to two. Sharing `csrfToken` here made every "send another code" a 403.
    ...(resendPath === undefined ? {} : { resendToken: await mintCsrf(c, resendPath) }),
    resent: c.url.searchParams.has(AUTH_RESENT_PARAM),
    // The factor's own number, so the page cannot promise a wait it does not enforce.
    ...(reissueAfterMs === null ? {} : { reissueAfterMs }),
    ...authCsrfHeader(c),
    email: state.email,
    fieldError: state.fieldError,
    error: state.error,
    icon: options.icon,
  });
}

async function resolveEnrolPasskey<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["enrolPasskey"], Response>> {
  const services = await options.resolveServices(c);
  const { auth } = options.paths;
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(redirect(auth.signin()));
  if (services.passkey === undefined) return err(notFound());

  return ok({
    contract: await authPasskeyContract(c, "registration", auth.enrol.ceremony.begin(), auth.enrol.ceremony.finish(), authSettledPath(options)),
    signoutPath: auth.signout(),
    email: identity.email,
    error: state.error,
    icon: options.icon,
  });
}

/** One page of the visitor's registered passkeys, or the single credential `only` names. */
async function passkeyPage<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  only: string | undefined,
): Promise<Result<PasskeyListViewProps, Response>> {
  const services = await options.resolveServices(c);
  const { auth, account } = options.paths;
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(redirect(auth.signin()));

  const listed = await services.credentials.listByUser(identity.userId);
  if (!listed.ok) return err(unavailable());
  const credentials = only === undefined ? listed.data : listed.data.filter((credential) => credential.id === only);
  if (only !== undefined && credentials.length === 0) return err(notFound());

  return ok({
    rows: await Promise.all(
      credentials.map(async (credential) => ({
        credential,
        // `passkeyRename` and `passkeyRemove` are one pathname under two methods, and
        // `csrfProtection` keys on the pathname, so this token authorises both writes on this row.
        csrfToken: await mintCsrf(c, account.passkeyRemove({ id: credential.id })),
      })),
    ),
    fallbackFactors: await resolveFallbackFactors(services, identity.userId),
    paths: account,
    enrolPath: auth.enrol.passkey(),
    ...authCsrfHeader(c),
    icon: options.icon,
  });
}

function resolvePasskeyList<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<AuthViewProps["accountPasskeys"], Response>> {
  return passkeyPage(c, options, undefined);
}

function resolvePasskey<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<AuthViewProps["accountPasskey"], Response>> {
  const id = c.params.id;
  return id === undefined ? Promise.resolve(err(notFound())) : passkeyPage(c, options, id);
}

async function resolvePasskeyEdit<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountPasskeyEdit"], Response>> {
  const services = await options.resolveServices(c);
  const { auth, account } = options.paths;
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(redirect(auth.signin()));
  const id = c.params.id;
  if (id === undefined) return err(notFound());

  const listed = await services.credentials.listByUser(identity.userId);
  if (!listed.ok) return err(unavailable());
  const credential = listed.data.find((held) => held.id === id);
  if (credential === undefined) return err(notFound());

  return ok({
    credential,
    renamePath: account.passkeyRename({ id }),
    cancelPath: account.passkeys(),
    csrfToken: await mintCsrf(c, account.passkeyRename({ id })),
    ...authCsrfHeader(c),
    fieldError: state.fieldError,
    icon: options.icon,
  });
}

/** Where this mount of the authenticator-app page posts, since it is served both as an owed enrolment and as an account setting. */
interface TotpPageTargets {
  readonly enrolPath: string;
  readonly removePath?: string | undefined;
}

async function totpPage<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
  targets: TotpPageTargets,
): Promise<Result<TotpEnrolViewProps, Response>> {
  const services = await options.resolveServices(c);
  const { auth } = options.paths;
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(redirect(auth.signin()));

  const service = services.factors.find("totp-app");
  if (service === undefined || service.enrolment !== "explicit") return err(notFound());

  const enrolled = await service.listEnrolments(identity.userId);
  if (!enrolled.ok) return err(unavailable());
  const confirmed = enrolled.data.find((factor) => factor.confirmedAt !== null);

  let enrolState: TotpEnrolState;
  if (confirmed?.confirmedAt != null) {
    enrolState = { status: "enrolled", enrolledAt: confirmed.confirmedAt };
  } else {
    const begun = await service.beginEnrolment(identity.userId, authNow(options));
    if (!begun.ok) return err(unavailable());
    enrolState = { status: "enrolling", ...(begun.data.options as TotpAppEnrolment) };
  }

  const posts = enrolState.status === "enrolled" ? (targets.removePath ?? targets.enrolPath) : targets.enrolPath;
  return ok({
    state: enrolState,
    enrolPath: targets.enrolPath,
    ...(targets.removePath === undefined ? {} : { removePath: targets.removePath }),
    csrfToken: await mintCsrf(c, posts),
    ...authCsrfHeader(c),
    fieldError: state.fieldError,
    icon: options.icon,
  });
}

function resolveTotpEnrol<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountTotp"], Response>> {
  const { account } = options.paths;
  return totpPage(c, options, state, { enrolPath: account.totpEnrol(), removePath: account.totpRemove() });
}

// The same page outside the `account` group, which `require-enrolment` refuses precisely while the
// enrolment is owed — so this is the only mount an owed authenticator-app enrolment can be cleared on.
function resolveEnrolTotp<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["enrolTotp"], Response>> {
  return totpPage(c, options, state, { enrolPath: options.paths.auth.enrol.totpEnrol() });
}

async function resolveEmailChange<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountEmailChange"], Response>> {
  const { auth, account } = options.paths;
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(redirect(auth.signin()));
  const submitPath = account.emailChangeSubmit();

  return ok({
    currentEmail: identity.email,
    submitPath,
    accountPath: account.passkeys(),
    csrfToken: await mintCsrf(c, submitPath),
    ...authCsrfHeader(c),
    email: state.email,
    fieldError: state.fieldError,
    error: state.error,
    sentTo: state.sentTo,
    icon: options.icon,
  });
}

/** Every offered factor and where `userId` stands on it, read off the registry so the panel describes this deployment. */
async function resolveFactorRows(services: AuthRequestServices, userId: string): Promise<AuthFactorRow[] | null> {
  const rows: AuthFactorRow[] = [];
  for (const service of services.factors.offered) {
    // An implicit factor keeps no enrolment row, so there is nothing to read and nothing owed.
    if (service.enrolment === "implicit") {
      rows.push({ kind: service.kind, state: "always", at: null });
      continue;
    }
    const enrolled = await service.listEnrolments(userId);
    if (!enrolled.ok) return null;
    const confirmed = enrolled.data.find((factor) => factor.confirmedAt !== null);
    if (confirmed?.confirmedAt != null) {
      rows.push({ kind: service.kind, state: "enrolled", at: confirmed.confirmedAt });
      continue;
    }
    const started = enrolled.data[0];
    rows.push(
      started === undefined ? { kind: service.kind, state: "none", at: null } : { kind: service.kind, state: "pending", at: started.createdAt },
    );
  }
  return rows;
}

/** The factors panel for one account, whoever the route let through — `manage` is what tells the two apart. */
async function factorsPanel<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  userId: string,
  manage: AuthAccountPaths | undefined,
): Promise<Result<AuthFactorsViewProps, Response>> {
  const services = await options.resolveServices(c);
  const rows = await resolveFactorRows(services, userId);
  if (rows === null) return err(unavailable());
  const listed = await services.credentials.listByUser(userId);
  if (!listed.ok) return err(unavailable());

  return ok({ factors: rows, passkeys: listed.data, ...(manage === undefined ? {} : { manage }), icon: options.icon });
}

async function resolveAccountFactors<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<AuthViewProps["accountFactors"], Response>> {
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(redirect(options.paths.auth.signin()));
  return factorsPanel(c, options, identity.userId, options.paths.account);
}

// No `manage` here, deliberately: those pages act on whoever is signed in, so offering an
// administrator a "Manage" link against someone else's account would point at their own factors.
async function resolveAdminUserFactors<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<AuthViewProps["adminUserFactors"], Response>> {
  const services = await options.resolveServices(c);
  const id = c.params.id;
  if (id === undefined) return err(notFound());
  const found = await services.admin.view(id);
  if (!found.ok) return err(unavailable());
  if (found.data === null) return err(notFound());
  return factorsPanel(c, options, found.data.id, undefined);
}

async function resolveAdminUsers<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<AuthViewProps["adminUsers"], Response>> {
  const services = await options.resolveServices(c);
  const { admin } = options.paths;

  const asked = c.url.searchParams;
  const parsed = v.safeParse(
    authAdminSearchSchema(),
    { ...(asked.has("q") ? { q: asked.get("q") } : {}), ...(asked.has("after") ? { after: asked.get("after") } : {}) },
    { abortEarly: true },
  );
  if (!parsed.success) return err(redirect(admin.users.list()));
  const query = parsed.output.q ?? "";
  const after = parsed.output.after;

  const page = after === undefined ? { limit: ADMIN_PAGE_SIZE } : { limit: ADMIN_PAGE_SIZE, after };
  const listed = query === "" ? await services.admin.list(page) : await services.admin.search(query, page);
  if (!listed.ok) return err(unavailable());

  const last = listed.data[listed.data.length - 1];
  return ok({
    users: listed.data,
    query,
    nextCursor: listed.data.length === ADMIN_PAGE_SIZE && last !== undefined ? last.id : null,
    paths: admin,
    icon: options.icon,
  });
}

async function adminUserPage<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState,
): Promise<Result<AuthViewProps["adminUser"], Response>> {
  const services = await options.resolveServices(c);
  const { admin } = options.paths;
  const id = c.params.id;
  if (id === undefined) return err(notFound());

  const found = await services.admin.view(id);
  if (!found.ok) return err(unavailable());
  if (found.data === null) return err(notFound());
  const counted = await services.admin.countAdmins();
  if (!counted.ok) return err(unavailable());

  return ok({
    user: found.data,
    lastAdmin: found.data.isAdmin && found.data.deactivatedAt === null && counted.data <= 1,
    outcome: state.outcome ?? null,
    paths: admin,
    csrfToken: await mintCsrf(c, admin.users.update({ id })),
    ...authCsrfHeader(c),
    icon: options.icon,
  });
}

async function resolveAdminElevate<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<AuthViewProps["adminElevate"], Response>> {
  const services = await options.resolveServices(c);
  const { admin } = options.paths;
  const counted = await services.admin.countAdmins();
  if (!counted.ok) return err(unavailable());

  return ok({
    adminCount: counted.data,
    paths: admin,
    csrfToken: await mintCsrf(c, admin.elevate.submit()),
    ...authCsrfHeader(c),
    icon: options.icon,
  });
}

// A mapped table rather than a `switch`: TypeScript does not narrow a generic return type from a
// parameter discriminant, so every branch of a switch would need a cast — thirteen unchecked casts
// across CSRF-bearing props.
/** The props-builder behind each page name. @internal */
export const AUTH_VIEW_RESOLVERS: { readonly [Name in AuthViewName]: AuthViewResolver<Name> } = {
  signin: resolveSignin,
  signup: resolveSignup,
  verify: resolveVerify,
  enrolPasskey: resolveEnrolPasskey,
  enrolTotp: resolveEnrolTotp,
  accountPasskeys: resolvePasskeyList,
  accountPasskey: resolvePasskey,
  accountPasskeyEdit: resolvePasskeyEdit,
  accountTotp: resolveTotpEnrol,
  accountEmailChange: resolveEmailChange,
  accountFactors: resolveAccountFactors,
  adminUsers: resolveAdminUsers,
  adminUser: adminUserPage,
  adminUserEdit: adminUserPage,
  adminUserFactors: resolveAdminUserFactors,
  adminElevate: resolveAdminElevate,
};

// Derived from `AUTH_ROUTE_GROUPS` by `resolve.test.tsx` rather than at runtime: the name-to-group
// mapping is not mechanical — `adminElevate` is deliberately not admin-gated.
/** The guards each page's data assumes have already run. @public */
export const AUTH_VIEW_GUARDS = {
  signin: [],
  signup: [],
  verify: ["resolve-auth"],
  enrolPasskey: ["require-auth", "require-pending-enrolment"],
  enrolTotp: ["require-auth", "require-pending-enrolment"],
  accountPasskeys: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountPasskey: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountPasskeyEdit: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountTotp: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountEmailChange: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountFactors: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  adminUsers: ["require-auth", "require-enrolment", "require-admin"],
  adminUser: ["require-auth", "require-enrolment", "require-admin"],
  adminUserEdit: ["require-auth", "require-enrolment", "require-admin"],
  adminUserFactors: ["require-auth", "require-enrolment", "require-admin"],
  adminElevate: ["require-auth", "require-enrolment", "require-fresh-step-up"],
} as const satisfies { readonly [Name in AuthViewName]: readonly AuthGuardName[] };

// Two of the four guards are observable here and are re-checked rather than trusted; the enrolment
// pair needs a factor-registry round trip per render, so for those `guarded` is the whole check.
/** The refusal an unguarded or under-privileged request gets, or `null` when it may read the page. */
function refuseUnguarded<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, guards: readonly AuthGuardName[]): Response | null {
  if (!guards.includes("require-auth")) return null;
  const identity = authCtx.getOptional(c);
  if (identity === undefined) return redirect(options.paths.auth.signin());
  if (guards.includes("require-admin") && !identity.isAdmin) return new Response(FORBIDDEN, { status: 403 });
  return null;
}

/** Resolves one auth view, or the refusal forge's own loader would have answered with. @public */
export async function resolveAuthView<Name extends AuthViewName, Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  request: AuthViewRequest<Name>,
): Promise<Result<AuthViewResolved<Name>, Response>> {
  const { name } = request;
  const guards: readonly AuthGuardName[] = AUTH_VIEW_GUARDS[name];
  // A throw and not a 403: this is a wiring mistake, not a request to refuse. It 500s, which leaks
  // nothing, and the message names the one line that fixes it.
  if (guards.length > 0 && request.guarded === undefined) {
    throw new Error(
      `auth/web: \`${name}\` renders data its route's guards establish (${guards.join(", ")}) — ` +
        `pass \`guarded: AUTH_VIEW_GUARDS.${name}\` from a route that runs them, or mount forge's own route.`,
    );
  }

  const refused = refuseUnguarded(c, options, guards);
  if (refused !== null) return err(refused);

  const resolved = await AUTH_VIEW_RESOLVERS[name](c, options, request.state ?? {});
  if (!resolved.ok) return err(resolved.error);

  const View = options.views?.[name] ?? AUTH_VIEWS[name];
  return ok({ name, props: resolved.data, node: <View {...resolved.data} />, status: request.state?.status });
}
