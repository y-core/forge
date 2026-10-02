import type { Middleware } from "@remix-run/fetch-router";
import { Route } from "@remix-run/fetch-router/routes";
import type { RouteMap } from "@remix-run/fetch-router/routes";

import type { MiddlewareGuardGroup } from "../../app/types";
import { contextVar } from "../../context/accessor";
import { getAppContext } from "../../context/types";
import { safeRedirectPath } from "../../http/redirect-path";
import { jsonResponse } from "../../http/response";
import { hxCurrentUrl } from "../../render/htmx/htmx-headers";
import { isHxRequest } from "../../render/htmx/hx-request";
import { sessionCtx } from "../../session/session";
import { AUTH_FRESH_STEP_UP_MS } from "../config";
import { authFactorContext } from "../factors/registry";
import type { AuthFactorResolution } from "../factors/types";
import { authLimit } from "../limits";
import type { AuthAccessToken, AuthFactorKind } from "../types";
import { authCtx, resolveAuthIdentity } from "./identity";
import { authEnrolTarget } from "./paths";
import { createAuthRedirect } from "./redirect";
import { AUTH_ROUTE_GROUPS } from "./routes";
import type { AccessTokenGuardOptions, AuthIdentity } from "./types";
import type { AuthGuardName, AuthMedium, AuthRouteGroup } from "./types";
import type { AuthEnrolmentGuardOptions, AuthGuardChainOptions, AuthGuardOptions, AuthRouteMaps } from "./types";

const NO_SESSION =
  "auth/web guard: no session on this request — mount session middleware (`createAnonymousSession`, or `sessionMiddleware` behind your own resolver) on the app before the auth guard chain, or the guards deny nothing while appearing to work.";

const NOT_SIGNED_IN = "Not signed in.";
const ENROLMENT_OWED = "This account still owes a factor enrolment.";
const STEP_UP_OWED = "This account owes a step-up verification.";
const STEP_UP_STALE = "This change needs a fresh verification.";

const NOTHING_OWED = "This account owes no factor enrolment.";
const UNAVAILABLE = "Service Unavailable";

const MIN_STEP_UP_MAX_AGE_MS = 1_000;

const authDemandCtx = contextVar<AuthFactorResolution>("auth.demand");

// A group that answers in JSON is refused in JSON: a browser controller posting a ceremony step
// cannot read an HTML sign-in page, and follows the redirect only to parse the wrong document.
function refuse(medium: AuthMedium | undefined, message: string, status: number, html: () => Response): Response {
  return medium === "json" ? jsonResponse({ error: message }, status) : html();
}

async function establishIdentity<Bindings>(
  context: Parameters<Middleware>[0],
  options: Pick<AuthGuardOptions<Bindings>, "users" | "now">,
): Promise<AuthIdentity | null> {
  const established = authCtx.getOptional(context);
  if (established !== undefined) return established;

  const session = sessionCtx.getOptional(context);
  if (session === undefined) throw new Error(NO_SESSION);

  const users = await options.users(getAppContext<Bindings>(context));
  return resolveAuthIdentity(session, users, guardNow(options));
}

function replayableMethod(context: Parameters<Middleware>[0]): boolean {
  const method = context.method.toUpperCase();
  return method === "GET" || method === "HEAD";
}

// An htmx request's own URL is a fragment endpoint, not a page, so the return-to is the page it was
// sent from; a mutation's URL has no GET handler to arrive back at.
function signinReturnPath(context: Parameters<Middleware>[0]): string | null {
  if (!isHxRequest(context)) {
    return replayableMethod(context) ? safeRedirectPath(`${context.url.pathname}${context.url.search}`, "/") : null;
  }
  const current = hxCurrentUrl(context);
  if (!URL.canParse(current)) return null;
  const page = new URL(current);
  if (page.origin !== context.url.origin) return null;
  return safeRedirectPath(`${page.pathname}${page.search}`, "/");
}

/** Establishes the request's identity from the session, sending an anonymous request to sign-in. @public */
export function requireAuth<Bindings = Record<string, unknown>>(options: AuthGuardOptions<Bindings>): Middleware {
  assertStepUpMaxAge("requireAuth", "stepUpMaxAgeMs", options.stepUpMaxAgeMs);
  const returnParam = options.returnParam ?? "next";
  return async (context, next) => {
    const identity = await establishIdentity<Bindings>(context, options);
    if (identity === null) {
      return refuse(options.medium, NOT_SIGNED_IN, 401, () => {
        const target = new URL(options.signinPath, context.url);
        const returnTo = signinReturnPath(context);
        if (returnTo !== null) target.searchParams.set(returnParam, returnTo);
        return createAuthRedirect(context, `${target.pathname}${target.search}`, replayableMethod(context) ? 302 : 303);
      });
    }

    establish(context, identity, options);

    // The session is established before the second factor is proved, so without this the owed
    // step-up is only enforced by the groups that happen to list an enrolment guard.
    if (options.clearsStepUp !== true) {
      const resolved = await resolveFactorDemand(context, identity, options);
      if (resolved === undefined) return refuse(options.medium, UNAVAILABLE, 503, () => new Response(UNAVAILABLE, { status: 503 }));
      if (authStepUpOwed(resolved, identity.stepUpAt, stepUpWindow(options))) {
        return refuse(options.medium, STEP_UP_OWED, 403, () => createAuthRedirect(context, options.stepUpPath));
      }
    }

    return next();
  };
}

/** Establishes the request's identity when the session carries one, and admits an anonymous request unchanged. @public */
export function resolveAuth<Bindings = Record<string, unknown>>(
  options: Pick<AuthGuardOptions<Bindings>, "users" | "stepUpMaxAgeMs" | "now">,
): Middleware {
  assertStepUpMaxAge("resolveAuth", "stepUpMaxAgeMs", options.stepUpMaxAgeMs);
  return async (context, next) => {
    const identity = await establishIdentity<Bindings>(context, options);
    if (identity !== null) establish(context, identity, options);
    return next();
  };
}

function establish(context: Parameters<Middleware>[0], identity: AuthIdentity, options: Pick<AuthGuardOptions, "stepUpMaxAgeMs" | "now">): void {
  authCtx.set(context, identity);
  stepUpWindowCtx.set(context, stepUpWindow(options));
}

function establishedIdentity(context: Parameters<Middleware>[0], guard: string): AuthIdentity {
  const identity = authCtx.getOptional(context);
  if (identity === undefined) {
    throw new Error(
      `auth/web guard: no identity on this request — \`requireAuth\` must run before \`${guard}\`, which reads the identity it establishes.`,
    );
  }
  return identity;
}

/** Refuses a request whose established identity is not an administrator. @public */
export function requireAdmin(): Middleware {
  return (context, next) => {
    const identity = establishedIdentity(context, "requireAdmin");
    if (!identity.isAdmin) return new Response("Forbidden", { status: 403 });
    return next();
  };
}

/** The access token `requireBearer` admitted this request with. @public */
export const accessTokenCtx = contextVar<AuthAccessToken>("auth.accessToken");

const BEARER_CREDENTIALS = /^Bearer +(\S+)$/i;

/** Admits a request only on a valid `Authorization: Bearer` access token holding every listed scope, refusing per RFC 6750. @public */
export function requireBearer<Scope extends string, Bindings = Record<string, unknown>>(
  options: AccessTokenGuardOptions<Scope, Bindings>,
): Middleware {
  const required = options.scopes ?? [];
  return async (context, next) => {
    const presented = BEARER_CREDENTIALS.exec(context.request.headers.get("Authorization") ?? "")?.[1];
    if (presented === undefined) return jsonResponse({ error: NOT_SIGNED_IN }, 401, { "WWW-Authenticate": "Bearer" });

    const tokens = await options.tokens(getAppContext<Bindings>(context));
    const verified = await tokens.verify(presented, guardNow(options), required);
    if (verified.ok) {
      accessTokenCtx.set(context, verified.data);
      return next();
    }
    if (verified.error === "insufficient-scope") {
      return jsonResponse({ error: "insufficient_scope" }, 403, {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${required.join(" ")}"`,
      });
    }
    if (typeof verified.error === "string") {
      return jsonResponse({ error: "invalid_token" }, 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
    }
    return jsonResponse({ error: UNAVAILABLE }, 503);
  };
}

type AuthDemand =
  | { readonly status: "none" }
  | { readonly status: "enrolment"; readonly kinds: readonly AuthFactorKind[] }
  | { readonly status: "step-up" }
  | { readonly status: "unknown" };

function assertStepUpMaxAge(operation: string, option: string, requested: number | undefined): void {
  if (requested === undefined) return;
  authLimit(operation, option, requested, {
    fallback: MIN_STEP_UP_MAX_AGE_MS,
    min: MIN_STEP_UP_MAX_AGE_MS,
    unit: "millisecond",
    floor: "a window no mark can be inside makes every step-up owe another one",
  });
}

function guardNow(options: { readonly now?: () => number }): number {
  return options.now === undefined ? Date.now() : options.now();
}

/** Whether `stepUpAt` still counts as of `now`, given the configured lifetime. @internal */
export function stepUpHolds(stepUpAt: number | null, maxAgeMs: number | undefined, now: number): boolean {
  if (stepUpAt === null) return false;
  const age = now - stepUpAt;
  // A negative age is a mark dated into the future: it would satisfy every window until the clock
  // catches up, so it counts for nothing instead.
  if (age < 0) return false;
  return maxAgeMs === undefined || age < maxAgeMs;
}

interface AuthStepUpWindow {
  readonly maxAgeMs: number | undefined;
  readonly now: number;
}

const stepUpWindowCtx = contextVar<AuthStepUpWindow>("auth.stepUpWindow");

function stepUpWindow(options: { readonly stepUpMaxAgeMs?: number; readonly now?: () => number }): AuthStepUpWindow {
  return { maxAgeMs: options.stepUpMaxAgeMs, now: guardNow(options) };
}

// The verify page reads the window of the guard that established the identity rather than a setting
// of its own: were the two to judge a mark differently, a stale one would bounce between verify and enrol.
/** The window the guard that established this request's identity measures a mark against, or `undefined` when no guard did. @internal */
export function authStepUpWindow(context: Parameters<Middleware>[0]): AuthStepUpWindow | undefined {
  return stepUpWindowCtx.getOptional(context);
}

const freshStepUpWindowCtx = contextVar<AuthStepUpWindow>("auth.freshStepUpWindow");

/** The window `requireFreshStepUp` measures a state-changing request's mark against, or `undefined` when it did not run. @internal */
export function authFreshStepUpWindow(context: Parameters<Middleware>[0]): AuthStepUpWindow | undefined {
  return freshStepUpWindowCtx.getOptional(context);
}

/** Whether `resolved` demands a second factor that a session marked `stepUpAt` has not proved inside `window`; no window proves nothing. @internal */
export function authStepUpOwed(resolved: AuthFactorResolution, stepUpAt: number | null, window: AuthStepUpWindow | undefined): boolean {
  const demanded = resolved.status === "step-up-required" || (resolved.status === "enrolment-required" && resolved.stepUpKinds.length > 0);
  return demanded && (window === undefined || !stepUpHolds(stepUpAt, window.maxAgeMs, window.now));
}

async function resolveFactorDemand<Bindings>(
  context: Parameters<Middleware>[0],
  identity: AuthIdentity,
  options: Pick<AuthEnrolmentGuardOptions<Bindings>, "factors">,
): Promise<AuthFactorResolution | undefined> {
  const held = authDemandCtx.getOptional(context);
  if (held !== undefined) return held;
  const factors = await options.factors(getAppContext<Bindings>(context));
  const resolved = await factors.resolve(identity.userId, authFactorContext(identity));
  if (!resolved.ok) return undefined;
  authDemandCtx.set(context, resolved.data);
  return resolved.data;
}

async function resolveAuthDemand<Bindings>(
  context: Parameters<Middleware>[0],
  identity: AuthIdentity,
  options: AuthEnrolmentGuardOptions<Bindings>,
): Promise<AuthDemand> {
  const resolved = await resolveFactorDemand(context, identity, options);
  if (resolved === undefined) return { status: "unknown" };
  // `resolve` reads confirmed factor rows and nothing else, so it answers `step-up-required` on
  // every request of a session that has already verified. The session's own mark is the memory it has not got.
  if (authStepUpOwed(resolved, identity.stepUpAt, stepUpWindow(options))) return { status: "step-up" };
  if (resolved.status === "enrolment-required") return { status: "enrolment", kinds: resolved.kinds };
  return { status: "none" };
}

// A throw and not a redirect: a kind nothing can be enrolled on has no page to send anyone to, so
// redirecting is the loop this exists to prevent.
function enrolmentTarget<Bindings>(options: AuthEnrolmentGuardOptions<Bindings>, kinds: readonly AuthFactorKind[]): string {
  const target = authEnrolTarget(options.enrolmentPaths, kinds);
  if (target !== undefined) return target;
  throw new Error(
    `auth/web guard: this account owes an enrolment in ${kinds.join(", ") || "no offered factor"}, and \`enrolmentPaths\` names a page for none of them — ` +
      "add one per offered enrollable kind, or spell the whole record `authEnrolmentPaths(paths.auth)`.",
  );
}

function assertEnrolmentPaths(operation: string, paths: Partial<Record<AuthFactorKind, string>>): void {
  if (Object.values(paths).some((path) => path !== undefined)) return;
  throw new Error(
    `${operation}: \`enrolmentPaths\` names no enrolment page, so every owed enrolment would be refused with nowhere to go — spell it \`authEnrolmentPaths(paths.auth)\`.`,
  );
}

/** Sends a signed-in user who still owes a factor enrolment or a step-up to the page that clears it. @public */
export function requireEnrolment<Bindings = Record<string, unknown>>(options: AuthEnrolmentGuardOptions<Bindings>): Middleware {
  assertStepUpMaxAge("requireEnrolment", "stepUpMaxAgeMs", options.stepUpMaxAgeMs);
  assertEnrolmentPaths("requireEnrolment", options.enrolmentPaths);

  return async (context, next) => {
    const identity = establishedIdentity(context, "requireEnrolment");

    const demand = await resolveAuthDemand(context, identity, options);
    if (demand.status === "enrolment") {
      const target = enrolmentTarget(options, demand.kinds);
      return refuse(options.medium, ENROLMENT_OWED, 403, () => createAuthRedirect(context, target));
    }
    if (demand.status === "step-up") return refuse(options.medium, STEP_UP_OWED, 403, () => createAuthRedirect(context, options.stepUpPath));
    // Refused rather than redirected: an unknown demand cannot pick a remedy, and every remedy page
    // asks the same unavailable store, so a redirect here is a loop.
    if (demand.status === "unknown") return refuse(options.medium, UNAVAILABLE, 503, () => new Response(UNAVAILABLE, { status: 503 }));
    return next();
  };
}

/** Admits a signed-in user only while they genuinely owe an enrolment, so an owed step-up cannot be enrolled around. @public */
export function requirePendingEnrolment<Bindings = Record<string, unknown>>(options: AuthEnrolmentGuardOptions<Bindings>): Middleware {
  assertStepUpMaxAge("requirePendingEnrolment", "stepUpMaxAgeMs", options.stepUpMaxAgeMs);
  assertEnrolmentPaths("requirePendingEnrolment", options.enrolmentPaths);

  return async (context, next) => {
    const identity = establishedIdentity(context, "requirePendingEnrolment");

    const demand = await resolveAuthDemand(context, identity, options);
    if (demand.status === "enrolment") return next();
    // The whole point of this guard: a session owing a step-up may not mint the second factor that
    // would satisfy it, so it is sent to verify rather than admitted to enrol.
    if (demand.status === "step-up") return refuse(options.medium, STEP_UP_OWED, 403, () => createAuthRedirect(context, options.stepUpPath));
    if (demand.status === "unknown") return refuse(options.medium, UNAVAILABLE, 503, () => new Response(UNAVAILABLE, { status: 503 }));
    return refuse(options.medium, NOTHING_OWED, 403, () => createAuthRedirect(context, options.settledPath));
  };
}

// Only a state-changing request is held to it: reading the page that offers the action is not the
// action, and gating the `GET` would leave a visitor unable to reach the form that clears the demand.
/** Demands a step-up inside the window on every state-changing request of a user who is subject to a second factor. @public */
export function requireFreshStepUp<Bindings = Record<string, unknown>>(options: AuthEnrolmentGuardOptions<Bindings>): Middleware {
  const maxAgeMs = options.freshStepUpMaxAgeMs === null ? null : (options.freshStepUpMaxAgeMs ?? AUTH_FRESH_STEP_UP_MS);
  assertStepUpMaxAge("requireFreshStepUp", "freshStepUpMaxAgeMs", maxAgeMs ?? undefined);

  return async (context, next) => {
    const fresh: AuthStepUpWindow = { maxAgeMs: maxAgeMs ?? undefined, now: guardNow(options) };
    freshStepUpWindowCtx.set(context, fresh);
    if (maxAgeMs === null) return next();
    if (SAFE_METHODS.has(context.method.toUpperCase())) return next();

    const identity = establishedIdentity(context, "requireFreshStepUp");
    const resolved = await resolveFactorDemand(context, identity, options);
    if (resolved === undefined) return refuse(options.medium, UNAVAILABLE, 503, () => new Response(UNAVAILABLE, { status: 503 }));
    if (resolved.status !== "step-up-required") return next();
    if (stepUpHolds(identity.stepUpAt, fresh.maxAgeMs, fresh.now)) return next();

    // 303 always: this is a mutation, and a 302 would have the browser replay it at the step-up page.
    return refuse(options.medium, STEP_UP_STALE, 403, () => createAuthRedirect(context, options.stepUpPath));
  };
}

function mapAt(routes: AuthRouteMaps, path: readonly string[]): RouteMap | undefined {
  const [builder, ...rest] = path;
  let current = routes[builder as keyof AuthRouteMaps];
  for (const key of rest) {
    const child = current?.[key];
    current = child === undefined || child instanceof Route ? undefined : child;
  }
  return current;
}

// Direct leaves only: a nested group registers its own stack, so covering its paths from the parent
// would run the shared guards on it twice.
function ownRoutes(routeMap: RouteMap): Route[] {
  return Object.values(routeMap).filter((value): value is Route => value instanceof Route);
}

// Copied rather than imported from `security/origin`: `auth/web` declares no edge to `security`, so
// the import that would share this set fails `validate-namespace-graph`.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function mutates(routes: readonly Route[]): boolean {
  return routes.some((leaf) => !SAFE_METHODS.has(leaf.method));
}

function assertGuardOrder(group: AuthRouteGroup): void {
  const auth = group.guards.indexOf("require-auth");
  for (const [index, guard] of group.guards.entries()) {
    if (guard === "require-auth" || guard === "resolve-auth" || (auth !== -1 && auth < index)) continue;
    throw new Error(
      `createAuthGuards: group \`${group.path.join(".")}\` lists \`${guard}\` without \`require-auth\` before it — that guard reads the identity \`requireAuth\` establishes, so in this order every request to the group fails instead of being authorised.`,
    );
  }
}

function guardMiddleware<Bindings>(
  name: AuthGuardName,
  options: Pick<AuthGuardChainOptions<Bindings>, "auth" | "enrolment">,
  group: AuthRouteGroup,
): Middleware {
  const medium = group.medium;
  if (name === "resolve-auth")
    return resolveAuth({
      users: options.auth.users,
      ...(options.auth.now === undefined ? {} : { now: options.auth.now }),
      ...(options.enrolment.stepUpMaxAgeMs === undefined ? {} : { stepUpMaxAgeMs: options.enrolment.stepUpMaxAgeMs }),
    });
  if (name === "require-auth")
    return requireAuth({
      ...options.auth,
      factors: options.enrolment.factors,
      stepUpPath: options.enrolment.stepUpPath,
      ...(options.enrolment.stepUpMaxAgeMs === undefined ? {} : { stepUpMaxAgeMs: options.enrolment.stepUpMaxAgeMs }),
      ...(group.clearsStepUp === true ? { clearsStepUp: true } : {}),
      medium,
    });
  if (name === "require-admin") return requireAdmin();
  if (name === "require-pending-enrolment") return requirePendingEnrolment({ ...options.enrolment, medium });
  if (name === "require-fresh-step-up") return requireFreshStepUp({ ...options.enrolment, medium });
  return requireEnrolment({ ...options.enrolment, medium });
}

/** The guard stack the group table declares for every group, plus the configured origin protection on every group that mutates and any rate limit named for it. @public */
export function createAuthGuards<Bindings = Record<string, unknown>>(options: AuthGuardChainOptions<Bindings>): MiddlewareGuardGroup<Bindings>[] {
  const groups: MiddlewareGuardGroup<Bindings>[] = [];
  for (const group of options.groups ?? AUTH_ROUTE_GROUPS) {
    assertGuardOrder(group);

    const groupName = group.path.join(".");
    const routeMap = mapAt(options.routes, group.path);
    if (routeMap === undefined) {
      if (group.guards.length === 0) continue;
      throw new Error(
        `createAuthGuards: group \`${groupName}\` declares ${group.guards.length} guards but \`routes\` holds no \`${groupName}\` map — pass the map that mounts those routes, or the group ships with no guard at all.`,
      );
    }

    const routes = ownRoutes(routeMap);
    if (routes.length === 0) {
      if (group.guards.length === 0) continue;
      throw new Error(
        `createAuthGuards: group \`${groupName}\` declares ${group.guards.length} guards but its \`routes\` map holds no route of its own — the guards would cover nothing, so every route meant for them is unguarded.`,
      );
    }

    // An absent allowlist is not an opt-out: a mutating group with no `Origin`/`Referer` check
    // accepts a cross-site POST, and a consumer who omitted `origin` would never be told.
    if (options.origin === undefined && mutates(routes)) {
      throw new Error(
        `createAuthGuards: group \`${groupName}\` answers a state-changing method but no \`origin\` policy was passed — pass one, so a cross-site submission to it is refused.`,
      );
    }

    const origin = options.origin !== undefined && mutates(routes) ? options.origin : undefined;
    // Every method, not only the mutating ones: an unauthenticated `GET` of the sign-in page is as
    // cheap to flood as its `POST`, and the group's own limits are the consumer's to pick.
    const rateLimit = options.rateLimit?.[group.path.join(".")];
    // A group with no guards still earns a stack when it mutates and an allowlist was configured:
    // the sign-in and passkey POSTs carry no identity, so this is their only cross-origin defence.
    if (group.guards.length === 0 && origin === undefined && rateLimit === undefined) continue;

    const paths = [...new Set(routes.map((leaf) => leaf.pattern.source))];
    const guards = group.guards.map((name) => guardMiddleware(name, options, group));
    groups.push({ paths, ...(origin && { origin }), ...(rateLimit && { rateLimit }), ...(guards.length > 0 && { guards }) });
  }
  return groups;
}
