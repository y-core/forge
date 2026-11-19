/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import type { AppContext } from "../../context/types";
import { mintCsrf } from "../../form/csrf";
import { isPartial } from "../../render/htmx/htmx-headers";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { sessionCtx } from "../../session/session";
import type { OtpLength } from "../../ui/core/types";
import { v } from "../../validation/mod";
import { AUTH_SECOND_FACTORS } from "../config";
import type {
  AuthFactorResolution,
  AuthFactorService,
  EnrollableFactorService,
  RecoveryCodeFactorService,
  TotpAppEnrolment,
} from "../factors/types";
import type { AuthSecondFactorKind } from "../factors/types";
import type { AuthFactor, AuthFactorKind } from "../types";
import { adminRefusalCtx, approvalCtx, authFreshStepUpWindow, authStepUpOwed, authStepUpWindow, stepUpHolds } from "./guards";
import { authCtx, authFactorCaller } from "./identity";
import {
  authNow,
  authCsrfHeader,
  authEnrollable,
  authPasskeyContract,
  authReplaceableTotp,
  authReturnPath,
  authReturnQuery,
  authServices,
  authSettledPath,
  authTurnstileWidget,
} from "./options";
import { AUTH_FACTOR_PARAM, AUTH_RECOVERED_PARAM, AUTH_RESENT_PARAM, AUTH_TOTP_REMOVED_PARAM } from "./paths";
import { authEnrolTarget, authEnrolmentPaths, authWithQuery } from "./paths";
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
import type { AuthFactorChoice, AuthPasskeyContract } from "./views/types";
import type { PasskeyListViewProps } from "./views/types";
import type { TotpEnrolState, TotpEnrolViewProps } from "./views/types";

const ADMIN_PAGE_SIZE = 25;

const UNAVAILABLE = "Service Unavailable";

const NOT_FOUND = "Not Found";

const FORBIDDEN = "Forbidden";

const TOTP_REMOVED = "Your authenticator app was removed before the replacement finished. Add one again below.";

/** The refusal every resolver gives when the store behind the page it is reading is down. @internal */
export function unavailable(): Response {
  return new Response(UNAVAILABLE, { status: 503 });
}

/** @internal */
export function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404 });
}

/** The refusal an authenticated request without the role its target demands gets: the one `requireAdmin` published, or a plain-text 403 where none ran. @internal */
export function forbidden<Bindings>(c: AppContext<Bindings>): Response | Promise<Response> {
  const refusal = adminRefusalCtx.getOptional(c);
  return refusal === undefined ? new Response(FORBIDDEN, { status: 403 }) : refusal();
}

// `authCtx` and nothing else: a page's data is read for whoever a guard established, so a route that
// ran neither guard resolves nobody rather than reading the session the guards were meant to judge.
/** Who this request is, as the guards established it. @internal */
export function resolveAuthViewer<Bindings>(c: AppContext<Bindings>): AuthIdentity | null {
  return authCtx.getOptional(c) ?? null;
}

async function offeredEnrolments(services: AuthRequestSurface, userId: string): Promise<AuthFactor[] | null> {
  const listed = await services.enrolments.listByUser(userId);
  if (!listed.ok) return null;
  return services.factors.offered
    .filter((service) => service.enrolment === "explicit")
    .flatMap((service) => listed.data.filter((factor) => factor.kind === service.kind));
}

function confirmedKindsOf(enrolments: readonly AuthFactor[]): AuthFactorKind[] {
  return enrolments.filter((factor) => factor.confirmedAt !== null).map((factor) => factor.kind);
}

function stepUpDemand<Bindings>(
  c: AppContext<Bindings>,
  services: AuthRequestSurface,
  identity: AuthIdentity,
  kinds: readonly AuthFactorKind[],
  resolution: AuthFactorResolution,
): AuthVerifyDemand {
  const asked = c.url.searchParams.get(AUTH_FACTOR_PARAM);
  const kind = kinds.find((held) => held === asked) ?? kinds[0];
  const service = kind === undefined ? services.factors.primary : (services.factors.find(kind) ?? services.factors.primary);
  return { factor: service.kind, digits: service.codeDigits, identity, owed: "step-up", kinds, resolution };
}

/** What the verify page is presenting: the resolution's demand, and whichever of its step-up kinds the URL chose. @internal */
export async function resolveAuthVerifyDemand<Bindings>(
  c: AppContext<Bindings>,
  services: AuthRequestSurface,
  identity: AuthIdentity | null,
): Promise<AuthVerifyDemand> {
  const primary = services.factors.primary;
  if (identity === null) return { factor: primary.kind, digits: primary.codeDigits, identity: null, owed: null, kinds: [], resolution: null };

  const resolved = await services.factors.resolve(identity.userId);
  if (!resolved.ok) return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "unknown", kinds: [], resolution: null };
  if (resolved.data.status === "enrolment-required") {
    if (authStepUpOwed(resolved.data, identity.stepUpAt, authStepUpWindow(c)))
      return stepUpDemand(c, services, identity, resolved.data.stepUpKinds, resolved.data);
    return { factor: primary.kind, digits: primary.codeDigits, identity, owed: "enrolment", kinds: resolved.data.kinds, resolution: resolved.data };
  }
  if (resolved.data.status === "satisfied") return stepUpDemand(c, services, identity, [primary.kind], resolved.data);
  return stepUpDemand(c, services, identity, resolved.data.kinds, resolved.data);
}

function countsRecoveryCodes(service: AuthFactorService): service is RecoveryCodeFactorService {
  return service.kind === "recovery-code" && "remaining" in service && typeof service.remaining === "function";
}

async function standingOf(
  services: AuthRequestSurface,
  userId: string,
  confirmedKinds: readonly AuthFactorKind[],
): Promise<AuthRecoveryStanding | null> {
  const recoverable = AUTH_SECOND_FACTORS.some((kind) => confirmedKinds.includes(kind));
  const confirmed = confirmedKinds.includes("recovery-code");
  const service = services.factors.find("recovery-code");
  if (!confirmed || service === undefined || !countsRecoveryCodes(service)) return { recoverable, confirmed, remaining: null };
  const remaining = await service.remaining(userId);
  if (!remaining.ok) return null;
  return { recoverable, confirmed, remaining: remaining.data };
}

/** Where `userId` stands on recovery codes, or `null` when a store behind the answer is down. @internal */
export async function resolveRecoveryStanding(services: AuthRequestSurface, userId: string): Promise<AuthRecoveryStanding | null> {
  const enrolments = await offeredEnrolments(services, userId);
  return enrolments === null ? null : standingOf(services, userId, confirmedKindsOf(enrolments));
}

function heldSecondKinds(resolution: AuthFactorResolution): readonly AuthFactorKind[] {
  if (resolution.status === "enrolment-required") return resolution.stepUpKinds;
  if (resolution.status === "step-up-required") return resolution.kinds;
  return [];
}

// `enrolled` is a second factor the resolution has not seen yet, so it is struck from the kinds still
// owed; whatever mandatory kind remains is enrolled next, in offer order.
async function afterFactorTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: Pick<AuthIdentity, "userId">,
  enrolled: AuthSecondFactorKind | null,
  otherwise: string,
  resolution?: AuthFactorResolution,
): Promise<Result<string, Response>> {
  const services = await authServices(c, options);
  const resolved = resolution === undefined ? await services.factors.resolve(identity.userId) : ok(resolution);
  if (!resolved.ok) return err(unavailable());
  const owed = resolved.data.status === "enrolment-required" ? resolved.data.kinds.filter((kind) => kind !== enrolled) : [];
  if (owed.length > 0) return ok(authEnrolTarget(authEnrolmentPaths(options.paths.auth), owed) ?? authSettledPath(options));
  const standing = await standingOf(services, identity.userId, heldSecondKinds(resolved.data));
  if (standing === null) return err(unavailable());
  const recoverable = standing.recoverable || enrolled !== null;
  const owesCodes = recoverable && (!standing.confirmed || standing.remaining === 0);
  return ok(owesCodes ? authReturnQuery(c, options, options.paths.account.recoveryCodes()) : otherwise);
}

/** Where a completed step-up sends the visitor — to repair, to an enrolment still owed, to codes still owed, or `otherwise` — or the 503 a failed read answers. @internal */
export function authAfterStepUpTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: Pick<AuthIdentity, "userId">,
  verified: AuthFactorKind,
  otherwise: string,
  resolution?: AuthFactorResolution,
): Promise<Result<string, Response>> {
  if (verified === "recovery-code")
    return Promise.resolve(ok(options.paths.account.factors({}, { searchParams: { [AUTH_RECOVERED_PARAM]: "1" } })));
  return afterFactorTarget(c, options, identity, null, otherwise, resolution);
}

/** Where enrolling `enrolled` sends the visitor, judged as though it were already confirmed, or the 503 a failed read answers. @internal */
export function authAfterEnrolTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: Pick<AuthIdentity, "userId">,
  enrolled: AuthSecondFactorKind,
  otherwise: string,
): Promise<Result<string, Response>> {
  return afterFactorTarget(c, options, identity, enrolled, otherwise);
}

// `signin.stepUp` takes the primary factor only from a user owing no second one, so rendering the code
// field for an owed enrolment builds a form nothing accepts: a correct code would read as "that did not match".
/** Where an established identity that owes no step-up belongs instead, or `null` when the page stands. @internal */
export function authVerifyDetour<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, demand: AuthVerifyDemand): Response | null {
  if (demand.owed === null || demand.owed === "step-up") return null;
  if (demand.owed === "unknown") return unavailable();
  const enrolment = authEnrolTarget(authEnrolmentPaths(options.paths.auth), demand.kinds) ?? authSettledPath(options);
  return createAuthRedirect(c, enrolment);
}

// Checked in code and not left to `require-fresh-step-up`: that guard can be opted out of and lets a
// `GET` through, and these pages hand out a way past the second factor on a session cookie alone.
/** The redirect to verify, returning to `next`, for a session whose step-up is outside the fresh window; `null` when it is inside. @internal */
export function authStaleStepUpDetour<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  next: string,
): Response | null {
  const fresh = authFreshStepUpWindow(c);
  if (fresh !== undefined && stepUpHolds(identity.stepUpAt, fresh.maxAgeMs, fresh.now)) return null;
  return createAuthRedirect(c, options.paths.auth.verify.show({}, { searchParams: { [options.returnParam ?? "next"]: next } }));
}

// Both code factors are bounded 6–8 at construction, so this narrows rather than clamps: a width the
// field cannot render is one no factor can be configured with.
const FIELD_WIDTHS: readonly OtpLength[] = [4, 5, 6, 7, 8];

function codeWidth(digits: number | null): OtpLength | undefined {
  return FIELD_WIDTHS.find((width) => width === digits);
}

type AuthViewViewer<Name extends AuthViewName> = "require-auth" extends (typeof AUTH_VIEW_GUARDS)[Name][number]
  ? AuthIdentity
  : AuthIdentity | null;

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
  const turnstile = await authTurnstileWidget(c, options, "signin");

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
    ...(turnstile === undefined ? {} : { turnstile }),
    icon: options.icon,
  });
}

function signupAddsSecondFactor(services: AuthRequestSurface): boolean {
  return services.factors.mandatory.length > 0;
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
  const addsSecondFactor = signupAddsSecondFactor(services);
  const turnstile = await authTurnstileWidget(c, options, "signup");

  return ok({
    submitPath: authReturnQuery(c, options, submitPath),
    signinPath: auth.signin(),
    addsSecondFactor,
    csrfToken: await mintCsrf(c, submitPath),
    ...authCsrfHeader(c),
    email: state.email,
    fieldError: state.fieldError,
    error: state.error,
    ...(turnstile === undefined ? {} : { turnstile }),
    icon: options.icon,
  });
}

async function resolveSignoutConfirm<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  _viewer: AuthIdentity | null,
  _state: AuthPageState,
): Promise<Result<AuthViewProps["signoutConfirm"], Response>> {
  const submitPath = options.paths.auth.signout();
  return ok({ submitPath, csrfToken: await mintCsrf(c, submitPath), ...authCsrfHeader(c) });
}

const RESENT_STAMP = /^\d{1,15}$/;

function resendWaitFor(stamp: string | null, reissueAfterMs: number | null, now: number): number | undefined {
  if (reissueAfterMs === null || stamp === null || !RESENT_STAMP.test(stamp)) return undefined;
  const remaining = Math.min(Number(stamp), now) + reissueAfterMs - now;
  return remaining > 0 ? remaining : undefined;
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
  // Arriving mails nothing — a `GET` with a side effect is one a cross-site navigation can trigger —
  // so a re-proof's code is sent only by the resend `POST`, and the page says so until one has been.
  const reproof = demand.identity !== null && demand.owed === "step-up" && demand.kinds.includes(services.factors.primary.kind);
  const usesPasskey = demand.factor === "passkey";
  const resendPath = demand.factor === "email-otp" ? auth.verify.resend() : undefined;
  const reissueAfterMs = services.factors.find(demand.factor)?.reissueAfterMs ?? null;
  const resendWaitMs = resendWaitFor(c.url.searchParams.get(AUTH_RESENT_PARAM), reissueAfterMs, authNow(options));
  const turnstile = await authTurnstileWidget(c, options, "verify");
  const resendTurnstile = resendPath === undefined ? undefined : await authTurnstileWidget(c, options, "resend");
  // Always the step-up pair, including for the second half of a sign-in: a passkey never starts one.
  const ceremony = auth.verify.ceremony.begin();
  const ceremonyFinish = auth.verify.ceremony.finish();
  const stepUp = demand.owed === "step-up" && demand.identity !== null ? demand.identity : null;
  const asking = (path: string, kind: AuthFactorKind) => authWithQuery(authReturnQuery(c, options, path), AUTH_FACTOR_PARAM, kind);
  const choices: AuthFactorChoice[] = demand.kinds.map((kind) => ({ kind, href: asking(auth.verify.show(), kind) }));
  const passkeyContract = async (): Promise<Result<AuthPasskeyContract, Response>> => {
    // The rendered target is the one the controller follows: a step-up changes nothing the next page is chosen by.
    const redirect =
      stepUp === null
        ? ok(authReturnPath(c, options))
        : await authAfterStepUpTarget(c, options, stepUp, "passkey", authReturnPath(c, options), demand.resolution ?? undefined);
    if (!redirect.ok) return err(redirect.error);
    return ok(await authPasskeyContract(c, "authentication", ceremony, ceremonyFinish, redirect.data));
  };
  const passkey = usesPasskey ? await passkeyContract() : undefined;
  if (passkey !== undefined && !passkey.ok) return err(passkey.error);

  return ok({
    factor: demand.factor,
    ...(codeWidth(demand.digits) === undefined ? {} : { codeDigits: codeWidth(demand.digits) }),
    passkey: passkey?.data,
    ...(stepUp === null || choices.length < 2 ? {} : { choices }),
    submitPath: stepUp === null ? authReturnQuery(c, options, submitPath) : asking(submitPath, demand.factor),
    ...(resendPath === undefined ? {} : { resendPath: authReturnQuery(c, options, resendPath) }),
    signinPath: auth.signin(),
    csrfToken: await mintCsrf(c, submitPath),
    // Its own token: `csrfProtection` binds one to the path it was minted for, and this page posts to two.
    ...(resendPath === undefined ? {} : { resendToken: await mintCsrf(c, resendPath) }),
    resent: c.url.searchParams.has(AUTH_RESENT_PARAM),
    ...(reproof && c.method === "GET" && !c.url.searchParams.has(AUTH_RESENT_PARAM) ? { codeSent: false } : {}),
    // The factor's own number, so the page cannot promise a wait it does not enforce.
    ...(resendWaitMs === undefined ? {} : { resendWaitMs }),
    ...authCsrfHeader(c),
    email: state.email,
    fieldError: state.fieldError,
    error: state.error,
    ...(turnstile === undefined ? {} : { turnstile }),
    ...(resendTurnstile === undefined ? {} : { resendTurnstile }),
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
  if (!redirect.ok) return err(redirect.error);
  return ok({
    contract: await authPasskeyContract(c, "registration", auth.enrol.ceremony.begin(), auth.enrol.ceremony.finish(), redirect.data),
    exit: { kind: "signout", path: auth.signout(), csrfToken: await mintCsrf(c, auth.signout()) },
    ...authCsrfHeader(c),
    email: identity.email,
    error: state.error,
    icon: options.icon,
  });
}

async function resolveAccountEnrolPasskey<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountPasskeyEnrol"], Response>> {
  const services = await authServices(c, options);
  const { auth, account } = options.paths;
  const offered = authEnrollable(services, "passkey");
  if (!offered.ok) return err(offered.error);
  const fresh = authFreshStepUpWindow(c);
  if (fresh !== undefined && !stepUpHolds(identity.stepUpAt, fresh.maxAgeMs, fresh.now)) {
    return err(createAuthRedirect(c, auth.verify.show({}, { searchParams: { [options.returnParam ?? "next"]: account.passkeyEnrol() } }), 302));
  }

  const redirect = await authAfterEnrolTarget(c, options, identity, "passkey", account.passkeys());
  if (!redirect.ok) return err(redirect.error);
  return ok({
    contract: await authPasskeyContract(c, "registration", account.passkeyCeremony.begin(), account.passkeyCeremony.finish(), redirect.data),
    exit: { kind: "back", path: account.passkeys() },
    ...authCsrfHeader(c),
    email: identity.email,
    error: state.error,
    icon: options.icon,
  });
}

async function passkeyPage<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
  only: string | undefined,
): Promise<Result<PasskeyListViewProps, Response>> {
  const services = await authServices(c, options);
  const { account } = options.paths;
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
    mandatory: listed.data.length === 1 && services.factors.mandatory.includes("passkey"),
    paths: account,
    enrolPath: account.passkeyEnrol(),
    backupPrompt: only === undefined && listed.data.length === 1,
    error: state.error,
    ...authCsrfHeader(c),
    icon: options.icon,
  });
}

function resolvePasskeyList<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountPasskeys"], Response>> {
  return passkeyPage(c, options, identity, state, undefined);
}

function resolvePasskey<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountPasskey"], Response>> {
  const id = c.params.id;
  return id === undefined ? Promise.resolve(err(notFound())) : passkeyPage(c, options, identity, state, id);
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

interface TotpPageTargets {
  readonly enrolPath: string;
  readonly removePath?: string | undefined;
  readonly replacePath?: string | undefined;
}

/** The authenticator-app view's props for `enrolState`, its width and period read off `service`. */
async function totpViewProps<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  service: EnrollableFactorService,
  enrolState: TotpEnrolState,
  targets: TotpPageTargets,
  mandatory: boolean,
  state: AuthPageState,
): Promise<TotpEnrolViewProps> {
  const posts = enrolState.status === "enrolled" ? (targets.removePath ?? targets.enrolPath) : targets.enrolPath;
  return {
    state: enrolState,
    enrolPath: targets.enrolPath,
    ...(targets.removePath === undefined ? {} : { removePath: targets.removePath }),
    ...(targets.replacePath === undefined ? {} : { replacePath: targets.replacePath }),
    csrfToken: await mintCsrf(c, posts),
    ...authCsrfHeader(c),
    mandatory,
    // Read off the factor, never restated here: a page asking for a width or promising a refresh
    // the factor does not use is a page whose copy the factor can be reconfigured out from under.
    ...(codeWidth(service.codeDigits) === undefined ? {} : { codeDigits: codeWidth(service.codeDigits) }),
    ...(service.codePeriodSeconds === null ? {} : { codePeriodSeconds: service.codePeriodSeconds }),
    fieldError: state.fieldError,
    error: state.error,
    icon: options.icon,
  };
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

  const enrolments = await offeredEnrolments(services, identity.userId);
  if (enrolments === null) return err(unavailable());
  const confirmed = enrolments.find((factor) => factor.kind === "totp-app" && factor.confirmedAt !== null);

  if (confirmed?.confirmedAt != null) {
    const enrolled: TotpEnrolState = { status: "enrolled", enrolledAt: confirmed.confirmedAt };
    return ok(await totpViewProps(c, options, service, enrolled, targets, services.factors.mandatory.includes("totp-app"), state));
  }
  const begun = await service.beginEnrolment(identity.userId, authNow(options));
  if (!begun.ok) return err(unavailable());
  const enrolling: TotpEnrolState = { status: "enrolling", ...(begun.data.options as TotpAppEnrolment) };
  return ok(await totpViewProps(c, options, service, enrolling, targets, false, state));
}

async function resolveTotpEnrol<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountTotp"], Response>> {
  const { account } = options.paths;
  const removed = state.error === undefined && c.url.searchParams.has(AUTH_TOTP_REMOVED_PARAM) ? { error: TOTP_REMOVED } : {};
  const replaceable = authReplaceableTotp(await authServices(c, options)).ok;
  return totpPage(
    c,
    options,
    identity,
    { ...state, ...removed },
    { enrolPath: account.totpEnrol(), removePath: account.totpRemove(), ...(replaceable ? { replacePath: account.totpReplace() } : {}) },
  );
}

// Minting the pending secret on a `GET` is the enrolment page's own precedent: it binds to this
// session alone and changes nothing until a code from it is posted.
async function resolveTotpReplace<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
  state: AuthPageState,
): Promise<Result<AuthViewProps["accountTotpReplace"], Response>> {
  const { account } = options.paths;
  const detour = authStaleStepUpDetour(c, options, identity, account.totpReplace());
  if (detour !== null) return err(detour);
  const replaceable = authReplaceableTotp(await authServices(c, options));
  if (!replaceable.ok) return err(replaceable.error);
  const session = sessionCtx.getOptional(c);
  if (session === undefined) return err(unavailable());

  const begun = await replaceable.data.beginReplacement(identity.userId, authNow(options), await authFactorCaller(session));
  if (!begun.ok) return err(begun.error === "not-enrolled" ? createAuthRedirect(c, account.totp()) : unavailable());
  const replacing: TotpEnrolState = { status: "replacing", ...(begun.data.options as TotpAppEnrolment) };
  return ok(await totpViewProps(c, options, replaceable.data, replacing, { enrolPath: account.totpReplaceConfirm() }, false, state));
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

function factorRowsOf(services: AuthRequestSurface, enrolments: readonly AuthFactor[]): AuthFactorRow[] {
  return services.factors.offered.map((service): AuthFactorRow => {
    if (service === services.factors.primary) return { kind: service.kind, state: "always", at: null };
    const enrolled = enrolments.filter((factor) => factor.kind === service.kind);
    const confirmed = enrolled.find((factor) => factor.confirmedAt !== null);
    if (confirmed?.confirmedAt != null) return { kind: service.kind, state: "enrolled", at: confirmed.confirmedAt };
    const started = enrolled[0];
    return started === undefined
      ? { kind: service.kind, state: "none", at: null }
      : { kind: service.kind, state: "pending", at: started.createdAt };
  });
}

async function factorsPanel<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  userId: string,
  extra: Pick<AuthFactorsViewProps, "manage" | "reset">,
  recovered = false,
): Promise<Result<AuthFactorsViewProps, Response>> {
  const services = await authServices(c, options);
  const [enrolments, listed] = await Promise.all([offeredEnrolments(services, userId), services.credentials.listByUser(userId)]);
  if (enrolments === null || !listed.ok) return err(unavailable());
  const confirmedKinds = confirmedKindsOf(enrolments);
  const standing = recovered ? await standingOf(services, userId, confirmedKinds) : null;
  if (recovered && standing === null) return err(unavailable());
  // A second app row is impossible, so the repair for a lost app is replacing it, never adding beside it.
  const replaceAppPath =
    standing !== null && extra.manage !== undefined && confirmedKinds.includes("totp-app") && authReplaceableTotp(services).ok
      ? extra.manage.totpReplace()
      : undefined;

  return ok({
    factors: factorRowsOf(services, enrolments),
    passkeys: listed.data,
    ...extra,
    ...(standing === null ? {} : { recovered: standing.remaining ?? 0 }),
    ...(replaceAppPath === undefined ? {} : { replaceAppPath }),
    icon: options.icon,
    ...(isPartial(c) ? { level: 2 as const } : {}),
  });
}

function resolveAccountFactors<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
): Promise<Result<AuthViewProps["accountFactors"], Response>> {
  return factorsPanel(c, options, identity.userId, { manage: options.paths.account }, c.url.searchParams.has(AUTH_RECOVERED_PARAM));
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

async function resolveAccountSessions<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  identity: AuthIdentity,
): Promise<Result<AuthViewProps["accountSessions"], Response>> {
  const services = await authServices(c, options);
  const { account } = options.paths;
  const listed = await services.sessions.listByUser(identity.userId, authNow(options));
  if (!listed.ok) return err(unavailable());

  const revokePath = account.sessionRevoke();
  const revokeOthersPath = account.sessionsRevokeOthers();
  return ok({
    rows: listed.data,
    currentId: identity.sessionId,
    revokePath,
    revokeToken: await mintCsrf(c, revokePath),
    revokeOthersPath,
    revokeOthersToken: await mintCsrf(c, revokeOthersPath),
    ...authCsrfHeader(c),
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
  _state: AuthPageState,
): Promise<Result<AuthViewProps["adminElevate"], Response>> {
  const services = await authServices(c, options);
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
// parameter discriminant, so every branch of a switch would need an unchecked cast.
const AUTH_VIEW_RESOLVERS: { readonly [Name in AuthViewName]: AuthViewResolver<Name> } = {
  signin: resolveSignin,
  signup: resolveSignup,
  signoutConfirm: resolveSignoutConfirm,
  verify: resolveVerify,
  enrolPasskey: resolveEnrolPasskey,
  enrolTotp: resolveEnrolTotp,
  accountPasskeys: resolvePasskeyList,
  accountPasskeyEnrol: resolveAccountEnrolPasskey,
  accountPasskey: resolvePasskey,
  accountPasskeyEdit: resolvePasskeyEdit,
  accountTotp: resolveTotpEnrol,
  accountTotpReplace: resolveTotpReplace,
  accountEmailChange: resolveEmailChange,
  accountFactors: resolveAccountFactors,
  accountRecoveryCodes: resolveRecoveryCodes,
  accountSessions: resolveAccountSessions,
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
  signoutConfirm: [],
  verify: ["resolve-auth"],
  enrolPasskey: ["require-auth", "require-pending-enrolment"],
  enrolTotp: ["require-auth", "require-pending-enrolment"],
  accountPasskeys: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountPasskeyEnrol: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountPasskey: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountPasskeyEdit: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountTotp: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountTotpReplace: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountEmailChange: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountFactors: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountRecoveryCodes: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  accountSessions: ["require-auth", "require-enrolment", "require-fresh-step-up"],
  adminUsers: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminUser: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminUserEdit: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminUserFactors: ["require-auth", "require-enrolment", "require-admin", "require-fresh-step-up"],
  adminElevate: ["require-auth", "require-enrolment", "require-fresh-step-up", "require-approval"],
} as const satisfies { readonly [Name in AuthViewName]: readonly AuthGuardName[] };

// `require-auth`, `require-admin` and `require-approval` are observable here and re-checked rather than trusted; the
// enrolment pair needs a factor-registry round trip per render, so for those `guarded` is the whole check.
async function refuseUnguarded<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  guards: readonly AuthGuardName[],
): Promise<Result<AuthIdentity | null, Response>> {
  const viewer = resolveAuthViewer(c);
  if (guards.includes("require-auth") && viewer === null) return err(createAuthRedirect(c, options.paths.auth.signin(), 302));
  if (guards.includes("require-admin") && viewer?.isAdmin !== true) return err(await forbidden(c));
  if (guards.includes("require-approval") && approvalCtx.getOptional(c) === undefined) return err(notFound());
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

  const admitted = await refuseUnguarded(c, options, guards);
  if (!admitted.ok) return err(admitted.error);

  const viewer = admitted.data as AuthViewViewer<Name>;
  const resolved = await AUTH_VIEW_RESOLVERS[name](c, options, viewer, request.state ?? {});
  if (!resolved.ok) return err(resolved.error);

  const View = options.views?.[name] ?? AUTH_VIEWS[name];
  return ok({ name, props: resolved.data, node: <View {...resolved.data} />, status: request.state?.status });
}
