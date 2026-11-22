import { firstDeclaredField, screenTurnstile } from "../../app/pipeline";
import { getAppContext } from "../../context/types";
import type { AppContext, RefuseHook, RequestHandler } from "../../context/types";
import { FORM_MAX_BYTES_DEFAULT } from "../../form/config";
import { TURNSTILE_FIELD_DEFAULT } from "../../form/constants";
import { csrfFieldCtx } from "../../form/csrf-context";
import { isFormCapConflict, parseFormData } from "../../form/parse-form-data";
import { formToObject } from "../../form/to-object";
import type { ReadonlyFormData } from "../../form/types";
import { jsonResponse } from "../../http/response";
import { requestLog } from "../../logging/request-logger";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { sessionCtx } from "../../session/session";
import { describeValidationIssue, v } from "../../validation/mod";
import type { EnrollableFactorService } from "../factors/types";
import { redactSigninReason } from "../flows/signin";
import type { AuthSigninNotice, AuthSigninReason } from "../flows/types";
import type { AdminUserOutcome, AuthFactorKind } from "../types";
import { authDeviceLabel } from "./device";
import { approvalCtx, signoutCsrfRecovery } from "./guards";
import {
  AUTH_SITE_DATA_OWED_SESSION_KEY,
  authFactorCaller,
  authSessionTokenHash,
  clearAuthSession,
  establishAuthSession,
  markAuthSigninPending,
  markAuthStepUp,
  mintAuthSessionRotation,
  authWriteOrigin,
  resolveAuthSigninPending,
  revokeOtherAuthSessions,
  NO_SESSION,
} from "./identity";
import {
  loadAccountSessions,
  loadAdminElevate,
  loadAdminUserEdit,
  loadEmailChange,
  loadEnrolTotp,
  loadPasskeyEdit,
  loadPasskeyList,
  loadRecoveryCodes,
  loadSignin,
  loadSignup,
  loadTotpEnrol,
  loadTotpReplace,
  loadVerify,
} from "./loaders";
import {
  authEnrollable,
  authNow,
  authReplaceableTotp,
  authReturnPath,
  authReturnQuery,
  authServices,
  authSettledPath,
  authTurnstileCheck,
} from "./options";
import { AUTH_RESENT_PARAM, AUTH_TOTP_REMOVED_PARAM, authEnrolTarget, authEnrolmentPaths, authWithQuery } from "./paths";
import { createAuthRedirect } from "./redirect";
import {
  authAfterEnrolTarget,
  authAfterStepUpTarget,
  authStaleStepUpDetour,
  authVerifyDetour,
  forbidden,
  resolveAuthVerifyDemand,
  resolveAuthViewer,
  resolveRecoveryStanding,
} from "./resolve";
import {
  authAdminElevateSchema,
  authAdminUserSchema,
  authEmailChangeSchema,
  authPasskeyLabelSchema,
  authSessionRevokeSchema,
  authSigninSchema,
  authSignupSchema,
  authTotpEnrolSchema,
  authVerifySchema,
} from "./schemas";
import { clearSiteDataOwedCookie, hasSiteDataOwedCookie, markSiteDataOwedCookie } from "./site-data";
import type { AuthEntryPaths, AuthIdentity } from "./types";
import type { AuthTurnstileCheck } from "./types";
import type { AuthPageState, AuthRequestSurface, AuthWebOptions } from "./types";

const SIGNIN_NOTICE: Readonly<Record<Exclude<AuthSigninNotice, "throttled" | "unrecognised">, string>> = {
  unavailable: "We could not reach the sign-in service. Please try again in a moment.",
  unusable: "This sign-in method can't be checked right now. Choose another method below.",
};

const THROTTLED_RESEND_NOTICE = "Too many attempts. Wait a while before asking for another code.";

const THROTTLED_RETRY_NOTICE = "Too many attempts. Wait a while, then try again.";

const FIELD_REFUSAL: Readonly<Record<string, string>> = {
  email: "Enter an email address in the form name@example.com.",
  code: "That code is not the shape we sent. Enter the digits exactly as they appear.",
  label: "Use a shorter name for this passkey.",
  role: "Pick a role from the list.",
  status: "Pick a status from the list.",
};

const FIELD_REFUSAL_DEFAULT = "We could not read that. Please check the form and try again.";

const CHALLENGE_REFUSAL = "Verification failed. Please try again.";

const TOO_LARGE_REFUSAL = "That form was too large to read. Please try again.";

const RECOVERY_CODE_REFUSAL = "That is not one of the new codes. Enter one exactly as it is shown.";

const TOTP_ENROL_REFUSAL = "That code did not match. Enter the code your app shows now.";

// The pending secret is gone and the page now shows another, so another code from the app cannot match.
const TOTP_REPLACE_RESTARTED = "That setup expired. Remove the entry you just added to your app, then add the new secret below and enter its code.";

const UNRECOGNISED_NOTICE: Readonly<Record<AuthFactorKind, string>> = {
  "email-otp": "That did not match. Ask for a new code and try again.",
  "totp-app": TOTP_ENROL_REFUSAL,
  "recovery-code": "That recovery code did not match. Check it and try again.",
  passkey: "That did not match. Please try again.",
};

/** `page` with `Retry-After` set to `windowMs` in whole seconds, or unchanged where the window is unknown. */
function withRetryAfter(page: Response, windowMs: number | null): Response {
  if (windowMs !== null) page.headers.set("Retry-After", String(Math.ceil(windowMs / 1000)));
  return page;
}

function verifyNoticeFor(factor: AuthFactorKind, reason: AuthSigninReason): string {
  const notice = redactSigninReason(reason);
  if (notice === "unrecognised") return UNRECOGNISED_NOTICE[factor];
  if (notice === "throttled") return factor === "email-otp" ? THROTTLED_RESEND_NOTICE : THROTTLED_RETRY_NOTICE;
  return SIGNIN_NOTICE[notice];
}

const RECOVERY_CODE_UNREADABLE = "That is not a recovery code. Enter one exactly as you saved it.";

const RECOVERY_CODES_UNOWED = "Recovery codes are issued only to an account holding an authenticator app or a passkey.";

const EMAIL_CHANGE_NOTICE = "We could not start that change. Check the address and try again.";

// No remaining time: the wait is the account's own, and counting it down would date its last request.
const EMAIL_CHANGE_TOO_SOON_NOTICE = "A change of address was requested recently. Try again in a few minutes.";

const TOTP_MANDATORY = "Your account requires an authenticator app, so it can't be removed. Replace it instead.";

const PASSKEY_MANDATORY = "Your account requires a passkey. Add another before you remove this one.";

const CEREMONY_REFUSED = "The passkey was not accepted.";

const CEREMONY_UNAVAILABLE = "The passkey service is unavailable.";

const CEREMONY_TOO_LARGE = "That request was too large.";

function unavailable(): Response {
  return new Response("Service Unavailable", { status: 503 });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

interface AuthSubmissionRefusal {
  readonly cause: "challenge" | "submission" | "too-large";
  readonly status: 413 | 422;
  readonly field: string;
  readonly message: string;
  readonly values: Readonly<Record<string, string>>;
}

// The CSRF policy parses first at its own cap, which an app raises for its largest route; this
// re-check off the shared parse is what holds an unauthenticated form to a form's size.
/** The largest form body an auth action accepts, whatever the CSRF policy's `maxBytes`. @internal */
export const AUTH_FORM_MAX_BYTES = FORM_MAX_BYTES_DEFAULT;

const isTooLarge = (error: unknown): boolean => (error as { status?: unknown } | null | undefined)?.status === 413;

/** Reads a form submission against `schema`, behind `check` when one is given, dropping the CSRF and Turnstile fields. @internal */
export async function readAuthSubmission<schema extends v.GenericSchema, Bindings>(
  c: AppContext<Bindings>,
  schema: schema,
  check?: AuthTurnstileCheck,
): Promise<Result<v.InferOutput<schema>, AuthSubmissionRefusal>> {
  let form: ReadonlyFormData;
  try {
    form = await parseFormData(c, { maxBytes: AUTH_FORM_MAX_BYTES });
  } catch (error) {
    if (isFormCapConflict(error)) throw error;
    if (isTooLarge(error)) return err({ cause: "too-large", status: 413, field: "", message: TOO_LARGE_REFUSAL, values: {} });
    return err({ cause: "submission", status: 422, field: "", message: FIELD_REFUSAL_DEFAULT, values: {} });
  }
  const csrfField = csrfFieldCtx.getOptional(c);
  const drop = [...(csrfField === undefined ? [] : [csrfField]), ...(check === undefined ? [] : [TURNSTILE_FIELD_DEFAULT])];
  const body = formToObject(form, drop.length === 0 ? {} : { drop: new Set(drop) });
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(body)) {
    if (typeof value === "string") values[name] = value;
  }

  if (check !== undefined) {
    const verification = await screenTurnstile(c, form, check.secretKey, check.verify);
    if (!verification.ok) {
      return err({ cause: "challenge", status: 422, field: firstDeclaredField(schema) ?? "", message: CHALLENGE_REFUSAL, values });
    }
  }

  const parsed = v.safeParse(schema, body, { abortEarly: true });
  if (parsed.success) return ok(parsed.output);
  const field = parsed.issues[0] === undefined ? "" : describeValidationIssue(parsed.issues[0]);
  return err({ cause: "submission", status: 422, field, message: refusalFor(schema, field), values });
}

function refusalFor(schema: v.GenericSchema, field: string): string {
  const entries: unknown = "entries" in schema ? schema.entries : undefined;
  const declared = typeof entries === "object" && entries !== null && Object.hasOwn(entries, field);
  return declared && Object.hasOwn(FIELD_REFUSAL, field) ? (FIELD_REFUSAL[field] ?? FIELD_REFUSAL_DEFAULT) : FIELD_REFUSAL_DEFAULT;
}

function readEnrolmentNickname(presented: unknown): Result<string | null, undefined> {
  if (presented === undefined || presented === null) return ok(null);
  if (typeof presented !== "string") return err(undefined);
  const parsed = v.safeParse(authPasskeyLabelSchema(), { label: presented }, { abortEarly: true });
  return parsed.success ? ok(parsed.output.label) : err(undefined);
}

// A WebAuthn ceremony envelope is a few kilobytes; 64 KiB is generous for one and still a bound.
// Without it a ceremony endpoint reads whatever a client cared to send, into a Worker's memory.
/** The largest ceremony envelope a JSON endpoint reads before it answers 413. @internal */
export const AUTH_CEREMONY_MAX_BYTES = 65_536;

type CeremonyBody = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly response: Response };

// The stream is metered as well as the `Content-Length`, because a chunked body's header may be absent or lying.
async function readCeremonyBody<Bindings>(c: AppContext<Bindings>): Promise<CeremonyBody> {
  // `text/plain` is a form's `enctype` and needs no preflight, so a cross-site form can post a
  // JSON-shaped body. Parsing on shape alone would read it; only the declared type refuses it.
  const type = c.request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return { ok: false, response: jsonResponse({ error: CEREMONY_REFUSED }, 415) };

  const declared = c.request.headers.get("content-length");
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > AUTH_CEREMONY_MAX_BYTES) {
    return { ok: false, response: jsonResponse({ error: CEREMONY_TOO_LARGE }, 413) };
  }
  if (!c.request.body) return { ok: true, body: null };

  let seen = 0;
  let overflowed = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > AUTH_CEREMONY_MAX_BYTES) {
        overflowed = true;
        controller.error(new Error("ceremony body too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    // A `Response`, not a `Request`, wraps the metered stream: no `duplex` option is needed.
    const body: unknown = await new Response(c.request.body.pipeThrough(counter), { headers: c.request.headers }).json();
    return { ok: true, body };
  } catch {
    if (overflowed) return { ok: false, response: jsonResponse({ error: CEREMONY_TOO_LARGE }, 413) };
    return { ok: false, response: jsonResponse({ error: CEREMONY_REFUSED }, 400) };
  }
}

function enrolTarget<Bindings>(options: AuthWebOptions<Bindings>, kinds: readonly AuthFactorKind[]): string {
  return authEnrolTarget(authEnrolmentPaths(options.paths.auth), kinds) ?? authSettledPath(options);
}

async function signedInTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  userId: string,
): Promise<Result<string, Response>> {
  const services = await authServices(c, options);
  const resolved = await services.factors.resolve(userId);
  if (!resolved.ok) return err(unavailable());
  if (resolved.data.status === "enrolment-required" && resolved.data.stepUpKinds.length === 0) return ok(enrolTarget(options, resolved.data.kinds));
  if (resolved.data.status !== "satisfied") return ok(options.paths.auth.verify.show());
  return ok(authReturnPath(c, options));
}

/** The POST that starts a sign-in, challenging the deployment's primary factor. @public */
export function createSigninActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly signinSubmit: RequestHandler } {
  return {
    signinSubmit: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);

      const parsed = await readAuthSubmission(c, authSigninSchema(), await authTurnstileCheck(c, options, "signin"));
      if (!parsed.ok)
        return loadSignin(c, options, { email: parsed.error.values.email, fieldError: parsed.error.message, status: parsed.error.status });

      // The address is on the session and not in the redirect: `complete` needs it back, and a query
      // parameter carrying it lands in browser history, `Referer` and every proxy log on the way.
      services.signin.request(parsed.data.email, authNow(options), await authFactorCaller(session));
      markAuthSigninPending(session, parsed.data.email);
      return createAuthRedirect(c, authReturnQuery(c, options, options.paths.auth.verify.show()));
    },
  };
}

/** The POST that starts an account, which answers a known address and a new one alike. @public */
export function createSignupActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly signupSubmit: RequestHandler } {
  return {
    signupSubmit: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);

      const parsed = await readAuthSubmission(c, authSignupSchema(), await authTurnstileCheck(c, options, "signup"));
      if (!parsed.ok)
        return loadSignup(c, options, { email: parsed.error.values.email, fieldError: parsed.error.message, status: parsed.error.status });

      services.signup.request(parsed.data.email, authNow(options), await authFactorCaller(session));
      markAuthSigninPending(session, parsed.data.email);
      return createAuthRedirect(c, authReturnQuery(c, options, options.paths.auth.verify.show()));
    },
  };
}

interface ResendRefusal {
  readonly error: string;
  readonly status: 413 | 422;
}

async function resendRefusal<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>): Promise<ResendRefusal | null> {
  const check = await authTurnstileCheck(c, options, "resend");
  if (check === undefined) return null;
  let form: ReadonlyFormData;
  try {
    form = await parseFormData(c, { maxBytes: AUTH_FORM_MAX_BYTES });
  } catch (error) {
    if (isFormCapConflict(error)) throw error;
    if (isTooLarge(error)) return { error: TOO_LARGE_REFUSAL, status: 413 };
    requestLog.getOptional(c)?.warn("auth.resend.unreadable");
    return { error: FIELD_REFUSAL_DEFAULT, status: 422 };
  }
  const verification = await screenTurnstile(c, form, check.secretKey, check.verify);
  return verification.ok ? null : { error: CHALLENGE_REFUSAL, status: 422 };
}

/** The POSTs of the verification page: presenting the code, and asking for another. @public */
export function createVerifyActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly submit: RequestHandler;
  readonly resend: RequestHandler;
} {
  return {
    submit: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const at = authNow(options);

      const demand = await resolveAuthVerifyDemand(c, services, resolveAuthViewer(c));
      const detour = authVerifyDetour(c, options, demand);
      if (detour !== null) return detour;

      const check = await authTurnstileCheck(c, options, "verify");
      const parsed = await readAuthSubmission(c, authVerifySchema(demand.factor, demand.digits ?? undefined), check);
      if (!parsed.ok) {
        const fieldError =
          demand.factor === "recovery-code" && parsed.error.cause === "submission" ? RECOVERY_CODE_UNREADABLE : parsed.error.message;
        return loadVerify(c, options, { fieldError, status: parsed.error.status });
      }

      if (demand.identity !== null) {
        const stepped = await services.signin.stepUp(demand.identity.userId, demand.factor, parsed.data.code, at, await authFactorCaller(session));
        if (!stepped.ok) {
          if (stepped.error === "unusable") requestLog.getOptional(c)?.warn("auth.factor.unusable", { kind: demand.factor });
          const error = verifyNoticeFor(demand.factor, stepped.error);
          if (redactSigninReason(stepped.error) !== "throttled") return loadVerify(c, options, { error, status: 422 });
          return withRetryAfter(
            await loadVerify(c, options, { error, status: 429 }),
            services.factors.find(demand.factor)?.attemptWindowMs ?? null,
          );
        }
        if (stepped.data.kind === "recovery-code") {
          services.notices.send(demand.identity.email, { type: "recovery-code-used", factorKind: "recovery-code", at });
        }
        const marked = await markAuthStepUp(session, services.sessions, at, authNow(options), stepped.data.kind);
        if (!marked.ok) return unavailable();
        const target = await authAfterStepUpTarget(
          c,
          options,
          demand.identity,
          demand.factor,
          authReturnPath(c, options),
          demand.resolution ?? undefined,
        );
        return target.ok ? createAuthRedirect(c, target.data) : target.error;
      }

      const pending = resolveAuthSigninPending(session);
      if (pending === null) return createAuthRedirect(c, options.paths.auth.signin());

      const completed = await services.signin.complete(pending, parsed.data.code, at, await authFactorCaller(session));
      if (!completed.ok) {
        return loadVerify(c, options, { email: pending, error: verifyNoticeFor(demand.factor, completed.error), status: 422 });
      }

      const resolution = completed.data.resolution;
      // The code just accepted is the re-proof a user owing no second factor steps up with.
      const established = await establishAuthSession(session, services.sessions, completed.data.user.id, at, authNow(options), {
        kind: completed.data.kind,
        steppedUp: resolution.status === "satisfied",
        device: authDeviceLabel(c.request.headers),
      });
      if (!established.ok) return unavailable();
      if (await hasSiteDataOwedCookie(c)) await clearSiteDataOwedCookie(c);
      if (resolution.status === "enrolment-required" && resolution.stepUpKinds.length === 0) {
        return createAuthRedirect(c, authReturnQuery(c, options, enrolTarget(options, resolution.kinds)));
      }
      if (resolution.status !== "satisfied") {
        return createAuthRedirect(c, authReturnQuery(c, options, options.paths.auth.verify.show()));
      }
      return createAuthRedirect(c, authReturnPath(c, options));
    },

    resend: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const at = authNow(options);
      // Every outcome that depends on the account shares this redirect: only a real account can be
      // inside the reissue window, so reporting whether a code was issued would bin an address list.
      const resent = authWithQuery(authReturnQuery(c, options, options.paths.auth.verify.show()), AUTH_RESENT_PARAM, String(at));
      const demand = await resolveAuthVerifyDemand(c, services, resolveAuthViewer(c));
      const detour = authVerifyDetour(c, options, demand);
      if (detour !== null) return detour;

      if (demand.identity !== null) {
        const refusal = await resendRefusal(c, options);
        if (refusal !== null) return loadVerify(c, options, refusal);
        await services.signin.requestStepUp(demand.identity.userId, demand.factor, at, await authFactorCaller(session));
        return createAuthRedirect(c, resent);
      }

      const pending = resolveAuthSigninPending(session);
      if (pending === null) return createAuthRedirect(c, options.paths.auth.signin());
      const refusal = await resendRefusal(c, options);
      if (refusal !== null) return loadVerify(c, options, { email: pending, ...refusal });
      // Synchronous by design: `request` reads nothing about the address before returning, so a
      // registered one and an unknown one differ in neither shape nor time. There is nothing to await.
      services.signin.request(pending, at, await authFactorCaller(session));
      return createAuthRedirect(c, resent);
    },
  };
}

// Chromium holds any response carrying `"storage"` for seconds, so the navigation clears the cache
// alone and the next auth page asks for the storage half off the critical path.
const AUTH_SIGNOUT_CLEAR_SITE_DATA = '"cache"';

const AUTH_SITE_DATA_CLEAR = '"storage"';

/** The POST that ends a session, destroying it on the way out, and the one that clears the storage a sign-out owes. @public */
export function createSignoutActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly signout: RequestHandler;
  readonly signoutSiteData: RequestHandler;
} {
  return {
    signout: async (context) => {
      const c = getAppContext<Bindings>(context);
      const session = sessionCtx.get(c, NO_SESSION);
      const services = await authServices(c, options);
      const cleared = await clearAuthSession(session, services.sessions, options.signOut);
      if (!cleared.ok) return unavailable();
      const response = createAuthRedirect(c, options.paths.auth.signin());
      if (options.signoutClearsSiteData !== true) return response;
      if (session.destroyed) await markSiteDataOwedCookie(c);
      else session.set(AUTH_SITE_DATA_OWED_SESSION_KEY, true);
      response.headers.set("Clear-Site-Data", AUTH_SIGNOUT_CLEAR_SITE_DATA);
      return response;
    },
    signoutSiteData: async (context) => {
      const c = getAppContext<Bindings>(context);
      const session = sessionCtx.get(c, NO_SESSION);
      const owedBySession = session.get(AUTH_SITE_DATA_OWED_SESSION_KEY) === true;
      const owedByCookie = await hasSiteDataOwedCookie(c);
      if (!owedBySession && !owedByCookie) return new Response(null, { status: 204 });
      if (owedBySession) session.unset(AUTH_SITE_DATA_OWED_SESSION_KEY);
      if (owedByCookie) await clearSiteDataOwedCookie(c);
      return new Response(null, { status: 204, headers: { "Clear-Site-Data": AUTH_SITE_DATA_CLEAR } });
    },
  };
}

/** The refusal hook that sends a CSRF-refused sign-out to its confirm page and declines every other refusal, so the next hook out answers it. @public */
export function authCsrfRefusal<Bindings = Record<string, unknown>>(paths: AuthEntryPaths): RefuseHook<Bindings> {
  return signoutCsrfRecovery<Bindings>(paths.signout(), paths.signoutConfirm());
}

// The challenge is bound to the session's own `userId`, which `createPasskeyFactor.verifyChallenge`
// re-checks against the assertion before it admits anything.
/** The JSON endpoints of a passkey step-up, held against the session that is already signed in. @public */
export function createPasskeyStepUpActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly begin: RequestHandler;
  readonly finish: RequestHandler;
} {
  const kind: AuthFactorKind = "passkey";

  return {
    begin: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const identity = resolveAuthViewer(c);
      const service = services.factors.find(kind);
      if (identity === null || service === undefined) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      const challenge = await service.createChallenge(identity.userId, authNow(options), await authFactorCaller(session));
      return challenge.ok ? jsonResponse(challenge.data.options ?? {}) : jsonResponse({ error: CEREMONY_UNAVAILABLE }, 503);
    },

    finish: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const at = authNow(options);
      const identity = resolveAuthViewer(c);
      const service = services.factors.find(kind);
      if (identity === null || service === undefined) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      const read = await readCeremonyBody(c);
      if (!read.ok) return read.response;
      const body = read.body as { credential?: unknown } | null;
      if (body?.credential === undefined || body.credential === null) return jsonResponse({ error: CEREMONY_REFUSED }, 400);

      const verified = await service.verifyChallenge(identity.userId, JSON.stringify(body.credential), at, await authFactorCaller(session));
      if (!verified.ok) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      const marked = await markAuthStepUp(session, services.sessions, at, authNow(options), verified.data.kind);
      if (!marked.ok) return jsonResponse({ error: CEREMONY_UNAVAILABLE }, 503);
      const target = await authAfterStepUpTarget(c, options, identity, kind, authReturnPath(c, options));
      return target.ok ? jsonResponse({ redirect: target.data }) : jsonResponse({ error: CEREMONY_UNAVAILABLE }, 503);
    },
  };
}

/** The begin and finish endpoints of a passkey enrolment, whose finish lands on `otherwise` once nothing else is owed. */
function passkeyEnrolCeremony<Bindings>(
  options: AuthWebOptions<Bindings>,
  otherwise: string,
): { readonly begin: RequestHandler; readonly finish: RequestHandler } {
  async function enrolmentService(c: AppContext<Bindings>, services: AuthRequestSurface) {
    const identity = resolveAuthViewer(c);
    const offered = authEnrollable(services, "passkey");
    if (identity === null || !offered.ok) return null;
    return { identity, service: offered.data } as const;
  }

  return {
    begin: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const held = await enrolmentService(c, services);
      if (held === null) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      const begun = await held.service.beginEnrolment(held.identity.userId, authNow(options));
      return begun.ok ? jsonResponse(begun.data.options ?? {}) : jsonResponse({ error: CEREMONY_UNAVAILABLE }, 503);
    },

    finish: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const held = await enrolmentService(c, services);
      if (held === null) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      const read = await readCeremonyBody(c);
      if (!read.ok) return read.response;
      const body = read.body as { credential?: unknown; nickname?: unknown } | null;
      const credential = body?.credential;
      if (credential === undefined || credential === null) return jsonResponse({ error: CEREMONY_REFUSED }, 400);

      const nickname = readEnrolmentNickname(body?.nickname);
      if (!nickname.ok) return jsonResponse({ error: CEREMONY_REFUSED }, 400);

      const envelope = JSON.stringify({ credential, nickname: nickname.data });
      const at = authNow(options);
      const completed = await held.service.completeEnrolment(held.identity.userId, envelope, at, await authFactorCaller(session));
      if (!completed.ok) return jsonResponse({ error: CEREMONY_REFUSED }, 400);
      services.notices.send(held.identity.email, { type: "factor-added", factorKind: "passkey", at });
      const target = await authAfterEnrolTarget(c, options, held.identity, "passkey", otherwise);
      return target.ok ? jsonResponse({ redirect: target.data }) : jsonResponse({ error: CEREMONY_UNAVAILABLE }, 503);
    },
  };
}

/** The JSON endpoints of the passkey enrolment a sign-in still owes. @public */
export function createPasskeyEnrolActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly begin: RequestHandler;
  readonly finish: RequestHandler;
} {
  return passkeyEnrolCeremony(options, authSettledPath(options));
}

/** The JSON endpoints of a passkey enrolment made from the account pages, landing back on the passkey list. @public */
export function createPasskeyAccountEnrolActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly begin: RequestHandler;
  readonly finish: RequestHandler;
} {
  return passkeyEnrolCeremony(options, options.paths.account.passkeys());
}

/** The rename and remove writes of one registered passkey. @public */
export function createPasskeyManageActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly passkeyRename: RequestHandler;
  readonly passkeyRemove: RequestHandler;
} {
  return {
    passkeyRename: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      const id = c.params.id;
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());
      const offered = authEnrollable(services, "passkey");
      if (!offered.ok) return offered.error;
      if (id === undefined) return notFound();

      const parsed = await readAuthSubmission(c, authPasskeyLabelSchema());
      if (!parsed.ok) return loadPasskeyEdit(c, options, { fieldError: parsed.error.message, status: parsed.error.status });

      const relabelled = await services.credentials.relabel(id, identity.userId, parsed.data.label, authNow(options));
      if (!relabelled.ok) return unavailable();
      if (!relabelled.data) return notFound();
      return loadPasskeyEdit(c, options);
    },

    passkeyRemove: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const identity = resolveAuthViewer(c);
      const id = c.params.id;
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());
      const offered = authEnrollable(services, "passkey");
      if (!offered.ok) return offered.error;
      if (id === undefined) return notFound();

      // Taking a credential away is what a visitor does when they think it is no longer theirs, so
      // it has to reach the sessions it may already have signed in — which this request cannot see.
      const keep = await authSessionTokenHash(session);
      if (keep === null) return createAuthRedirect(c, options.paths.auth.signin());
      const at = authNow(options);
      const removed = await services.credentials.removeForUser(id, identity.userId, at, { keep }, services.factors.mandatory);
      if (!removed.ok) return unavailable();
      if (removed.data === "second-factor-required") return loadPasskeyList(c, options, { error: PASSKEY_MANDATORY, status: 409 });
      if (removed.data === "not-found") return notFound();
      services.notices.send(identity.email, { type: "factor-removed", factorKind: "passkey", at });
      return loadPasskeyList(c, options);
    },
  };
}

type AuthPageReload<Bindings> = (c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state?: AuthPageState) => Promise<Response>;

const TOTP_KIND: AuthFactorKind = "totp-app";

async function confirmTotp<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  reload: AuthPageReload<Bindings>,
): Promise<Result<AuthIdentity, Response>> {
  const services = await authServices(c, options);
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(createAuthRedirect(c, options.paths.auth.signin()));
  const service = services.factors.find(TOTP_KIND);
  if (service === undefined || service.enrolment !== "explicit") return err(notFound());

  const parsed = await readAuthSubmission(c, authTotpEnrolSchema());
  if (!parsed.ok) return err(await reload(c, options, { fieldError: parsed.error.message, status: parsed.error.status }));

  const caller = await authFactorCaller(sessionCtx.get(c, NO_SESSION));
  const at = authNow(options);
  const confirmed = await service.completeEnrolment(identity.userId, parsed.data.code, at, caller);
  if (!confirmed.ok) return err(await reload(c, options, { fieldError: TOTP_ENROL_REFUSAL, status: 422 }));
  services.notices.send(identity.email, { type: "factor-added", factorKind: TOTP_KIND, at });
  return ok(identity);
}

/** The POST that confirms the authenticator-app enrolment a sign-in still owes. @public */
export function createTotpEnrolActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly totpEnrol: RequestHandler } {
  return {
    totpEnrol: async (context) => {
      const c = getAppContext<Bindings>(context);
      const confirmed = await confirmTotp(c, options, loadEnrolTotp);
      if (!confirmed.ok) return confirmed.error;

      const target = await signedInTarget(c, options, confirmed.data.userId);
      return target.ok ? createAuthRedirect(c, target.data) : target.error;
    },
  };
}

/** The confirmation, removal and in-place replacement of an authenticator-app enrolment from the account pages. @public */
export function createTotpManageActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly totpEnrol: RequestHandler;
  readonly totpRemove: RequestHandler;
  readonly totpReplaceConfirm: RequestHandler;
} {
  const kind = TOTP_KIND;

  return {
    totpEnrol: async (context) => {
      const c = getAppContext<Bindings>(context);
      const confirmed = await confirmTotp(c, options, loadTotpEnrol);
      if (!confirmed.ok) return confirmed.error;
      const target = await authAfterStepUpTarget(c, options, confirmed.data, kind, options.paths.account.totp());
      return target.ok ? createAuthRedirect(c, target.data) : target.error;
    },

    totpRemove: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());
      const service = services.factors.find(kind);
      if (service === undefined) return notFound();

      const held = await service.listEnrolments(identity.userId);
      if (!held.ok) return unavailable();
      const origin = await authWriteOrigin(sessionCtx.get(c, NO_SESSION));
      const at = authNow(options);
      let removed = false;
      for (const factor of held.data) {
        const dropped = await services.enrolments.remove(factor.id, identity.userId, at, origin, services.factors.mandatory);
        if (!dropped.ok) return unavailable();
        if (dropped.data === "second-factor-required") return loadTotpEnrol(c, options, { error: TOTP_MANDATORY, status: 409 });
        removed ||= dropped.data === "changed" && factor.confirmedAt !== null;
      }
      if (removed) services.notices.send(identity.email, { type: "factor-removed", factorKind: kind, at });
      return createAuthRedirect(c, options.paths.account.totp());
    },

    totpReplaceConfirm: async (context) => {
      const c = getAppContext<Bindings>(context);
      const { account } = options.paths;
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());
      const detour = authStaleStepUpDetour(c, options, identity, account.totpReplace());
      if (detour !== null) return detour;
      const replaceable = authReplaceableTotp(services);
      if (!replaceable.ok) return replaceable.error;

      const parsed = await readAuthSubmission(c, authTotpEnrolSchema());
      if (!parsed.ok) return loadTotpReplace(c, options, { fieldError: parsed.error.message, status: parsed.error.status });
      const caller = await authFactorCaller(sessionCtx.get(c, NO_SESSION));
      const at = authNow(options);
      const replaced = await replaceable.data.completeReplacement(identity.userId, parsed.data.code, at, caller);
      if (!replaced.ok) {
        if (replaced.error === "unavailable") return unavailable();
        if (replaced.error === "not-enrolled") return createAuthRedirect(c, account.totp({}, { searchParams: { [AUTH_TOTP_REMOVED_PARAM]: "1" } }));
        // The reload resumes a pending secret a wrong code put back, and mints the next one where it was spent or lapsed.
        const restarted = replaced.error === "too-many-attempts" || replaced.error === "expired";
        return loadTotpReplace(c, options, { fieldError: restarted ? TOTP_REPLACE_RESTARTED : TOTP_ENROL_REFUSAL, status: 422 });
      }
      services.notices.send(identity.email, { type: "factor-replaced", factorKind: kind, at });
      return createAuthRedirect(c, account.totp());
    },
  };
}

async function recoveryCodeHolder<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
): Promise<Result<{ readonly identity: AuthIdentity; readonly service: EnrollableFactorService }, Response>> {
  const services = await authServices(c, options);
  const { auth, account } = options.paths;
  const identity = resolveAuthViewer(c);
  if (identity === null) return err(createAuthRedirect(c, auth.signin()));
  const offered = authEnrollable(services, "recovery-code");
  if (!offered.ok) return err(offered.error);

  const standing = await resolveRecoveryStanding(services, identity.userId);
  if (standing === null) return err(unavailable());
  if (!standing.recoverable) return err(new Response(RECOVERY_CODES_UNOWED, { status: 409 }));

  const detour = authStaleStepUpDetour(c, options, identity, account.recoveryCodes());
  return detour === null ? ok({ identity, service: offered.data }) : err(detour);
}

/** The POSTs that stage a new set of recovery codes and confirm it by one of its codes. @public */
export function createRecoveryCodeActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly recoveryCodesGenerate: RequestHandler;
  readonly recoveryCodesConfirm: RequestHandler;
} {
  return {
    recoveryCodesGenerate: async (context) => {
      const c = getAppContext<Bindings>(context);
      const holder = await recoveryCodeHolder(c, options);
      if (!holder.ok) return holder.error;

      const begun = await holder.data.service.beginEnrolment(holder.data.identity.userId, authNow(options));
      if (!begun.ok) return unavailable();
      const issued = begun.data.options?.codes;
      if (!Array.isArray(issued)) return unavailable();
      return loadRecoveryCodes(c, options, { issuedCodes: issued.filter((code): code is string => typeof code === "string") });
    },

    recoveryCodesConfirm: async (context) => {
      const c = getAppContext<Bindings>(context);
      const holder = await recoveryCodeHolder(c, options);
      if (!holder.ok) return holder.error;

      const parsed = await readAuthSubmission(c, authVerifySchema("recovery-code"));
      if (!parsed.ok) {
        const fieldError = parsed.error.cause === "too-large" ? parsed.error.message : RECOVERY_CODE_REFUSAL;
        return loadRecoveryCodes(c, options, { fieldError, status: parsed.error.status });
      }
      const caller = await authFactorCaller(sessionCtx.get(c, NO_SESSION));
      const at = authNow(options);
      const confirmed = await holder.data.service.completeEnrolment(holder.data.identity.userId, parsed.data.code, at, caller);
      if (!confirmed.ok) return loadRecoveryCodes(c, options, { fieldError: RECOVERY_CODE_REFUSAL, status: 422 });
      const services = await authServices(c, options);
      services.notices.send(holder.data.identity.email, { type: "recovery-codes-issued", factorKind: "recovery-code", at });
      return createAuthRedirect(c, authReturnPath(c, options));
    },
  };
}

/** The POSTs that sign one other session out, and every other session at once. @public */
export function createSessionActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly sessionRevoke: RequestHandler;
  readonly sessionsRevokeOthers: RequestHandler;
} {
  return {
    sessionRevoke: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());

      const parsed = await readAuthSubmission(c, authSessionRevokeSchema());
      if (!parsed.ok) return loadAccountSessions(c, options, { status: parsed.error.status });

      const origin = await authWriteOrigin(sessionCtx.get(c, NO_SESSION));
      const revoked = await services.sessions.revoke(identity.userId, parsed.data.session, authNow(options), origin);
      if (!revoked.ok) return unavailable();
      if (!revoked.data) return notFound();
      return createAuthRedirect(c, options.paths.account.sessions());
    },

    sessionsRevokeOthers: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());

      const revoked = await revokeOtherAuthSessions(sessionCtx.get(c, NO_SESSION), services.sessions, identity.userId, authNow(options));
      if (!revoked.ok) return unavailable();
      return createAuthRedirect(c, options.paths.account.sessions());
    },
  };
}

/** The POST that asks for an address change, which is answered by a link rather than by a page. @public */
export function createEmailChangeActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly emailChangeSubmit: RequestHandler } {
  return {
    emailChangeSubmit: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());

      const parsed = await readAuthSubmission(c, authEmailChangeSchema());
      if (!parsed.ok)
        return loadEmailChange(c, options, { email: parsed.error.values.email, fieldError: parsed.error.message, status: parsed.error.status });

      const requested = await services.emailChange.request(identity.userId, parsed.data.email, authNow(options));
      if (!requested.ok) {
        const notice = requested.error === "too-soon" ? EMAIL_CHANGE_TOO_SOON_NOTICE : EMAIL_CHANGE_NOTICE;
        return loadEmailChange(c, options, { email: parsed.data.email, error: notice, status: 422 });
      }
      return loadEmailChange(c, options, { sentTo: requested.data.sentTo });
    },
  };
}

function adminRefusalStatus(outcome: AdminUserOutcome): number | undefined {
  if (outcome === "changed" || outcome === "unchanged") return undefined;
  if (outcome === "not-found") return 404;
  // `self` is the actor asking to be locked out of the console they are standing in — a refusal of
  // what was asked, like the last-admin guards, and not a permission they lack.
  return 409;
}

/** The role, status, deletion and factor-reset writes of one administered account. @public */
export function createAdminUserActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly update: RequestHandler;
  readonly remove: RequestHandler;
  readonly resetFactors: RequestHandler;
} {
  return {
    update: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const id = c.params.id;
      if (id === undefined) return notFound();

      const viewer = resolveAuthViewer(c);
      if (viewer === null) return createAuthRedirect(c, options.paths.auth.signin());
      // The role is judged here and not left to the group's `require-admin`: that guard runs on the
      // loader this handler redirects to, which is after the write it was meant to refuse has landed.
      if (!viewer.isAdmin) return forbidden(c);

      const parsed = await readAuthSubmission(c, authAdminUserSchema());
      if (!parsed.ok) return loadAdminUserEdit(c, options, { fieldError: parsed.error.message, status: parsed.error.status });

      const found = await services.admin.view(id);
      if (!found.ok) return unavailable();
      if (found.data === null) return loadAdminUserEdit(c, options, { outcome: "not-found", status: 404 });

      const at = authNow(options);
      let outcome: AdminUserOutcome = "changed";
      const wantsAdmin = parsed.data.role === "admin";
      if (wantsAdmin !== found.data.isAdmin) {
        // Dropping your own role locks you out of the console mid-request, and the last-admin guard
        // admits it wherever a second admin exists.
        if (!wantsAdmin && viewer?.userId === found.data.id) {
          return loadAdminUserEdit(c, options, { outcome: "self", status: adminRefusalStatus("self") });
        }
        const written = wantsAdmin ? await services.admin.elevate(id, at, viewer.userId) : await services.admin.demote(id, at, viewer.userId);
        if (!written.ok) return unavailable();
        outcome = written.data;
        if (outcome === "changed") {
          services.notices.send(found.data.email, { type: wantsAdmin ? "admin-granted" : "admin-revoked", factorKind: null, at });
        }
      }

      const wantsActive = parsed.data.status === "active";
      if ((outcome === "changed" || outcome === "unchanged") && wantsActive !== (found.data.deactivatedAt === null)) {
        // Deactivating your own account signs you out of the console you are standing in, and the
        // last-admin guard does not catch it: a deployment with two admins would admit it.
        if (!wantsActive && viewer?.userId === found.data.id) {
          return loadAdminUserEdit(c, options, { outcome: "self", status: adminRefusalStatus("self") });
        }
        const written = wantsActive
          ? await services.admin.reactivate(id, at, viewer.userId)
          : await services.admin.deactivate(id, at, viewer.userId);
        if (!written.ok) return unavailable();
        outcome = written.data;
        if (outcome === "changed") {
          services.notices.send(found.data.email, { type: wantsActive ? "account-reactivated" : "account-deactivated", factorKind: null, at });
        }
      }

      return loadAdminUserEdit(c, options, { outcome, status: adminRefusalStatus(outcome) });
    },

    remove: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const id = c.params.id;
      if (id === undefined) return notFound();

      const viewer = resolveAuthViewer(c);
      if (viewer === null) return createAuthRedirect(c, options.paths.auth.signin());
      if (!viewer.isAdmin) return forbidden(c);

      // The loaded row is compared and not the route parameter: a UUID is case-insensitive, so an
      // uppercased one names the same account and would slip the deactivation guard's irreversible twin.
      const found = await services.admin.view(id);
      if (!found.ok) return unavailable();
      if (found.data === null) return loadAdminUserEdit(c, options, { outcome: "not-found", status: 404 });
      if (viewer.userId === found.data.id) return loadAdminUserEdit(c, options, { outcome: "self", status: adminRefusalStatus("self") });

      const removed = await services.admin.remove(id);
      if (!removed.ok) return unavailable();
      if (removed.data === "changed") return createAuthRedirect(c, options.paths.admin.users.list());
      return loadAdminUserEdit(c, options, { outcome: removed.data, status: adminRefusalStatus(removed.data) });
    },

    resetFactors: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const id = c.params.id;
      if (id === undefined) return notFound();

      const viewer = resolveAuthViewer(c);
      if (viewer === null) return createAuthRedirect(c, options.paths.auth.signin());
      if (!viewer.isAdmin) return forbidden(c);

      const found = await services.admin.view(id);
      if (!found.ok) return unavailable();
      if (found.data === null) return loadAdminUserEdit(c, options, { outcome: "not-found", status: 404 });
      if (viewer.userId === found.data.id) return loadAdminUserEdit(c, options, { outcome: "self", status: adminRefusalStatus("self") });

      const at = authNow(options);
      const reset = await services.admin.resetFactors(found.data.id, at, viewer.userId);
      if (!reset.ok) return unavailable();
      if (reset.data === "changed") {
        services.notices.send(found.data.email, { type: "factors-reset", factorKind: null, at });
        return createAuthRedirect(c, options.paths.admin.users.factors({ id: found.data.id }));
      }
      return loadAdminUserEdit(c, options, { outcome: reset.data, status: adminRefusalStatus(reset.data) });
    },
  };
}

/** The POST that claims the administrator role while a deployment still has none. @public */
export function createAdminElevateActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly submit: RequestHandler } {
  return {
    submit: async (context) => {
      const c = getAppContext<Bindings>(context);
      if (approvalCtx.getOptional(c) === undefined) return notFound();
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());

      const parsed = await readAuthSubmission(c, authAdminElevateSchema());
      if (!parsed.ok) return loadAdminElevate(c, options, { status: parsed.error.status });

      const minted = await mintAuthSessionRotation(sessionCtx.get(c, NO_SESSION));
      if (minted === null) return createAuthRedirect(c, options.paths.auth.signin());
      const at = authNow(options);
      const claimed = await services.admin.claimFirst(identity.userId, at, minted.rotation);
      if (!claimed.ok) return unavailable();
      if (claimed.data === "changed") {
        services.notices.send(identity.email, { type: "admin-granted", factorKind: null, at });
        minted.apply();
        return createAuthRedirect(c, options.paths.admin.users.list());
      }
      if (claimed.data === "not-found") return unavailable();
      return loadAdminElevate(c, options, { status: 409 });
    },
  };
}
