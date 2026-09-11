import type { Session } from "@remix-run/session";

import { getAppContext } from "../../context/types";
import type { AppContext, RequestHandler } from "../../context/types";
import { csrfFieldCtx } from "../../form/csrf-context";
import { parseFormData } from "../../form/parse-form-data";
import { formToObject } from "../../form/to-object";
import type { ReadonlyFormData } from "../../form/types";
import { jsonResponse, redirect } from "../../http/response";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { sessionCtx } from "../../session/session";
import { describeValidationIssue, v } from "../../validation/mod";
import { authFactorContext } from "../factors/registry";
import { redactSigninReason } from "../flows/signin";
import type { AuthSigninNotice } from "../flows/types";
import { verifyPasskeyAuthentication } from "../passkey/authenticate";
import { createPasskeyRequestOptions } from "../passkey/options";
import type { PasskeyAssertionCredential } from "../passkey/types";
import type { PasskeyCeremonyOptions } from "../passkey/types";
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
  loadSignin,
  loadSignup,
  loadTotpEnrol,
  loadVerify,
} from "./loaders";
import { authEnrollable, authNow, authReturnPath, authServices, authSettledPath } from "./options";
import { AUTH_RESENT_PARAM, authEnrolTarget, authEnrolmentPaths } from "./paths";
import { authVerifyDetour, resolveAuthVerifyDemand, resolveAuthViewer } from "./resolve";
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
import type { AuthPageState, AuthRequestServices, AuthWebOptions } from "./types";

const NO_SESSION =
  "auth/web action: no session on this request — mount `sessionMiddleware` before the auth routes, or a sign-in writes an identity nothing can read back.";

const REDIRECT_STATUS = 303;

/** Copy for a refusal about the whole attempt, one per notice the sign-in flow may fold a reason to. */
const SIGNIN_NOTICE: Readonly<Record<AuthSigninNotice, string>> = {
  throttled: "Too many attempts. Wait a while before asking for another code.",
  unavailable: "We could not reach the sign-in service. Please try again in a moment.",
  unrecognised: "That did not match. Ask for a new code and try again.",
};

/** Copy for a refused field, since `describeValidationIssue` returns a field name and no wording. */
const FIELD_REFUSAL: Readonly<Record<string, string>> = {
  email: "Enter an email address in the form name@example.com.",
  code: "That code is not the shape we sent. Enter the digits exactly as they appear.",
  label: "Use a shorter name for this passkey.",
  confirm: "Confirm the claim before submitting it.",
  role: "Pick a role from the list.",
  status: "Pick a status from the list.",
};

const FIELD_REFUSAL_DEFAULT = "We could not read that. Please check the form and try again.";

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
  } catch {
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
  return err({ field, message: FIELD_REFUSAL[field] ?? FIELD_REFUSAL_DEFAULT, values });
}

/** The ceremony configuration the discoverable sign-in runs against, assembled from this request's services. */
function passkeyCeremony(services: AuthRequestServices): PasskeyCeremonyOptions | undefined {
  const passkey = services.passkey;
  if (passkey === undefined) return undefined;
  return {
    rpId: passkey.rpId,
    rpName: passkey.rpName,
    challenges: passkey.challenges,
    credentials: services.credentials,
    ...(passkey.algorithms === undefined ? {} : { algorithms: passkey.algorithms }),
    ...(passkey.ttlSeconds === undefined ? {} : { ttlSeconds: passkey.ttlSeconds }),
    ...(passkey.userVerification === undefined ? {} : { userVerification: passkey.userVerification }),
  };
}

// Held to the schema the rename path holds a label to, so one field cannot be bounded on one route
// and unbounded on another. A missing nickname is a name the visitor declined to give, not a refusal.
/** The enrolment nickname, or the refusal an over-long one earns. */
function readEnrolmentNickname(presented: unknown): Result<string | null, undefined> {
  if (presented === undefined || presented === null) return ok(null);
  if (typeof presented !== "string") return err(undefined);
  const parsed = v.safeParse(authPasskeyLabelSchema(), { label: presented }, { abortEarly: true });
  return parsed.success ? ok(parsed.output.label) : err(undefined);
}

// A credential id is base64url of at most 1023 bytes (WebAuthn L3 §5.8.3), so 1400 characters is
// past every real one. Bounded and shaped here rather than at the index: an id of any length and any
// alphabet otherwise reaches `findByCredentialId` as a bind parameter on every unauthenticated POST.
const ASSERTION_ID_MAX = 1400;
const ASSERTION_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

/** The assertion a finished sign-in ceremony posted, or `null` when the body is not one. */
function readAssertion(body: unknown): PasskeyAssertionCredential | null {
  const credential = (body as { credential?: unknown } | null)?.credential as Record<string, unknown> | undefined;
  const response = credential?.response as Record<string, unknown> | undefined;
  if (typeof credential?.id !== "string" || response === undefined) return null;
  if (credential.id.length === 0 || credential.id.length > ASSERTION_ID_MAX || !ASSERTION_ID_SHAPE.test(credential.id)) return null;
  const { clientDataJSON, authenticatorData, signature, userHandle } = response;
  if (typeof clientDataJSON !== "string" || typeof authenticatorData !== "string" || typeof signature !== "string") return null;
  return {
    id: credential.id,
    response: { clientDataJSON, authenticatorData, signature, ...(typeof userHandle === "string" ? { userHandle } : {}) },
  };
}

// A WebAuthn ceremony envelope is a few kilobytes; 64 KiB is generous for one and still a bound.
// Without it these three endpoints read whatever a client cared to send, into a Worker's memory.
/** The largest ceremony envelope a JSON endpoint reads before it answers 413. @internal */
export const AUTH_CEREMONY_MAX_BYTES = 65_536;

/** What reading a ceremony body produced: the parsed JSON, or the refusal the endpoint owes. */
type CeremonyBody = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly response: Response };

// The two stages `parseFormData` proves: refuse on a `Content-Length` that already says too much,
// then meter the stream, because a chunked body's header may be absent or lying.
/** The JSON body a ceremony endpoint was posted, capped at `AUTH_CEREMONY_MAX_BYTES`. */
async function readCeremonyBody<Bindings>(c: AppContext<Bindings>): Promise<CeremonyBody> {
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
    return overflowed ? { ok: false, response: jsonResponse({ error: CEREMONY_TOO_LARGE }, 413) } : { ok: true, body: null };
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
  if (resolved.data.status === "enrolment-required") return enrolTarget(options, resolved.data.kinds);
  if (resolved.data.status === "step-up-required") return options.paths.auth.verify.show();
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
      return redirect(options.paths.auth.verify.show(), REDIRECT_STATUS);
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
      return redirect(options.paths.auth.verify.show(), REDIRECT_STATUS);
    },
  };
}

/** The two POSTs of the verification page: presenting the code, and asking for another. @public */
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

      const parsed = await readAuthSubmission(c, authVerifySchema(demand.digits ?? undefined));
      if (!parsed.ok) return loadVerify(c, options, { fieldError: parsed.error.message, status: 422 });

      if (demand.identity !== null) {
        const stepped = await services.signin.stepUp(demand.identity.userId, demand.factor, parsed.data.code, at);
        if (!stepped.ok) return loadVerify(c, options, { error: SIGNIN_NOTICE[redactSigninReason(stepped.error)], status: 422 });
        // The only place a step-up is ever recorded: every other outcome leaves the mark alone.
        markAuthStepUp(session, at);
        return redirect(authReturnPath(c, options), REDIRECT_STATUS);
      }

      const pending = resolveAuthSigninPending(session);
      if (pending === null) return redirect(options.paths.auth.signin(), REDIRECT_STATUS);

      const completed = await services.signin.complete(pending, parsed.data.code, at);
      if (!completed.ok) {
        return loadVerify(c, options, { email: pending, error: SIGNIN_NOTICE[redactSigninReason(completed.error)], status: 422 });
      }

      establishAuthSession(session, completed.data.user.id, at);
      const resolution = completed.data.resolution;
      // A successful outcome of a correct sign-in, not a refusal of one: the visitor proved the
      // primary factor and now owes an enrolment, which is a page to visit rather than a 4xx.
      if (resolution.status === "enrolment-required") return redirect(enrolTarget(options, resolution.kinds), REDIRECT_STATUS);
      if (resolution.status === "step-up-required") return redirect(options.paths.auth.verify.show(), REDIRECT_STATUS);
      return redirect(authReturnPath(c, options), REDIRECT_STATUS);
    },

    resend: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const at = authNow(options);
      // Both branches land on the same marked page whatever happened, because whether a code was
      // actually issued is precisely what a visitor may not learn: only a real account can be inside
      // the reissue window, so reporting that would bin an address list the sign-in flow refuses to.
      const resent = `${options.paths.auth.verify.show()}?${AUTH_RESENT_PARAM}`;
      const demand = await resolveAuthVerifyDemand(c, services);
      const detour = authVerifyDetour(c, options, demand);
      if (detour !== null) return detour;

      if (demand.identity !== null) {
        await services.signin.requestStepUp(demand.identity.userId, demand.factor, at);
        return redirect(resent, REDIRECT_STATUS);
      }

      const pending = resolveAuthSigninPending(session);
      if (pending === null) return redirect(options.paths.auth.signin(), REDIRECT_STATUS);
      // Synchronous by design: `request` reads nothing about the address before returning, so a
      // registered one and an unknown one differ in neither shape nor time. There is nothing to await.
      services.signin.request(pending, at);
      return redirect(resent, REDIRECT_STATUS);
    },
  };
}

/** The POST that ends a session, rotating its id on the way out. @public */
export function createSignoutActions<Bindings>(options: AuthWebOptions<Bindings>): { readonly signout: RequestHandler } {
  return {
    signout: (context) => {
      const c = getAppContext<Bindings>(context);
      clearAuthSession(sessionCtx.get(c, NO_SESSION));
      return redirect(options.paths.auth.signin(), REDIRECT_STATUS);
    },
  };
}

/** The two JSON endpoints of a discoverable passkey sign-in. @public */
export function createPasskeySigninActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly authenticateBegin: RequestHandler;
  readonly authenticateFinish: RequestHandler;
} {
  return {
    authenticateBegin: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const ceremony = passkeyCeremony(services);
      if (ceremony === undefined || services.passkey === undefined) return notFound();

      // No `userId`: the authenticator names the account, so an allow-list here would both break a
      // discoverable login and leak who is enrolled.
      const built = await createPasskeyRequestOptions(ceremony, { sessionId: services.passkey.sessionId });
      return built.ok ? jsonResponse(built.data) : jsonResponse({ error: CEREMONY_UNAVAILABLE }, 503);
    },

    authenticateFinish: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const session = sessionCtx.get(c, NO_SESSION);
      const passkey = services.passkey;
      if (passkey === undefined) return notFound();

      const read = await readCeremonyBody(c);
      if (!read.ok) return read.response;
      const credential = readAssertion(read.body);
      if (credential === null) return jsonResponse({ error: CEREMONY_REFUSED }, 400);

      const verified = await verifyPasskeyAuthentication(
        {
          rpId: passkey.rpId,
          origin: passkey.origin,
          challenges: passkey.challenges,
          credentials: services.credentials,
          users: services.users,
          ...(passkey.requireUserVerification === undefined ? {} : { requireUserVerification: passkey.requireUserVerification }),
        },
        { sessionId: passkey.sessionId, credential },
        authNow(options),
      );
      if (!verified.ok) return jsonResponse({ error: CEREMONY_REFUSED }, 401);

      establishAuthSession(session, verified.data.user.id, authNow(options));
      return jsonResponse({ redirect: await signedInTarget(c, options, verified.data.user.id, verified.data.user.isAdmin) });
    },
  };
}

// Its own pair, never `createPasskeySigninActions`: those run the *discoverable* login, which calls
// `establishAuthSession` and so clears the step-up mark this ceremony exists to write. The challenge
// is bound to the session's own `userId`, which `createPasskeyFactor.verifyChallenge` re-checks
// against the assertion before it admits anything.
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

      markAuthStepUp(session, at);
      return jsonResponse({ redirect: authReturnPath(c, options) });
    },
  };
}

/** The two JSON endpoints of the passkey enrolment ceremony. @public */
export function createPasskeyEnrolActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly begin: RequestHandler;
  readonly finish: RequestHandler;
} {
  async function enrolmentService(c: AppContext<Bindings>, services: AuthRequestServices) {
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
      return jsonResponse({ redirect: authSettledPath(options) });
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
      if (identity === null) return redirect(options.paths.auth.signin(), REDIRECT_STATUS);
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
      if (identity === null) return redirect(options.paths.auth.signin(), REDIRECT_STATUS);
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
async function revokeOtherSessions(services: AuthRequestServices, session: Session, userId: string, at: number): Promise<boolean> {
  const revoked = await services.users.revokeSessions(userId, at);
  if (!revoked.ok) return false;
  renewAuthSession(session, at);
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
  if (identity === null) return err(redirect(options.paths.auth.signin(), REDIRECT_STATUS));
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
      return redirect(target, REDIRECT_STATUS);
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
      return confirmed.ok ? redirect(options.paths.account.totp(), REDIRECT_STATUS) : confirmed.error;
    },

    totpRemove: async (context) => {
      const c = getAppContext<Bindings>(context);
      const services = await authServices(c, options);
      const identity = resolveAuthViewer(c);
      if (identity === null) return redirect(options.paths.auth.signin(), REDIRECT_STATUS);
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
      return redirect(options.paths.account.totp(), REDIRECT_STATUS);
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
      if (identity === null) return redirect(options.paths.auth.signin(), REDIRECT_STATUS);

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

/** The role, status and deletion writes of one administered account. @public */
export function createAdminUserActions<Bindings>(options: AuthWebOptions<Bindings>): {
  readonly update: RequestHandler;
  readonly remove: RequestHandler;
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
      const parsed = await readAuthSubmission(c, authAdminUserSchema());
      if (!parsed.ok) return loadAdminUserEdit(c, options, { fieldError: parsed.error.message, status: 422 });

      const found = await services.admin.view(id);
      if (!found.ok) return unavailable();
      if (found.data === null) return loadAdminUserEdit(c, options, { outcome: "not-found", status: 404 });

      const at = authNow(options);
      let outcome: AdminUserOutcome = "changed";
      const wantsAdmin = parsed.data.role === "admin";
      if (wantsAdmin !== found.data.isAdmin) {
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
      // Same reasoning as the deactivation above, and worse: this one is not reversible.
      if (resolveAuthViewer(c)?.userId === id) return loadAdminUserEdit(c, options, { outcome: "self", status: adminRefusalStatus("self") });

      const removed = await services.admin.remove(id);
      if (!removed.ok) return unavailable();
      if (removed.data === "changed") return redirect(options.paths.admin.users.list(), REDIRECT_STATUS);
      return loadAdminUserEdit(c, options, { outcome: removed.data, status: adminRefusalStatus(removed.data) });
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
      if (identity === null) return redirect(options.paths.auth.signin(), REDIRECT_STATUS);

      const parsed = await readAuthSubmission(c, authAdminElevateSchema());
      if (!parsed.ok) return loadAdminElevate(c, options, { fieldError: parsed.error.message, status: 422 });

      const counted = await services.admin.countAdmins();
      if (!counted.ok) return unavailable();
      // Re-read rather than trusted from the page: the claim is open to anyone signed in, so the
      // only thing standing between two visitors and two first admins is this check at write time.
      if (counted.data > 0) return loadAdminElevate(c, options, { status: 409 });

      const elevated = await services.admin.elevate(identity.userId, authNow(options));
      if (!elevated.ok) return unavailable();
      return redirect(options.paths.admin.users.list(), REDIRECT_STATUS);
    },
  };
}
