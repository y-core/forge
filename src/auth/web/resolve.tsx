/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { AppContext } from "../../context/types";
import { mintCsrf } from "../../form/csrf";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import type { OtpLength } from "../../ui/core/types";
import { v } from "../../validation/mod";
import { authFactorContext } from "../factors/registry";
import type { AuthFactorService, RecoveryCodeFactorService, TotpAppEnrolment } from "../factors/types";
import type { AuthFactorKind } from "../types";
import { authStepUpOwed, authStepUpWindow } from "./guards";
import { authCtx } from "./identity";
import {
  authNow,
  authCsrfHeader,
  authEnrollable,
  authPasskeyContract,
  authReturnPath,
  authReturnQuery,
  authServices,
  authSettledPath,
} from "./options";
import { AUTH_FACTOR_PARAM, AUTH_RECOVERED_PARAM, AUTH_RESENT_PARAM, authEnrolTarget, authEnrolmentPaths, authWithQuery } from "./paths";
import { createAuthRedirect } from "./redirect";
import { AUTH_VIEWS } from "./render";
import { authAdminSearchSchema } from "./schemas";
import type { AuthIdentity } from "./types";
import type { AuthPageState, AuthRequestSurface, AuthWebOptions } from "./types";
import type { AuthViewName, AuthViewProps } from "./types";
import type { AuthGuardName } from "./types";
import type { AuthVerifyDemand, AuthViewRequest, AuthViewResolved } from "./types";
import type { AuthRecoveryStanding } from "./types";
import type { AuthFactorRow, AuthFactorsViewProps } from "./views/types";
import type { VerifyChoice } from "./views/types";
import type { PasskeyListViewProps } from "./views/types";
import type { TotpEnrolState, TotpEnrolViewProps } from "./views/types";

/** How many accounts one administrative page lists before the forward cursor takes over. */
const ADMIN_PAGE_SIZE = 25;

const UNAVAILABLE = "Service Unavailable";

const NOT_FOUND = "Not Found";

const FORBIDDEN = "Forbidden";

/** The refusal every resolver gives when the store behind the page it is reading is down. @internal */
export function unavailable(): Response {
  return new Response(UNAVAILABLE, { status: 503 });
}

/** @internal */
export function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404 });
}

/** The refusal an authenticated request without the role its target demands gets. @internal */
export function forbidden(): Response {
  return new Response(FORBIDDEN, { status: 403 });
}

// `authCtx` and nothing else: a page's data is read for whoever a guard established, so a route that
// ran neither guard resolves nobody rather than reading the session the guards were meant to judge.
/** Who this request is, as the guards established it. @internal */
export function resolveAuthViewer<Bindings>(c: AppContext<Bindings>): AuthIdentity | null {
  return authCtx.getOptional(c) ?? null;
}

/** Factors other than the passkey and recovery codes that would still admit `userId` once every passkey is gone. */
async function resolveFallbackFactors(services: AuthRequestSurface, userId: string): Promise<AuthFactorKind[]> {
  const kinds: AuthFactorKind[] = [];
  for (const service of services.factors.offered) {
    if (service.kind === "passkey" || service.kind === "recovery-code") continue;
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

/** A step-up over `kinds`, presenting the one the request's `factor` parameter names when it is among them. */
function stepUpDemand<Bindings>(
  c: AppContext<Bindings>,
  services: AuthRequestSurface,
  identity: AuthIdentity,
  kinds: readonly AuthFactorKind[],
): AuthVerifyDemand {
  const asked = c.url.searchParams.get(AUTH_FACTOR_PARAM);
  const kind = kinds.find((held) => held === asked) ?? kinds[0];
  const service = kind === undefined ? services.factors.primary : (services.factors.find(kind) ?? services.factors.primary);
  return { factor: service.kind, digits: service.codeDigits, identity, owed: "step-up", kinds };
}

/** What the verify page is presenting: the resolution's demand, and whichever of its step-up kinds the URL chose. @internal */
export async function resolveAuthVerifyDemand<Bindings>(
  c: AppContext<Bindings>,
  services: AuthRequestSurface,
  identity: AuthIdentity | null,
): Promise<AuthVerifyDemand> {
  const primary = services.factors.primary;
  if (identity === null) return { factor: primary.kind, digits: primary.codeDigits, identity: null, owed: null, kinds: [] };

  const resolved = await services.factors.resolve(identity.userId, authFactorContext(identity));
  if (!resolved.ok) return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "unknown", kinds: [] };
  if (resolved.data.status === "enrolment-required") {
    if (authStepUpOwed(resolved.data, identity.stepUpAt, authStepUpWindow(c)))
      return stepUpDemand(c, services, identity, resolved.data.stepUpKinds);
    return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "enrolment", kinds: resolved.data.kinds };
  }
  if (resolved.data.status !== "step-up-required") {
    return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "none", kinds: [] };
  }
  return stepUpDemand(c, services, identity, resolved.data.kinds);
}

const RECOVERABLE_KINDS: readonly AuthFactorKind[] = ["totp-app", "passkey"];

/** Whether `service` can count a user's unused codes, which forge's own recovery-code factor does. */
function countsRecoveryCodes(service: AuthFactorService): service is RecoveryCodeFactorService {
  return service.kind === "recovery-code" && "remaining" in service && typeof service.remaining === "function";
}

/** Whether `service` holds a confirmed enrolment for `userId`, or `null` when its store is down. */
async function holdsConfirmed(service: AuthFactorService | undefined, userId: string): Promise<boolean | null> {
  if (service === undefined) return false;
  const enrolled = await service.listEnrolments(userId);
  if (!enrolled.ok) return null;
  return enrolled.data.some((factor) => factor.confirmedAt !== null);
}

/** Where `userId` stands on recovery codes, or `null` when a store behind the answer is down. @internal */
export async function resolveRecoveryStanding(services: AuthRequestSurface, userId: string): Promise<AuthRecoveryStanding | null> {
  let recoverable = false;
  for (const kind of RECOVERABLE_KINDS) {
    const held = await holdsConfirmed(services.factors.find(kind), userId);
    if (held === null) return null;
    recoverable ||= held;
  }
  const service = services.factors.find("recovery-code");
  const confirmed = await holdsConfirmed(service, userId);
  if (confirmed === null) return null;
  if (!confirmed || service === undefined || !countsRecoveryCodes(service)) return { recoverable, confirmed, remaining: null };
  const remaining = await service.remaining(userId);
  if (!remaining.ok) return null;
  return { recoverable, confirmed, remaining: remaining.data };
}

/** Where the visitor goes once `enrolled` is confirmed, or `null` for no enrolment: an enrolment still owed, codes still owed, or `otherwise`. */
async function afterFactorTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: Pick<AuthIdentity, "userId" | "isAdmin">,
  enrolled: AuthFactorKind | null,
  otherwise: string,
): Promise<string> {
  const services = await authServices(c, options);
  const resolved = await services.factors.resolve(identity.userId, authFactorContext(identity));
  if (resolved.ok && resolved.data.status === "enrolment-required") {
    const owed = resolved.data.kinds.filter((kind) => kind !== enrolled);
    if (owed.length > 0) return authEnrolTarget(authEnrolmentPaths(options.paths.auth), owed) ?? authSettledPath(options);
  }
  const standing = await resolveRecoveryStanding(services, identity.userId);
  if (standing === null) return otherwise;
  const recoverable = standing.recoverable || (enrolled !== null && RECOVERABLE_KINDS.includes(enrolled));
  const owesCodes = recoverable && (!standing.confirmed || standing.remaining === 0);
  return owesCodes ? authReturnQuery(c, options, options.paths.account.recoveryCodes()) : otherwise;
}

/** Where a completed step-up sends the visitor: to repair, to an enrolment still owed, to codes still owed, or `otherwise`. @internal */
export function authAfterStepUpTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: Pick<AuthIdentity, "userId" | "isAdmin">,
  verified: AuthFactorKind,
  otherwise: string,
): Promise<string> {
  if (verified === "recovery-code") return Promise.resolve(authWithQuery(options.paths.account.factors(), AUTH_RECOVERED_PARAM, "1"));
  return afterFactorTarget(c, options, identity, null, otherwise);
}

/** Where enrolling `enrolled` sends the visitor, judged as though it were already confirmed, so a page can render it beforehand. @internal */
export function authAfterEnrolTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: Pick<AuthIdentity, "userId" | "isAdmin">,
  enrolled: AuthFactorKind,
  otherwise: string,
): Promise<string> {
  return afterFactorTarget(c, options, identity, enrolled, otherwise);
}

// `signin.stepUp` excludes the primary factor, so rendering the code field for anything but an owed
// step-up builds a form nothing accepts: a visitor would read a correct code as "that did not match".
/** Where an established identity that owes no step-up belongs instead, or `null` when the page stands. @internal */
export function authVerifyDetour<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, demand: AuthVerifyDemand): Response | null {
  if (demand.owed === null || demand.owed === "step-up") return null;
  if (demand.owed === "unknown") return unavailable();
  if (demand.owed === "none") return createAuthRedirect(c, authReturnPath(c, options));
  const enrolment = authEnrolTarget(authEnrolmentPaths(options.paths.auth), demand.kinds) ?? authSettledPath(options);
  return createAuthRedirect(c, enrolment);
}

// Both code factors are bounded 6–8 at construction, so this narrows rather than clamps: a width the
// field cannot render is one no factor can be configured with.
/** Every width the one-time-code field renders. */
const FIELD_WIDTHS: readonly OtpLength[] = [4, 5, 6, 7, 8];

/** The presented factor's code width as a field size, or `undefined` for a factor answered by a ceremony. */
function codeWidth(digits: number | null): OtpLength | undefined {
  return FIELD_WIDTHS.find((width) => width === digits);
}

/** Who a page reads its data for: signed in wherever its guards include `require-auth`. */
type AuthViewViewer<Name extends AuthViewName> = "require-auth" extends (typeof AUTH_VIEW_GUARDS)[Name][number]
  ? AuthIdentity
  : AuthIdentity | null;

/** One page's props, or the refusal its data answered with. */
type AuthViewResolver<Name extends AuthViewName> = <Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  viewer: AuthViewViewer<Name>,
  state: AuthPageState,
) => Promise<Result<AuthViewProps[Name], Response>>;

async function resolveSignin<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  _viewer: AuthIdentity | null,
  state: AuthPageState,
): Promise<Result<AuthViewProps["signin"], Response>> {
  const { auth } = options.paths;
  const submitPath = auth.signinSubmit();

  return ok({
    // The action carries the return-to and the token is minted without it: `csrfProtection` binds a
    // token to the path alone, so a query on the minted path is a 403 on every submission.
    submitPath: authReturnQuery(c, options, submitPath),
    signupPath: auth.signup(),
    csrfToken: await mintCsrf(c, submitPath),
    ...authCsrfHeader(c),
    email: state.email,
    fieldError: state.fieldError,
    error: state.error,
    icon: options.icon,
  });
}

// `mandatoryForRoles` cannot count towards this: a sign-up has no identity, so it has no roles.
/** The factor a new account is asked to enrol once the address is confirmed, or `undefined` for none. */
function signupEnrols(services: AuthRequestSurface): AuthFactorKind | undefined {
  return services.factors.seconds.find((offer) => offer.requirement === "mandatory" && offer.service.enrolment === "explicit")?.service.kind;
}

async function resolveSignup<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  _viewer: AuthIdentity | null,
  state: AuthPageState,
): Promise<Result<AuthViewProps["signup"], Response>> {
  const services = await authServices(c, options);
  const { auth } = options.paths;
  const submitPath = auth.signupSubmit();
  const enrols = signupEnrols(services);

  return ok({
    submitPath: authReturnQuery(c, options, submitPath),
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
  viewer: AuthIdentity | null,
  state: AuthPageState,
): Promise<Result<AuthViewProps["verify"], Response>> {
  const services = await authServices(c, options);
  const { auth } = options.paths;
  const submitPath = auth.verify.submit();
  const demand = await resolveAuthVerifyDemand(c, services, viewer);
  const detour = authVerifyDetour(c, options, demand);
  if (detour !== null) return err(detour);
  const usesPasskey = demand.factor === "passkey";
  const resendPath = demand.factor === "email-otp" ? auth.verify.resend() : undefined;
  const reissueAfterMs = services.factors.find(demand.factor)?.reissueAfterMs ?? null;
  // Always the step-up pair, including for the second half of a sign-in: a passkey never starts one.
  const ceremony = auth.verify.ceremony.begin();
  const ceremonyFinish = auth.verify.ceremony.finish();
  const stepUp = demand.owed === "step-up" && demand.identity !== null ? demand.identity : null;
  const asking = (path: string, kind: AuthFactorKind) => authWithQuery(authReturnQuery(c, options, path), AUTH_FACTOR_PARAM, kind);
  const choices: VerifyChoice[] = demand.kinds.map((kind) => ({ kind, href: asking(auth.verify.show(), kind) }));
  // The rendered target is the one the controller follows: a step-up changes nothing the next page is chosen by.
  const passkeyRedirect =
    stepUp === null ? authReturnPath(c, options) : await authAfterStepUpTarget(c, options, stepUp, "passkey", authReturnPath(c, options));

  return ok({
    factor: demand.factor,
    ...(codeWidth(demand.digits) === undefined ? {} : { codeDigits: codeWidth(demand.digits) }),
    passkey: usesPasskey ? await authPasskeyContract(c, "authentication", ceremony, ceremonyFinish, passkeyRedirect) : undefined,
    ...(stepUp === null || choices.length < 2 ? {} : { choices }),
    submitPath: stepUp === null ? authReturnQuery(c, options, submitPath) : asking(submitPath, demand.factor),
    // Carried like the submit path, and minted on the bare one for the same reason.
    ...(resendPath === undefined ? {} : { resendPath: authReturnQuery(c, options, resendPath) }),
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
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["enrolPasskey"], Response>> {
  const services = await authServices(c, options);
  const { auth } = options.paths;
  const offered = authEnrollable(services, "passkey");
  if (!offered.ok) return err(offered.error);

  const redirect = await authAfterEnrolTarget(c, options, identity, "passkey", authSettledPath(options));
  return ok({
    contract: await authPasskeyContract(c, "registration", auth.enrol.ceremony.begin(), auth.enrol.ceremony.finish(), redirect),
    signoutPath: auth.signout(),
    signoutCsrfToken: await mintCsrf(c, auth.signout()),
    ...authCsrfHeader(c),
    email: identity.email,
    error: state.error,
    icon: options.icon,
  });
}

/** One page of the visitor's registered passkeys, or the single credential `only` names. */
async function passkeyPage<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  only: string | undefined,
): Promise<Result<PasskeyListViewProps, Response>> {
  const services = await authServices(c, options);
  const { auth, account } = options.paths;
  const offered = authEnrollable(services, "passkey");
  if (!offered.ok) return err(offered.error);

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
  identity: AuthIdentity,
): Promise<Result<AuthViewProps["accountPasskeys"], Response>> {
  return passkeyPage(c, options, identity, undefined);
}

function resolvePasskey<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
): Promise<Result<AuthViewProps["accountPasskey"], Response>> {
  const id = c.params.id;
  return id === undefined ? Promise.resolve(err(notFound())) : passkeyPage(c, options, identity, id);
}

async function resolvePasskeyEdit<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountPasskeyEdit"], Response>> {
  const services = await authServices(c, options);
  const { account } = options.paths;
  const offered = authEnrollable(services, "passkey");
  if (!offered.ok) return err(offered.error);
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
  identity: AuthIdentity,
  state: AuthPageState,
  targets: TotpPageTargets,
): Promise<Result<TotpEnrolViewProps, Response>> {
  const services = await authServices(c, options);
  const offered = authEnrollable(services, "totp-app");
  if (!offered.ok) return err(offered.error);
  const service = offered.data;

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
    // Read off the factor, never restated here: a page asking for a width or promising a refresh
    // the factor does not use is a page whose copy the factor can be reconfigured out from under.
    ...(codeWidth(service.codeDigits) === undefined ? {} : { codeDigits: codeWidth(service.codeDigits) }),
    ...(service.codePeriodSeconds === null ? {} : { codePeriodSeconds: service.codePeriodSeconds }),
    fieldError: state.fieldError,
    icon: options.icon,
  });
}

function resolveTotpEnrol<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountTotp"], Response>> {
  const { account } = options.paths;
  return totpPage(c, options, identity, state, { enrolPath: account.totpEnrol(), removePath: account.totpRemove() });
}

// The same page outside the `account` group, which `require-enrolment` refuses precisely while the
// enrolment is owed — so this is the only mount an owed authenticator-app enrolment can be cleared on.
function resolveEnrolTotp<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["enrolTotp"], Response>> {
  return totpPage(c, options, identity, state, { enrolPath: options.paths.auth.enrol.totpEnrol() });
}

async function resolveEmailChange<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountEmailChange"], Response>> {
  const { account } = options.paths;
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
async function resolveFactorRows(services: AuthRequestSurface, userId: string): Promise<AuthFactorRow[] | null> {
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

/** The factors panel for one account, whoever the route let through — `extra` carries what only one reader is offered. */
async function factorsPanel<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  userId: string,
  extra: Pick<AuthFactorsViewProps, "manage" | "recovered" | "reset">,
): Promise<Result<AuthFactorsViewProps, Response>> {
  const services = await authServices(c, options);
  const rows = await resolveFactorRows(services, userId);
  if (rows === null) return err(unavailable());
  const listed = await services.credentials.listByUser(userId);
  if (!listed.ok) return err(unavailable());

  return ok({ factors: rows, passkeys: listed.data, ...extra, icon: options.icon });
}

async function resolveAccountFactors<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
): Promise<Result<AuthViewProps["accountFactors"], Response>> {
  if (!c.url.searchParams.has(AUTH_RECOVERED_PARAM)) return factorsPanel(c, options, identity.userId, { manage: options.paths.account });

  const standing = await resolveRecoveryStanding(await authServices(c, options), identity.userId);
  if (standing === null) return err(unavailable());
  return factorsPanel(c, options, identity.userId, { manage: options.paths.account, recovered: standing.remaining ?? 0 });
}

// No `manage` here, deliberately: those pages act on whoever is signed in, so offering an
// administrator a "Manage" link against someone else's account would point at their own factors.
async function resolveAdminUserFactors<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  viewer: AuthIdentity,
): Promise<Result<AuthViewProps["adminUserFactors"], Response>> {
  const services = await authServices(c, options);
  const id = c.params.id;
  if (id === undefined) return err(notFound());
  const found = await services.admin.view(id);
  if (!found.ok) return err(unavailable());
  if (found.data === null) return err(notFound());
  if (viewer.userId === found.data.id) return factorsPanel(c, options, found.data.id, {});

  const path = options.paths.admin.users.resetFactors({ id: found.data.id });
  return factorsPanel(c, options, found.data.id, { reset: { path, csrfToken: await mintCsrf(c, path), ...authCsrfHeader(c) } });
}

async function resolveRecoveryCodes<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountRecoveryCodes"], Response>> {
  const services = await authServices(c, options);
  const { account } = options.paths;
  const offered = authEnrollable(services, "recovery-code");
  if (!offered.ok) return err(offered.error);
  const standing = await resolveRecoveryStanding(services, identity.userId);
  if (standing === null) return err(unavailable());

  const generatePath = account.recoveryCodesGenerate();
  const confirmPath = account.recoveryCodesConfirm();
  return ok({
    remaining: standing.confirmed ? (standing.remaining ?? 0) : null,
    generatePath: authReturnQuery(c, options, generatePath),
    generateToken: await mintCsrf(c, generatePath),
    ...(state.issuedCodes === undefined ? {} : { issued: state.issuedCodes }),
    confirmPath: authReturnQuery(c, options, confirmPath),
    confirmToken: await mintCsrf(c, confirmPath),
    ...authCsrfHeader(c),
    fieldError: state.fieldError,
    icon: options.icon,
  });
}

async function resolveAdminUsers<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<AuthViewProps["adminUsers"], Response>> {
  const services = await authServices(c, options);
  const { admin } = options.paths;

  const asked = c.url.searchParams;
  const parsed = v.safeParse(
    authAdminSearchSchema(),
    { ...(asked.has("q") ? { q: asked.get("q") } : {}), ...(asked.has("after") ? { after: asked.get("after") } : {}) },
    { abortEarly: true },
  );
  if (!parsed.success) return err(createAuthRedirect(c, admin.users.list(), 302));
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
  viewer: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["adminUser"], Response>> {
  const services = await authServices(c, options);
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
    // The controls that would lock this administrator out of the console they are standing in.
    // The action refuses them; this is what stops the page offering them in the first place.
    self: viewer.userId === found.data.id,
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
  _viewer: AuthIdentity | null,
  state: AuthPageState,
): Promise<Result<AuthViewProps["adminElevate"], Response>> {
  // The same 404 `admin.elevate.submit` gives: a deployment with no configured secret has no claim
  // endpoint, so rendering an enabled form here offers a POST that cannot succeed.
  const configured = options.bootstrapSecret?.(c);
  if (configured === undefined || configured === "") return err(notFound());

  const services = await authServices(c, options);
  const { admin } = options.paths;
  const counted = await services.admin.countAdmins();
  if (!counted.ok) return err(unavailable());

  return ok({
    adminCount: counted.data,
    paths: admin,
    csrfToken: await mintCsrf(c, admin.elevate.submit()),
    ...authCsrfHeader(c),
    fieldError: state.fieldError,
    icon: options.icon,
  });
}

// A mapped table rather than a `switch`: TypeScript does not narrow a generic return type from a
// parameter discriminant, so every branch of a switch would need an unchecked cast.
/** The props-builder behind each page name. */
const AUTH_VIEW_RESOLVERS: { readonly [Name in AuthViewName]: AuthViewResolver<Name> } = {
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
  accountRecoveryCodes: resolveRecoveryCodes,
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
  accountRecoveryCodes: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  adminUsers: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminUser: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminUserEdit: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminUserFactors: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminElevate: ["require-auth", "require-enrolment", "require-fresh-step-up"],
} as const satisfies { readonly [Name in AuthViewName]: readonly AuthGuardName[] };

// `require-auth` and `require-admin` are observable here and re-checked rather than trusted; the enrolment
// pair needs a factor-registry round trip per render, so for those `guarded` is the whole check.
/** Who may read the page, or the refusal an unguarded or under-privileged request gets. */
function refuseUnguarded<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  guards: readonly AuthGuardName[],
): Result<AuthIdentity | null, Response> {
  const viewer = resolveAuthViewer(c);
  if (!guards.includes("require-auth")) return ok(viewer);
  if (viewer === null) return err(createAuthRedirect(c, options.paths.auth.signin(), 302));
  if (guards.includes("require-admin") && !viewer.isAdmin) return err(forbidden());
  return ok(viewer);
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

  const admitted = refuseUnguarded(c, options, guards);
  if (!admitted.ok) return err(admitted.error);

  const viewer = admitted.data as AuthViewViewer<Name>;
  const resolved = await AUTH_VIEW_RESOLVERS[name](c, options, viewer, request.state ?? {});
  if (!resolved.ok) return err(resolved.error);

  const View = options.views?.[name] ?? AUTH_VIEWS[name];
  return ok({ name, props: resolved.data, node: <View {...resolved.data} />, status: request.state?.status });
}
