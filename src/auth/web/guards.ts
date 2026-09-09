import type { Middleware } from "@remix-run/fetch-router";
import { Route, type RouteMap } from "@remix-run/fetch-router/routes";

import type { MiddlewareGuardGroup } from "../../app/middleware-chain";
import { type AppContext, getAppContext } from "../../context/types";
import { safeRedirectPath } from "../../http/redirect-path";
import { jsonResponse, redirect } from "../../http/response";
import { sessionCtx } from "../../session/session";
import { type AuthFactorRegistry, authFactorContext } from "../factors/registry";
import { authLimit } from "../limits";
import type { AuthFactorKind, UserStore } from "../types";
import { type AuthIdentity, authCtx, resolveAuthIdentity } from "./identity";
import { authEnrolTarget } from "./paths";
import { type AuthGuardName, type AuthMedium, type AuthRouteGroup, AUTH_ROUTE_GROUPS } from "./routes";

const NO_SESSION =
  "auth/web guard: no session on this request — mount session middleware (`createAnonymousSession`, or `sessionMiddleware` behind your own resolver) on the app before the auth guard chain, or the guards deny nothing while appearing to work.";

const NOT_SIGNED_IN = "Not signed in.";
const ENROLMENT_OWED = "This account still owes a factor enrolment.";
const STEP_UP_OWED = "This account owes a step-up verification.";
const STEP_UP_STALE = "This change needs a fresh verification.";

const NO_STEP_UP_FACTOR =
  "auth/web guard: `freshStepUpMaxAgeMs` is configured but this deployment offers no step-up factor, so no request could ever carry a mark fresh enough — offer a second factor, or drop the option and the `require-fresh-step-up` guard with it.";

const NOTHING_OWED = "This account owes no factor enrolment.";
const UNAVAILABLE = "Service Unavailable";

const MIN_STEP_UP_MAX_AGE_MS = 1_000;

// The same lifetime `AuthWebOptions.resolveServices` has, for the same reason: a store built from a
// Worker binding cannot exist until there is a request carrying `env`.
/** Builds one of a guard's dependencies from the request it is guarding. @public */
export type AuthGuardResolver<Bindings, T> = (c: AppContext<Bindings>) => T | Promise<T>;

/** What `requireAuth` needs to turn a session into an identity. @public */
export interface AuthGuardOptions<Bindings = Record<string, unknown>> {
  /** Built per request, and so re-read every request: a demotion or deactivation lands on the next one rather than the next sign-in. */
  readonly users: AuthGuardResolver<Bindings, Pick<UserStore, "findById">>;
  /** Where an anonymous request is sent — read off `authPaths`, never written as a literal. */
  readonly signinPath: string;
  /** Query parameter carrying the return-to path onto the sign-in page. Defaults to `next`. */
  readonly returnParam?: string;
  /** How this group answers. A `json` group is refused with a body rather than redirected. Defaults to `html`. */
  readonly medium?: AuthMedium;
}

/** What the two enrolment guards need to tell an owed enrolment from an owed step-up from neither. @public */
export interface AuthEnrolmentGuardOptions<Bindings = Record<string, unknown>> {
  /** Built per request, for the same reason the user store is: the registry is assembled from Worker bindings. */
  readonly factors: AuthGuardResolver<Bindings, Pick<AuthFactorRegistry, "resolve" | "stepUp">>;
  // Keyed by kind because the demand is: a deployment offering the authenticator app owes a page an
  // enrolment can be completed on, and a single path sends every owed kind to whichever one it names.
  /** Where a user who still owes an enrolment is sent, by the kind they owe — spell it `authEnrolmentPaths(paths.auth)`. */
  readonly enrolmentPaths: Partial<Record<AuthFactorKind, string>>;
  /** Where a user who owes a step-up is sent — read off `authPaths`. */
  readonly stepUpPath: string;
  /** Where a user with nothing outstanding is sent off an enrolment page — read off `authPaths`. */
  readonly settledPath: string;
  /** How long a completed step-up satisfies a later demand, in milliseconds. Omit to last the session. */
  readonly stepUpMaxAgeMs?: number;
  // Separate from `stepUpMaxAgeMs` because they answer different questions: that one is how long a
  // session stays signed in, this one is how recently the visitor proved they are still there.
  /** How recent a step-up a state-changing request must carry, in milliseconds. Omit and `requireFreshStepUp` demands nothing. */
  readonly freshStepUpMaxAgeMs?: number;
  /** How this group answers. A `json` group is refused with a body rather than redirected. Defaults to `html`. */
  readonly medium?: AuthMedium;
}

/** The built route maps a guard chain attaches to; a builder that was never called is simply absent. @public */
export interface AuthRouteMaps {
  readonly auth?: RouteMap;
  readonly account?: RouteMap;
  readonly admin?: RouteMap;
}

/** What `createAuthGuards` needs to wire `AUTH_ROUTE_GROUPS` onto a middleware chain. @public */
export interface AuthGuardChainOptions<Bindings = Record<string, unknown>> {
  readonly routes: AuthRouteMaps;
  readonly auth: AuthGuardOptions<Bindings>;
  readonly enrolment: AuthEnrolmentGuardOptions<Bindings>;
  /** Group table to wire. Defaults to `AUTH_ROUTE_GROUPS`. */
  readonly groups?: readonly AuthRouteGroup[];
  // Reached through `MiddlewareGuardGroup` rather than imported from `security/types`: `auth/web`
  // declares no edge to `security`, and the direct import fails `validate-namespace-graph`.
  /** Origin/Referer allowlist for every group carrying a mutating leaf; forge cannot pick your origins, so without it none is mounted. */
  readonly origin?: NonNullable<MiddlewareGuardGroup<Bindings>["origin"]>;
  // Keyed by the group's own dotted path rather than attached to `AuthRouteGroup`, so the group
  // table stays the one description of what a group *is* and a consumer never restates it. A window
  // right for the sign-in POST is wrong for the admin console, so this is per group and not global.
  /** Rate limits per group, keyed by `path.join(".")` — `"auth"`, `"auth.verify"`, `"account"`. Forge picks no numbers. */
  readonly rateLimit?: Readonly<Record<string, NonNullable<MiddlewareGuardGroup<Bindings>["rateLimit"]>>>;
}

// A group that answers in JSON is refused in JSON: a browser controller posting a ceremony step
// cannot read an HTML sign-in page, and follows the redirect only to parse the wrong document.
/** The refusal `medium` calls for — `html` builds its own answer, `json` carries the message as a body. */
function refuse(medium: AuthMedium | undefined, message: string, status: number, html: () => Response): Response {
  return medium === "json" ? jsonResponse({ error: message }, status) : html();
}

/** Establishes the request's identity from the session, sending an anonymous request to sign-in. @public */
export function requireAuth<Bindings = Record<string, unknown>>(options: AuthGuardOptions<Bindings>): Middleware {
  const returnParam = options.returnParam ?? "next";
  return async (context, next) => {
    const session = sessionCtx.getOptional(context);
    if (session === undefined) throw new Error(NO_SESSION);

    const users = await options.users(getAppContext<Bindings>(context));
    const identity = await resolveAuthIdentity(session, users);
    if (identity === null) {
      return refuse(options.medium, NOT_SIGNED_IN, 401, () => {
        // Only a replayable method may be recorded as a return-to: the visitor arrives back by GET,
        // and a mutation's URL has no GET handler to arrive at.
        const method = context.method.toUpperCase();
        const replayable = method === "GET" || method === "HEAD";
        const target = new URL(options.signinPath, context.url);
        if (replayable) target.searchParams.set(returnParam, safeRedirectPath(`${context.url.pathname}${context.url.search}`, "/"));
        return redirect(`${target.pathname}${target.search}`, replayable ? undefined : 303);
      });
    }

    authCtx.set(context, identity);
    return next();
  };
}

// The verify page is one route serving two ceremonies — the second half of a sign-in, and a step-up
// a signed-in session owes — and only the identity tells them apart. `requireAuth` cannot run there
// (an anonymous visitor must reach it), and reading the session inside the page instead would put an
// identity on a request no guard has judged.
/** Establishes the request's identity when the session carries one, and admits an anonymous request unchanged. @public */
export function resolveAuth<Bindings = Record<string, unknown>>(options: Pick<AuthGuardOptions<Bindings>, "users">): Middleware {
  return async (context, next) => {
    const session = sessionCtx.getOptional(context);
    if (session === undefined) throw new Error(NO_SESSION);

    const users = await options.users(getAppContext<Bindings>(context));
    const identity = await resolveAuthIdentity(session, users);
    if (identity !== null) authCtx.set(context, identity);
    return next();
  };
}

/** The identity `requireAuth` established, or a throw naming the guard that was ordered before it. */
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

/** What this request still owes the factor policy, once the session's own step-up is taken into account. */
type AuthDemand =
  | { readonly status: "none" }
  | { readonly status: "enrolment"; readonly kinds: readonly AuthFactorKind[] }
  | { readonly status: "step-up" }
  | { readonly status: "unknown" };

// `undefined` is legal and means the mark lasts the session, so it is passed through rather than
// resolved against a default no window would be right for.
/** Refuses a step-up window too short for any mark to survive being written. */
function assertStepUpMaxAge(operation: string, option: string, requested: number | undefined): void {
  if (requested === undefined) return;
  authLimit(operation, option, requested, {
    fallback: MIN_STEP_UP_MAX_AGE_MS,
    min: MIN_STEP_UP_MAX_AGE_MS,
    unit: "millisecond",
    floor: "a window no mark can be inside makes every step-up owe another one",
  });
}

/** Whether `stepUpAt` still counts, given the configured lifetime. */
function stepUpHolds(stepUpAt: number | null, maxAgeMs: number | undefined): boolean {
  if (stepUpAt === null) return false;
  const age = Date.now() - stepUpAt;
  // A negative age is a mark dated into the future: it would satisfy every window until the clock
  // catches up, so it counts for nothing instead.
  if (age < 0) return false;
  return maxAgeMs === undefined || age < maxAgeMs;
}

// One reader for both guards, so the demand is computed in one place and they only disagree about
// which side of it they admit.
/** The outstanding demand for the identity on `context`. */
async function resolveAuthDemand<Bindings>(
  context: Parameters<Middleware>[0],
  identity: AuthIdentity,
  options: AuthEnrolmentGuardOptions<Bindings>,
): Promise<AuthDemand> {
  const factors = await options.factors(getAppContext<Bindings>(context));
  const resolved = await factors.resolve(identity.userId, authFactorContext(identity));
  if (!resolved.ok) return { status: "unknown" };
  if (resolved.data.status === "enrolment-required") return { status: "enrolment", kinds: resolved.data.kinds };
  // `resolve` reads confirmed factor rows and nothing else, so it answers `step-up-required` on
  // every request of a session that has already verified. The session's own mark is the memory it has not got.
  if (resolved.data.status === "step-up-required") {
    return stepUpHolds(identity.stepUpAt, options.stepUpMaxAgeMs) ? { status: "none" } : { status: "step-up" };
  }
  return { status: "none" };
}

// A throw and not a redirect: a kind nothing can be enrolled on has no page to send anyone to, so
// redirecting is the loop this exists to prevent. `authEnrolmentPaths` covers every kind forge can
// enrol, which is why the ordinary mount cannot reach this.
/** Where a request owing one of `kinds` goes to clear it, or a throw naming the option that omits it. */
function enrolmentTarget<Bindings>(options: AuthEnrolmentGuardOptions<Bindings>, kinds: readonly AuthFactorKind[]): string {
  const target = authEnrolTarget(options.enrolmentPaths, kinds);
  if (target !== undefined) return target;
  throw new Error(
    `auth/web guard: this account owes an enrolment in ${kinds.join(", ") || "no offered factor"}, and \`enrolmentPaths\` names a page for none of them — ` +
      "add one per offered enrollable kind, or spell the whole record `authEnrolmentPaths(paths.auth)`.",
  );
}

/** Refuses a guard chain whose enrolment redirect could never name a page. */
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
      return refuse(options.medium, ENROLMENT_OWED, 403, () => redirect(target));
    }
    if (demand.status === "step-up") return refuse(options.medium, STEP_UP_OWED, 403, () => redirect(options.stepUpPath));
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
    if (demand.status === "step-up") return refuse(options.medium, STEP_UP_OWED, 403, () => redirect(options.stepUpPath));
    if (demand.status === "unknown") return refuse(options.medium, UNAVAILABLE, 503, () => new Response(UNAVAILABLE, { status: 503 }));
    return refuse(options.medium, NOTHING_OWED, 403, () => redirect(options.settledPath));
  };
}

// Only a state-changing request is held to it: reading the page that offers the action is not the
// action, and gating the `GET` would leave a visitor unable to reach the form that clears the demand.
// `{mode:"single"}` throws rather than admitting — a deployment asking for freshness it has no factor
// to prove is a wiring mistake, and admitting silently is the one answer that hides it.
/** Demands a recent step-up on every state-changing request of its group, so a long-lived session cannot strip a factor. @public */
export function requireFreshStepUp<Bindings = Record<string, unknown>>(options: AuthEnrolmentGuardOptions<Bindings>): Middleware {
  const maxAgeMs = options.freshStepUpMaxAgeMs;
  assertStepUpMaxAge("requireFreshStepUp", "freshStepUpMaxAgeMs", maxAgeMs);

  return async (context, next) => {
    if (maxAgeMs === undefined) return next();
    if (SAFE_METHODS.has(context.method.toUpperCase())) return next();

    const identity = establishedIdentity(context, "requireFreshStepUp");
    const factors = await options.factors(getAppContext<Bindings>(context));
    if (factors.stepUp.length === 0) throw new Error(NO_STEP_UP_FACTOR);
    if (stepUpHolds(identity.stepUpAt, maxAgeMs)) return next();

    // 303 always: this is a mutation, and a 302 would have the browser replay it at the step-up page.
    // The visitor lands on the settled page afterwards and repeats the action, which is the honest
    // account of what happened — forge keeps no pending mutation across a re-authentication.
    return refuse(options.medium, STEP_UP_STALE, 403, () => redirect(options.stepUpPath, 303));
  };
}

/** The nested map at `path` within `routes`, or `undefined` when that builder was never called. */
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
/** Every `Route` sitting directly in `routeMap`. */
function ownRoutes(routeMap: RouteMap): Route[] {
  return Object.values(routeMap).filter((value): value is Route => value instanceof Route);
}

// Copied rather than imported from `security/origin`: `auth/web` declares no edge to `security`, so
// the import that would share this set fails `validate-namespace-graph`.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** Whether any direct leaf answers a state-changing method — what decides a group gets origin protection. */
function mutates(routes: readonly Route[]): boolean {
  return routes.some((leaf) => !SAFE_METHODS.has(leaf.method));
}

/** Fails a group listing a guard that reads the identity before the `require-auth` that establishes it. */
function assertGuardOrder(group: AuthRouteGroup): void {
  const auth = group.guards.indexOf("require-auth");
  for (const [index, guard] of group.guards.entries()) {
    // `resolve-auth` establishes rather than reads, and it establishes nothing on an anonymous
    // request, so it neither needs `require-auth` before it nor stands in for one after it.
    if (guard === "require-auth" || guard === "resolve-auth" || (auth !== -1 && auth < index)) continue;
    throw new Error(
      `createAuthGuards: group \`${group.path.join(".")}\` lists \`${guard}\` without \`require-auth\` before it — that guard reads the identity \`requireAuth\` establishes, so in this order every request to the group fails instead of being authorised.`,
    );
  }
}

/** Wires one guard name to the middleware that implements it, carrying the group's own medium. */
function guardMiddleware<Bindings>(
  name: AuthGuardName,
  options: Pick<AuthGuardChainOptions<Bindings>, "auth" | "enrolment">,
  medium: AuthMedium,
): Middleware {
  if (name === "resolve-auth") return resolveAuth({ users: options.auth.users });
  if (name === "require-auth") return requireAuth({ ...options.auth, medium });
  // No JSON branch: `require-admin` sits on no JSON group, and an unused branch is an untested one.
  if (name === "require-admin") return requireAdmin();
  if (name === "require-pending-enrolment") return requirePendingEnrolment({ ...options.enrolment, medium });
  if (name === "require-fresh-step-up") return requireFreshStepUp({ ...options.enrolment, medium });
  return requireEnrolment({ ...options.enrolment, medium });
}

// Session middleware is the caller's to mount, ahead of these groups. It is not taken as an option:
// an option can only be checked for presence, which a middleware other than the one actually mounted
// satisfies just as well — the check that holds is `requireAuth`'s own, against the live request.
/** The guard stack the group table declares for every group, plus the configured origin protection on every group that mutates and any rate limit named for it. @public */
export function createAuthGuards<Bindings = Record<string, unknown>>(options: AuthGuardChainOptions<Bindings>): MiddlewareGuardGroup<Bindings>[] {
  const groups: MiddlewareGuardGroup<Bindings>[] = [];
  for (const group of options.groups ?? AUTH_ROUTE_GROUPS) {
    assertGuardOrder(group);

    const routeMap = mapAt(options.routes, group.path);
    if (routeMap === undefined) continue;

    const routes = ownRoutes(routeMap);
    if (routes.length === 0) continue;

    const origin = options.origin !== undefined && mutates(routes) ? options.origin : undefined;
    // Every method, not only the mutating ones: an unauthenticated `GET` of the sign-in page is as
    // cheap to flood as its `POST`, and the group's own limits are the consumer's to pick.
    const rateLimit = options.rateLimit?.[group.path.join(".")];
    // A group with no guards still earns a stack when it mutates and an allowlist was configured:
    // the sign-in and passkey POSTs carry no identity, so this is their only cross-origin defence.
    if (group.guards.length === 0 && origin === undefined && rateLimit === undefined) continue;

    const paths = [...new Set(routes.map((leaf) => leaf.pattern.source))];
    const middleware = group.guards.map((name) => guardMiddleware(name, options, group.medium));
    groups.push({ paths, ...(origin && { origin }), ...(rateLimit && { rateLimit }), ...(middleware.length > 0 && { middleware }) });
  }
  return groups;
}
