import type { Session } from "@remix-run/session";

import { getAppContext } from "../../context/types";
import type { AppContext, RequestHandler } from "../../context/types";
import { timingSafeEqual } from "../../crypto/timing";
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
import { AUTH_FRESH_STEP_UP_MS } from "../config";
import { authFactorContext } from "../factors/registry";
import type { EnrollableFactorService } from "../factors/types";
import { redactSigninReason } from "../flows/signin";
import type { AuthSigninNotice } from "../flows/types";
import type { AdminUserOutcome, AuthFactorKind } from "../types";
import {
  clearAuthSession,
  establishAuthSession,
  markAuthSigninPending,
  markAuthStepUp,
  renewAuthSession,
  resolveAuthSigninPending,
} from "./identity";
import {
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
  loadVerify,
} from "./loaders";
import { authEnrollable, authNow, authReturnPath, authReturnQuery, authServices, authSettledPath } from "./options";
import { AUTH_RESENT_PARAM, authEnrolTarget, authEnrolmentPaths, authWithQuery } from "./paths";
import { createAuthRedirect } from "./redirect";
import {
  authAfterEnrolTarget,
  authAfterStepUpTarget,
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
  authSigninSchema,
  authSignupSchema,
  authTotpEnrolSchema,
  authVerifySchema,
} from "./schemas";
import type { AuthIdentity } from "./types";
import type { AuthPageState, AuthRequestSurface, AuthWebOptions } from "./types";

const NO_SESSION =
  "auth/web action: no session on this request — mount `sessionMiddleware` before the auth routes, or a sign-in writes an identity nothing can read back.";

/** Copy for a refusal about the whole attempt, one per notice the sign-in flow may fold a reason to. */
const SIGNIN_NOTICE: Readonly<Record<AuthSigninNotice, string>> = {
  throttled: "Too many attempts. Wait a while before asking for another code.",
  unavailable: "We could not reach the sign-in service. Please try again in a moment.",
  unrecognised: "That did not match. Ask for a new code and try again.",
  unusable: "This sign-in method can't be checked right now. Choose another method below.",
};

/** Copy for a refused field, since `describeValidationIssue` returns a field name and no wording. */
const FIELD_REFUSAL: Readonly<Record<string, string>> = {
  email: "Enter an email address in the form name@example.com.",
  code: "That code is not the shape we sent. Enter the digits exactly as they appear.",
  label: "Use a shorter name for this passkey.",
  confirm: "Confirm the claim before submitting it.",
  role: "Pick a role from the list.",
  secret: "That is not the bootstrap secret this deployment was configured with.",
  status: "Pick a status from the list.",
};

const FIELD_REFUSAL_DEFAULT = "We could not read that. Please check the form and try again.";

const RECOVERY_CODE_REFUSAL = "That is not one of the new codes. Enter one exactly as it is shown.";

const RECOVERY_CODE_UNREADABLE = "That is not a recovery code. Enter one exactly as you saved it.";

const RECOVERY_CODES_UNOWED = "Recovery codes are issued only to an account holding an authenticator app or a passkey.";

const EMAIL_CHANGE_NOTICE = "We could not start that change. Check the address and try again.";

const CEREMONY_REFUSED = "The passkey was not accepted.";

const CEREMONY_UNAVAILABLE = "The passkey service is unavailable.";

const CEREMONY_TOO_LARGE = "That request was too large.";

function unavailable(): Response {
  return new Response("Service Unavailable", { status: 503 });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

/** Why a submission never reached the domain, in the words the page that re-renders it will show. */
interface AuthSubmissionRefusal {
  readonly field: string;
  readonly message: string;
  /** Every string field the visitor sent, so a re-render keeps what they typed. */
  readonly values: Readonly<Record<string, string>>;
}

/** The submitted body, or the refusal the page re-renders with. */
async function readAuthSubmission<schema extends v.GenericSchema, Bindings>(
  c: AppContext<Bindings>,
  schema: schema,
): Promise<Result<v.InferOutput<schema>, AuthSubmissionRefusal>> {
  let form: ReadonlyFormData;
  try {
    form = await parseFormData(c);
  } catch (error) {
    // The only throw here that is not about the submission: a field refusal would blame the visitor.
    if (isFormCapConflict(error)) throw error;
    return err({ field: "", message: FIELD_REFUSAL_DEFAULT, values: {} });
  }
  const csrfField = csrfFieldCtx.getOptional(c);
  const body = formToObject(form, csrfField === undefined ? {} : { drop: new Set([csrfField]) });
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(body)) {
    if (typeof value === "string") values[name] = value;
  }

  const parsed = v.safeParse(schema, body, { abortEarly: true });
  if (parsed.success) return ok(parsed.output);
  const field = parsed.issues[0] === undefined ? "" : describeValidationIssue(parsed.issues[0]);
  return err({ field, message: refusalFor(schema, field), values });
}

/** The copy for a refused field the schema declares; any other name is the visitor's own, and earns the default. */
function refusalFor(schema: v.GenericSchema, field: string): string {
  const entries: unknown = "entries" in schema ? schema.entries : undefined;
  const declared = typeof entries === "object" && entries !== null && Object.hasOwn(entries, field);
  return declared && Object.hasOwn(FIELD_REFUSAL, field) ? (FIELD_REFUSAL[field] ?? FIELD_REFUSAL_DEFAULT) : FIELD_REFUSAL_DEFAULT;
}

// Held to the schema the rename path holds a label to, so one field cannot be bounded on one route
// and unbounded on another.
/** The enrolment nickname, or the refusal an over-long one earns. */
function readEnrolmentNickname(presented: unknown): Result<string | null, undefined> {
  if (presented === undefined || presented === null) return ok(null);
  if (typeof presented !== "string") return err(undefined);
  const parsed = v.safeParse(authPasskeyLabelSchema(), { label: presented }, { abortEarly: true });
  return parsed.success ? ok(parsed.output.label) : err(undefined);
}

// A WebAuthn ceremony envelope is a few kilobytes; 64 KiB is generous for one and still a bound.
// Without it these three endpoints read whatever a client cared to send, into a Worker's memory.
/** The largest ceremony envelope a JSON endpoint reads before it answers 413. @internal */
export const AUTH_CEREMONY_MAX_BYTES = 65_536;

/** What reading a ceremony body produced: the parsed JSON, or the refusal the endpoint owes. */
type CeremonyBody = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly response: Response };

// The stages `parseFormData` proves: refuse on a `Content-Length` that already says too much,
// then meter the stream, because a chunked body's header may be absent or lying.
/** The JSON body a ceremony endpoint was posted, capped at `AUTH_CEREMONY_MAX_BYTES`. */
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
    // Malformed JSON is its own refusal, not an absent body: reporting them alike would answer a
    // truncated envelope with the same 400 a client reads as "send the credential again".
    if (overflowed) return { ok: false, response: jsonResponse({ error: CEREMONY_TOO_LARGE }, 413) };
    return { ok: false, response: jsonResponse({ error: CEREMONY_REFUSED }, 400) };
  }
}

// The resolution's own `kinds` and never a fixed page: under a policy offering the authenticator app
// and no passkey, the passkey page is one this deployment does not serve.
/** The enrolment page an owed `kinds` is cleared on, or the settled path when forge mounts none for any of them. */
function enrolTarget<Bindings>(options: AuthWebOptions<Bindings>, kinds: readonly AuthFactorKind[]): string {
  return authEnrolTarget(authEnrolmentPaths(options.paths.auth), kinds) ?? authSettledPath(options);
}

/** Where a sign-in that has just been established sends the visitor next. */
async function signedInTarget<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  userId: string,
  isAdmin: boolean,
): Promise<string> {
  const services = await authServices(c, options);
  const resolved = await services.factors.resolve(userId, authFactorContext({ isAdmin }));
  if (!resolved.ok) return authSettledPath(options);
  if (resolved.data.status === "enrolment-required" && resolved.data.stepUpKinds.length === 0) return enrolTarget(options, resolved.data.kinds);
  if (resolved.data.status !== "satisfied") return options.paths.auth.verify.show();
  return authReturnPath(c, options);
}

/** The POST that starts a sign-in, challenging the deployment's primary factor. @public */
export function createSigninActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly signinSubmit: RequestHandler } {
  return {
    signinSubmit: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);

      const parsed = await readAuthSubmission(c, authSigninSchema());
      if (!parsed.ok) return loadSignin(c, options, { email: parsed.error.values.email, fieldError: parsed.error.message, status: 422 });

      // The address is on the session and not in the redirect: `complete` needs it back, and a query
      // parameter carrying it lands in browser history, `Referer` and every proxy log on the way.
      services.signin.request(parsed.data.email, authNow(options));
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

      const parsed = await readAuthSubmission(c, authSignupSchema());
      if (!parsed.ok) return loadSignup(c, options, { email: parsed.error.values.email, fieldError: parsed.error.message, status: 422 });

      services.signup.request(parsed.data.email, authNow(options));
      markAuthSigninPending(session, parsed.data.email);
      return createAuthRedirect(c, authReturnQuery(c, options, options.paths.auth.verify.show()));
    },
  };
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

      // The demand is resolved first: the schema's width is the presented factor's own, so a
      // deployment configuring a wider code cannot have its page refuse every correct one.
      const demand = await resolveAuthVerifyDemand(c, services);
      // Before the body is even read: a session owing an enrolment cannot step up, so accepting a
      // code here would spend an attempt on a comparison `signin.stepUp` refuses to make.
      const detour = authVerifyDetour(c, options, demand);
      if (detour !== null) return detour;

      const parsed = await readAuthSubmission(c, authVerifySchema(demand.factor, demand.digits ?? undefined));
      if (!parsed.ok) {
        const fieldError = demand.factor === "recovery-code" ? RECOVERY_CODE_UNREADABLE : parsed.error.message;
        return loadVerify(c, options, { fieldError, status: 422 });
      }

      if (demand.identity !== null) {
        const stepped = await services.signin.stepUp(demand.identity.userId, demand.factor, parsed.data.code, at);
        if (!stepped.ok) {
          if (stepped.error === "unusable") requestLog.getOptional(c)?.warn("auth.factor.unusable", { kind: demand.factor });
          return loadVerify(c, options, { error: SIGNIN_NOTICE[redactSigninReason(stepped.error)], status: 422 });
        }
        // The only place a step-up is ever recorded: every other outcome leaves the mark alone.
        markAuthStepUp(session, at, authNow(options));
        const target = await authAfterStepUpTarget(c, options, demand.identity, demand.factor, authReturnPath(c, options));
        return createAuthRedirect(c, target);
      }

      const pending = resolveAuthSigninPending(session);
      if (pending === null) return createAuthRedirect(c, options.paths.auth.signin());

      const completed = await services.signin.complete(pending, parsed.data.code, at);
      if (!completed.ok) {
        return loadVerify(c, options, { email: pending, error: SIGNIN_NOTICE[redactSigninReason(completed.error)], status: 422 });
      }

      establishAuthSession(session, completed.data.user.id, at, authNow(options));
      const resolution = completed.data.resolution;
      // A successful outcome of a correct sign-in, not a refusal of one: the visitor proved the
      // primary factor and owes an enrolment, which is a page to visit — carrying the return-to on.
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
      // Whether a code was actually issued is what a visitor may not learn: only a real account can
      // be inside the reissue window, so reporting it would bin an address list.
      const verifyPath = authReturnQuery(c, options, options.paths.auth.verify.show());
      const resent = `${verifyPath}${verifyPath.includes("?") ? "&" : "?"}${AUTH_RESENT_PARAM}`;
      const demand = await resolveAuthVerifyDemand(c, services);
      const detour = authVerifyDetour(c, options, demand);
      if (detour !== null) return detour;

      if (demand.identity !== null) {
        await services.signin.requestStepUp(demand.identity.userId, demand.factor, at);
        return createAuthRedirect(c, resent);
      }

      const pending = resolveAuthSigninPending(session);
      if (pending === null) return createAuthRedirect(c, options.paths.auth.signin());
      // Synchronous by design: `request` reads nothing about the address before returning, so a
      // registered one and an unknown one differ in neither shape nor time. There is nothing to await.
      services.signin.request(pending, at);
      return createAuthRedirect(c, resent);
    },
  };
}

/** The POST that ends a session, rotating its id on the way out. @public */
export function createSignoutActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly signout: RequestHandler } {
  return {
    signout: (context) => {
      const c = getAppContext<Bindings>(context);
      clearAuthSession(sessionCtx.get(c, NO_SESSION));
      return createAuthRedirect(c, options.paths.auth.signin());
    },
  };
}

// The challenge is bound to the session's own `userId`, which `createPasskeyFactor.verifyChallenge`
// re-checks against the assertion before it admits anything.
/** The two JSON endpoints of a passkey step-up, held against the session that is already signed in. @public */
export function createPasskeyStepUpActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly begin: RequestHandler;
  readonly finish: RequestHandler;
} {
  const kind: AuthFactorKind = "passkey";

  return {
    begin: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      const service = services.factors.find(kind);
      if (identity === null || service === undefined) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      const challenge = await service.createChallenge(identity.userId, authNow(options));
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

      const verified = await service.verifyChallenge(identity.userId, JSON.stringify(body.credential), at);
      if (!verified.ok) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      markAuthStepUp(session, at, authNow(options));
      return jsonResponse({ redirect: await authAfterStepUpTarget(c, options, identity, kind, authReturnPath(c, options)) });
    },
  };
}

/** The two JSON endpoints of the passkey enrolment ceremony. @public */
export function createPasskeyEnrolActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly begin: RequestHandler;
  readonly finish: RequestHandler;
} {
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
      const held = await enrolmentService(c, services);
      if (held === null) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      const read = await readCeremonyBody(c);
      if (!read.ok) return read.response;
      const body = read.body as { credential?: unknown; nickname?: unknown } | null;
      const credential = body?.credential;
      if (credential === undefined || credential === null) return jsonResponse({ error: CEREMONY_REFUSED }, 400);

      // The same cap the rename path holds a label to. Without it a name typed at enrolment reached
      // `credentials.create` on a trim alone, where the same field renamed later is bounded at 64.
      const nickname = readEnrolmentNickname(body?.nickname);
      if (!nickname.ok) return jsonResponse({ error: CEREMONY_REFUSED }, 400);

      // The whole envelope, not the credential alone: the name the visitor typed is passkey-specific,
      // so it rides in this factor's opaque payload rather than in a parameter every factor carries.
      const envelope = JSON.stringify({ credential, nickname: nickname.data });
      const completed = await held.service.completeEnrolment(held.identity.userId, envelope, authNow(options));
      if (!completed.ok) return jsonResponse({ error: CEREMONY_REFUSED }, 400);
      return jsonResponse({ redirect: await authAfterEnrolTarget(c, options, held.identity, "passkey", authSettledPath(options)) });
    },
  };
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
      if (!parsed.ok) return loadPasskeyEdit(c, options, { fieldError: parsed.error.message, status: 422 });

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

      const removed = await services.credentials.removeForUser(id, identity.userId);
      if (!removed.ok) return unavailable();
      if (!removed.data) return notFound();
      // Taking a credential away is what a visitor does when they think it is no longer theirs, so
      // it has to reach the sessions it may already have signed in — which this request cannot see.
      const revoked = await revokeOtherSessions(services, session, identity.userId, authNow(options));
      if (!revoked) return unavailable();
      return loadPasskeyList(c, options);
    },
  };
}

// The barrier refuses every session established at or before it, this one included, so the acting
// session is re-stamped past it: the visitor stays where they are and every other device does not.
/** Raises this account's revocation barrier and carries the acting session over it. */
async function revokeOtherSessions(services: AuthRequestSurface, session: Session, userId: string, at: number): Promise<boolean> {
  const revoked = await services.users.revokeSessions(userId, at);
  if (!revoked.ok) return false;
  renewAuthSession(session, at, at);
  return true;
}

/** How a refused confirmation re-renders — the page it was posted from, which differs by mount. */
type AuthPageReload<Bindings> = (c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state?: AuthPageState) => Promise<Response>;

const TOTP_KIND: AuthFactorKind = "totp-app";

/** The code the visitor typed, confirmed against their authenticator-app enrolment, or the answer the page owes them. */
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
  if (!parsed.ok) return err(await reload(c, options, { fieldError: parsed.error.message, status: 422 }));

  const confirmed = await service.completeEnrolment(identity.userId, parsed.data.code, authNow(options));
  if (!confirmed.ok) return err(await reload(c, options, { fieldError: FIELD_REFUSAL.code ?? FIELD_REFUSAL_DEFAULT, status: 422 }));
  return ok(identity);
}

// The enrolment group's mount, outside `account`, which `require-enrolment` refuses precisely while
// the enrolment is owed — so this is the only POST an owed authenticator-app enrolment can clear.
/** The POST that confirms the authenticator-app enrolment a sign-in still owes. @public */
export function createTotpEnrolActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly totpEnrol: RequestHandler } {
  return {
    totpEnrol: async (context) => {
      const c = getAppContext<Bindings>(context);
      const confirmed = await confirmTotp(c, options, loadEnrolTotp);
      if (!confirmed.ok) return confirmed.error;

      // Whatever the policy demands now the factor is confirmed — the step-up it was enrolled for —
      // rather than the account page, which the enrolment guard would only bounce back.
      const target = await signedInTarget(c, options, confirmed.data.userId, confirmed.data.isAdmin);
      return createAuthRedirect(c, target);
    },
  };
}

/** The confirmation and removal of an authenticator-app enrolment from the account pages. @public */
export function createTotpManageActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly totpEnrol: RequestHandler;
  readonly totpRemove: RequestHandler;
} {
  const kind = TOTP_KIND;

  return {
    totpEnrol: async (context) => {
      const c = getAppContext<Bindings>(context);
      const confirmed = await confirmTotp(c, options, loadTotpEnrol);
      if (!confirmed.ok) return confirmed.error;
      const target = await authAfterStepUpTarget(c, options, confirmed.data, kind, options.paths.account.totp());
      return createAuthRedirect(c, target);
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
      for (const factor of held.data) {
        const dropped = await services.enrolments.remove(factor.id, identity.userId);
        if (!dropped.ok) return unavailable();
      }
      // Same reasoning as removing a passkey: a factor taken away must not leave a session that was
      // admitted on the strength of it standing on another device.
      const revoked = await revokeOtherSessions(services, sessionCtx.get(c, NO_SESSION), identity.userId, authNow(options));
      if (!revoked) return unavailable();
      return createAuthRedirect(c, options.paths.account.totp());
    },
  };
}

// Checked here and not left to `require-fresh-step-up`: that guard admits a user the policy owes no
// step-up, and issuing codes on email alone would let a mailbox mint a way past the second factor.
/** The identity allowed to be issued recovery codes now, with the factor issuing them, or the answer a request without that standing gets. */
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

  const age = authNow(options) - (identity.stepUpAt ?? Number.NEGATIVE_INFINITY);
  if (age < 0 || age >= AUTH_FRESH_STEP_UP_MS) {
    const verify = authWithQuery(auth.verify.show(), options.returnParam ?? "next", account.recoveryCodes());
    return err(createAuthRedirect(c, verify));
  }
  return ok({ identity, service: offered.data });
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
      if (!parsed.ok) return loadRecoveryCodes(c, options, { fieldError: RECOVERY_CODE_REFUSAL, status: 422 });
      const confirmed = await holder.data.service.completeEnrolment(holder.data.identity.userId, parsed.data.code, authNow(options));
      if (!confirmed.ok) return loadRecoveryCodes(c, options, { fieldError: RECOVERY_CODE_REFUSAL, status: 422 });
      return createAuthRedirect(c, authReturnPath(c, options));
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
      if (!parsed.ok) return loadEmailChange(c, options, { email: parsed.error.values.email, fieldError: parsed.error.message, status: 422 });

      const requested = await services.emailChange.request(identity.userId, parsed.data.email, authNow(options));
      if (!requested.ok) return loadEmailChange(c, options, { email: parsed.data.email, error: EMAIL_CHANGE_NOTICE, status: 422 });
      return loadEmailChange(c, options, { sentTo: requested.data.sentTo });
    },
  };
}

/** The status a refused administrative write answers with, by the guard that refused it. */
function adminRefusalStatus(outcome: AdminUserOutcome): number | undefined {
  if (outcome === "changed") return undefined;
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

      // Unlike the last-admin guard this needs no in-statement race protection: the acting
      // administrator is fixed for this request, so no concurrent write can change who they are.
      const viewer = resolveAuthViewer(c);
      if (viewer === null) return createAuthRedirect(c, options.paths.auth.signin());
      // The role is judged here and not left to the group's `require-admin`: that guard runs on the
      // loader this handler redirects to, which is after the write it was meant to refuse has landed.
      if (!viewer.isAdmin) return forbidden();

      const parsed = await readAuthSubmission(c, authAdminUserSchema());
      if (!parsed.ok) return loadAdminUserEdit(c, options, { fieldError: parsed.error.message, status: 422 });

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
        const written = wantsAdmin ? await services.admin.elevate(id, at) : await services.admin.demote(id, at);
        if (!written.ok) return unavailable();
        outcome = written.data;
      }

      const wantsActive = parsed.data.status === "active";
      if (outcome === "changed" && wantsActive !== (found.data.deactivatedAt === null)) {
        // Deactivating your own account signs you out of the console you are standing in, and the
        // last-admin guard does not catch it: a deployment with two admins would admit it.
        if (!wantsActive && viewer?.userId === found.data.id) {
          return loadAdminUserEdit(c, options, { outcome: "self", status: adminRefusalStatus("self") });
        }
        const written = wantsActive ? await services.admin.reactivate(id, at) : await services.admin.deactivate(id, at);
        if (!written.ok) return unavailable();
        outcome = written.data;
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
      if (!viewer.isAdmin) return forbidden();

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
      if (!viewer.isAdmin) return forbidden();

      const found = await services.admin.view(id);
      if (!found.ok) return unavailable();
      if (found.data === null) return loadAdminUserEdit(c, options, { outcome: "not-found", status: 404 });
      if (viewer.userId === found.data.id) return loadAdminUserEdit(c, options, { outcome: "self", status: adminRefusalStatus("self") });

      const reset = await services.admin.resetFactors(found.data.id, authNow(options));
      if (!reset.ok) return unavailable();
      if (reset.data === "changed") return createAuthRedirect(c, options.paths.admin.users.factors({ id: found.data.id }));
      return loadAdminUserEdit(c, options, { outcome: reset.data, status: adminRefusalStatus(reset.data) });
    },
  };
}

/** The POST that claims the administrator role while a deployment still has none. @public */
export function createAdminElevateActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly submit: RequestHandler } {
  return {
    submit: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return createAuthRedirect(c, options.paths.auth.signin());

      // Fails closed: the claim grants the role to whoever posts first, so a deployment with no
      // configured secret has no claim endpoint rather than an open one.
      const expected = options.bootstrapSecret?.(c);
      if (expected === undefined || expected === "") return notFound();

      const parsed = await readAuthSubmission(c, authAdminElevateSchema());
      if (!parsed.ok) return loadAdminElevate(c, options, { fieldError: parsed.error.message, status: 422 });
      if (!timingSafeEqual(parsed.data.secret, expected)) {
        return loadAdminElevate(c, options, { fieldError: FIELD_REFUSAL.secret ?? FIELD_REFUSAL_DEFAULT, status: 422 });
      }

      const claimed = await services.admin.claimFirst(identity.userId, authNow(options));
      if (!claimed.ok) return unavailable();
      if (claimed.data === "changed") return createAuthRedirect(c, options.paths.admin.users.list());
      // A signed-in session naming a row that is gone; the claim page has nothing to say about it.
      if (claimed.data === "not-found") return unavailable();
      return loadAdminElevate(c, options, { status: 409 });
    },
  };
}
