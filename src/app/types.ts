import type { Middleware, RequestContext, RequestHandler } from "@remix-run/fetch-router";
import type { Route } from "@remix-run/fetch-router/routes";
import type { Matcher, MultiMatcher } from "@remix-run/route-pattern/match";

import type { AppContext, BindingSpec, Refusal, RefuseHook } from "../context/types";
import type { CsrfPolicyOptions, TurnstileFailure, TurnstileVerifyOptions } from "../form/types";
import type { Logger } from "../logging/types";
import type { RequestLoggerOptions } from "../logging/types";
import type { JSXNode } from "../render/jsx/types";
import type { Result } from "../result/types";
import type { RouteParams } from "../router/types";
import type { OriginProtectionOptions } from "../security/types";
import type { RateLimitOptions } from "../security/types";
import type { SecurityHeadersOptions } from "../security/types";
import type { SessionMiddleware } from "../session/types";
import type { v } from "../validation/validation";
import type { Forge } from "./forge-app";
import type { PIPELINE_ONLY_KEYS } from "./pipeline";

/** How an app answers a method mismatch: `"notFound"` keeps the route unacknowledged, `"advertise"` returns the RFC 9110 `405` with `Allow`. @public */
export type MethodMismatch = "notFound" | "advertise";

/** Options for `createApp`; the wiring hooks run in the order they are numbered. @public */
export interface AppOptions<Bindings = Record<string, unknown>> {
  config?: object;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /** Takes the error handler's records only where no request logger is on the context; defaults to `createLogger("app")`. */
  logger?: Logger;
  /** The document shell every mounted page renders into; absent, forge renders a bare one. */
  shell?: PageShell<Bindings>;
  /** Wiring step 1 — register global middleware. */
  middleware?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 2 — register routes. */
  routes?: (app: Forge<Bindings & object>) => void;
  /** Renders an unmatched URL — the router's no-match path and the asset catch-all's misses alike. */
  notFound?: (c: AppContext<Bindings>, config: unknown) => Response | Promise<Response>;
  /** Answers a URL a pattern matched but no route's method did; defaults to `"notFound"`. */
  methodMismatch?: MethodMismatch;
  /** Wiring step 3 — late registrations that must precede the asset catch-all. */
  finalize?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 4 — registers the static-asset catch-all last. */
  assets?: boolean;
}

/** A route's `Cache-Control` policy. @public */
export interface CacheDirective {
  maxAge: number;
  /** Who may store the response; defaults to `"private"`, so only `"public"` lets a shared cache hold it. */
  scope?: "public" | "private";
}

/** Loader/view/action state for `definePage`/`defineAction`. @internal */
export interface RouteRenderState<LoaderData = unknown, ActionData = unknown> {
  data: LoaderData;
  actionData: ActionData;
  method: "GET" | "POST";
}

/** A page's data loader, run before its view, receiving the parsed query string as `query`. @internal */
export type RouteLoader<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
  LoaderData = unknown,
  Query = unknown,
> = (c: AppContext<Bindings, Params>, config: ConfigData, query: Query) => LoaderData | Response | Promise<LoaderData | Response>;

/** A page's renderer, receiving the loader and action state for the request. @internal */
export type RouteView<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
> = (c: AppContext<Bindings, Params>, config: ConfigData, state: RouteRenderState<LoaderData, ActionData>) => Response | Promise<Response>;

/** A page's mutation handler, receiving the validated body as `data`. @internal */
export type RouteAction<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
  ActionData = unknown,
  Data = unknown,
> = (c: AppContext<Bindings, Params>, config: ConfigData, data: Data) => ActionData | Response | Promise<ActionData | Response>;

/** The submission-pipeline options a page may state, all of which require a `schema`. @internal */
export type PagePipeline<
  S extends v.GenericSchema,
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
> = Omit<SubmissionPipelineDefinition<S, Bindings, Params, ConfigData>, "schema">;

/** The part of a page definition that stands independent of its optional schema. @internal */
export interface PageBase<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
  Q extends v.GenericSchema = v.GenericSchema,
> {
  /** The query-string schema, parsed from `c.url.searchParams` before the action and the loader on every method. */
  query?: Q;
  loader?: RouteLoader<Bindings, Params, ConfigData, LoaderData, v.InferOutput<Q>>;
  action?: RouteAction<Bindings, Params, ConfigData, ActionData, v.InferOutput<S>>;
  view: RouteView<Bindings, Params, ConfigData, LoaderData, ActionData>;
  headers?: Record<string, string>;
  cache?: "no-store" | CacheDirective;
  /** Called when `view` throws; receives the error and context. */
  onError?: (error: Error, c: AppContext<Bindings, Params>) => Response | Promise<Response>;
  /** Replaces the default `400` refusal for a query string `query` refused. */
  onQueryError?: (issues: readonly v.BaseIssue<unknown>[], c: AppContext<Bindings, Params>) => Response | Promise<Response>;
}

/** Declarative definition of a page route for `definePage`; pipeline options are gated on `schema`. @public */
export type PageDefinition<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
  Q extends v.GenericSchema = v.GenericSchema,
> = PageBase<Bindings, Params, ConfigData, LoaderData, ActionData, S, Q> &
  (
    | ({ schema: S } & PagePipeline<S, Bindings, Params, ConfigData>)
    | ({ schema?: never } & { [K in keyof PagePipeline<S, Bindings, Params, ConfigData>]?: never })
  );

/** Turnstile verification for one `defineAction` route. @public */
export interface ActionTurnstileOptions<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
> {
  /** Replaces the siteverify secret `readTurnstileKey` reads. */
  secretKey?: (c: AppContext<Bindings, Params>, config: ConfigData) => string | Promise<string>;
  /** The field Cloudflare's widget writes the token into. */
  tokenField?: string;
  /** Constraints merged over the defaults: the request's hostname and its `CF-Connecting-IP`. */
  verify?: (c: AppContext<Bindings, Params>, config: ConfigData) => Partial<Omit<TurnstileVerifyOptions, "tokenField">>;
}

/** Why a `defineAction` route refused a submission before it reached the schema. @public */
export type BotRejection = { guard: "turnstile"; reason: TurnstileFailure };

/** Declarative definition of a mutation route for `defineAction`. @public */
export interface ActionDefinition<
  S extends v.GenericSchema,
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
> {
  /** The body schema; prefer `v.strictObject`, which refuses an undeclared field rather than dropping it. */
  schema: S;
  handle: (data: v.InferOutput<S>, c: AppContext<Bindings, Params>, config: ConfigData) => Response | Promise<Response>;
  /** Limits keyed by identity or route params, spent in order ahead of Turnstile; one refusal ends the submission. */
  rateLimit?: RateLimitOptions<Bindings> | readonly RateLimitOptions<Bindings>[];
  /** Replaces the default validation-errors fragment. */
  onValidationError?: (issues: readonly v.BaseIssue<unknown>[], c: AppContext<Bindings, Params>) => Response | Promise<Response>;
  onError?: (error: Error, c: AppContext<Bindings, Params>) => Response | Promise<Response>;
  /** Turnstile verification for this route; the pipeline consumes and drops the token field. */
  turnstile?: ActionTurnstileOptions<Bindings, Params, ConfigData>;
  /** Replaces the refusal a tripped guard renders. */
  onBotDetected?: (rejection: BotRejection, c: AppContext<Bindings, Params>) => Response | Promise<Response>;
  /** Body-size cap for this route's form parse, in bytes; the app's CSRF policy parses first, under its own `maxBytes`. */
  maxBytes?: number;
}

/** The fetch surface of Cloudflare's static-asset binding. @public */
export interface AssetsFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/** Options for `healthCheck`. @public */
export interface HealthCheckOptions {
  timeoutMs?: number;
}

/** One named probe a health route runs. @public */
export type HealthCheckFn<Bindings = Record<string, unknown>> = (c: AppContext<Bindings>) => boolean | Promise<boolean>;

/** A health route's merged, frozen checks and the handler that runs them on every request. @public */
export interface HealthChecks<Bindings = Record<string, unknown>> {
  checks: () => Readonly<Record<string, HealthCheckFn<Bindings>>>;
  handler: (options?: HealthCheckOptions) => RequestHandler;
}

/** The aggregate verdict of a health endpoint's registered checks. @public */
export interface HealthCheckResult {
  ok: boolean;
  checks: Record<string, boolean>;
}

/** One `use()` registration: its handlers and the paths they run for. @internal */
export interface GlobalMiddlewareEntry {
  /** Precompiled path matcher, or `null` to match every request. */
  matcher: Matcher<string> | MultiMatcher<null> | null;
  handlers: readonly Middleware[];
}

/** Per-request state injected via a `WeakMap` keyed by the request. @internal */
export interface RequestState<Bindings> {
  env: Bindings;
  executionCtx: ExecutionContext;
  config: unknown;
}

/** A bindings shape that may carry a static-asset binding. @internal */
export type HasAssets = { ASSETS?: AssetsFetcher };

/** Options for `createErrorPage`. @public */
export interface ErrorPageOptions<Bindings = Record<string, unknown>> {
  /** Page `<title>` and heading. */
  title?: string;
  /** Stylesheet `<link>` href, static or resolved per request. */
  stylesheetHref?: string | ((c: AppContext<Bindings>) => string);
  /** "Back to safety" link rendered under the error banner. */
  homeHref?: string;
}

/** The handler a builder returns for `R`, typed so `createController` refuses it on a route whose params differ. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- any method and any pattern are both route shapes
export type RouteHandler<R extends Route<any, any>> = RequestHandler<RequestContext<RouteParams<R>>>;

/** Pre-bound `definePage`/`defineAction` pair returned by `createHandlerFactory`. @public */
export interface HandlerFactory<Bindings = Record<string, unknown>, ConfigData = unknown> {
  definePage: <
    // oxlint-disable-next-line typescript/no-explicit-any -- any method and any pattern are both route shapes
    R extends Route<any, any>,
    LoaderData = unknown,
    ActionData = unknown,
    S extends v.GenericSchema = v.GenericSchema,
    Q extends v.GenericSchema = v.GenericSchema,
  >(
    route: R,
    def: PageDefinition<Bindings, RouteParams<R>, ConfigData, LoaderData, ActionData, S, Q>,
  ) => RouteHandler<R>;
  // oxlint-disable-next-line typescript/no-explicit-any -- any method and any pattern are both route shapes
  defineAction: <R extends Route<any, any>, S extends v.GenericSchema>(
    route: R,
    def: ActionDefinition<S, Bindings, RouteParams<R>, ConfigData>,
  ) => RouteHandler<R>;
}

/** A tag `PageMeta` has no field for, rendered verbatim. @public */
export type MetaTag =
  | { readonly name: string; readonly content: string }
  | { readonly property: string; readonly content: string }
  | { readonly tagName: "link"; readonly rel: string; readonly href: string };

/** One token of a `robots` value; give an array for a compound directive. @public */
export type RobotsDirective = "index" | "noindex" | "follow" | "nofollow" | "noarchive" | "nosnippet" | "noimageindex";

/** The `og:type` values a page is likely to claim. @public */
export type OgType = "website" | "article" | "profile";

/** What one page says about itself in `<head>`. @public */
export interface PageMeta {
  /** The `<title>`, and the default for `og:title` and `twitter:title`. */
  readonly title: string;
  readonly description?: string;
  /** Absolute and never derived — behind a proxy `c.url` is not the public URL. Dropped under a `noindex` `robots`, never one in `extra`. */
  readonly canonical?: string;
  readonly robots?: RobotsDirective | readonly RobotsDirective[];
  readonly og?: {
    readonly title?: string;
    readonly description?: string;
    readonly type?: OgType;
    /** Absolute URL — a relative one is dropped by every crawler that reads it. */
    readonly image?: string;
    readonly url?: string;
  };
  readonly twitter?: { readonly card?: "summary" | "summary_large_image"; readonly title?: string; readonly description?: string };
  /** Structured data, serialised into a nonce-bearing `application/ld+json` script. */
  readonly jsonLd?: unknown;
  /** Appended verbatim, in order, after every tag above — never deduplicated against them. */
  readonly extra?: readonly MetaTag[];
}

/** What `metaTags` needs from the request. @public */
export interface MetaOptions {
  /** This request's CSP nonce, from `getNonce(c)`; without it `jsonLd` renders no script. */
  readonly nonce?: string;
}

/** One per-path guard group in `MiddlewareChainOptions.guards`. @public */
export interface MiddlewareGuardGroup<Bindings = Record<string, unknown>> {
  /** Path patterns, as accepted by `app.use`, the group applies to. */
  paths: readonly string[];
  /** Path patterns, in the same syntax, the group skips even where `paths` matches. */
  exclude?: readonly string[];
  /** Request-shape guards — method, content type — run ahead of `origin`. */
  shape?: Middleware[];
  /** Origin/Referer verification policy for state-changing routes. */
  origin?: OriginProtectionOptions<Bindings>;
  /** Rate-limit policy, keyed under the chain's trust in the CF headers; an array stacks limits, run in order. */
  rateLimit?: RateLimitOptions<Bindings> | readonly RateLimitOptions<Bindings>[];
  /** Prebuilt guards, chained after `origin`, `rateLimit` and the verification a chain `csrf` policy armed. */
  guards?: Middleware[];
  /** Answers this group's origin and rate-limit refusals a stage's own hook declines or lacks, and the CSRF refusal of a request it is the last-registered verifying group to match, declining with `undefined` to the chain's `onRefuse`. */
  onRefuse?: RefuseHook<Bindings>;
  /** Sample URLs, one per route this group's owner mints a CSRF token on; the chain refuses them at registration as it does a contribution's `csrfCovers`, so they survive a spread of the group into another contribution. */
  csrfCovers?: readonly string[];
}

/** The panel a refusal is answered with, and the message the announcer speaks when it arrives. @public */
export interface RefusalPanel {
  readonly message: string;
  readonly panel: JSXNode;
}

/** What `refuseAsFragment` swaps a refusal into, and how it renders the panel. @public */
export interface RefuseAsFragmentOptions<Bindings = Record<string, unknown>> {
  /** The CSS selector sent as `HX-Retarget`, since the request's own target is the form it submitted. */
  readonly target: string;
  /** Sent as `HX-Reswap`; defaults to `innerHTML`. */
  readonly swap?: string;
  readonly render: (c: AppContext<Bindings>, refusal: Refusal) => RefusalPanel | Promise<RefusalPanel>;
}

/** A `globals` entry that skips every request one of its `exclude` patterns matches. @public */
export interface MiddlewareGlobal {
  middleware: Middleware;
  /** Path patterns, as accepted by `app.use`. */
  exclude: readonly string[];
}

/** The app's one CSRF policy: minted on every request its `paths` match outside its `exclude`, verified after that request's origin check and rate limit. @public */
export interface MiddlewareCsrfPolicy<Bindings = Record<string, unknown>> extends CsrfPolicyOptions<Bindings> {
  /** Path patterns, as accepted by `app.use`, the policy mints on. Defaults to `["*"]`. */
  readonly paths?: readonly string[];
  /** Path patterns, in the same syntax, the policy skips even where `paths` matches: nothing is minted or verified there. */
  readonly exclude?: readonly string[];
  /** Path patterns, in the same syntax, whose tokens carry no subject: decided by the token's target path, at mint and at verify. */
  readonly unboundPaths?: readonly string[];
}

/** Declarative input to `applyMiddlewareChain`. @public */
export interface MiddlewareChainOptions<Bindings = Record<string, unknown>> {
  /** Registered on `"*"` ahead of everything but the published `trustCfHeaders`, `onRefuse` and `rateLimits`, `requestId` included — for tracing that must wrap the whole chain. */
  before?: Middleware[];
  /** Adds `requestId()` first in the chain, after `before`. */
  requestId?: boolean;
  /** Trust Cloudflare-injected request headers, for `requestId` and every rate limit on the request; only safe when the Worker is known to run behind Cloudflare. */
  trustCfHeaders?: boolean;
  /** Answers every guard refusal no group or guard answers itself; without it, each guard's plain-text default. */
  onRefuse?: RefuseHook<Bindings>;
  logging?: RequestLoggerOptions<Bindings>;
  securityHeaders: SecurityHeadersOptions;
  /** Env schema for `validateBindings`; a valibot object schema wherever a guard group names a binding it declares. */
  bindings?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  /** The generated `RATELIMITS`, published on every request; every binding a guard group or route limit names must be a key of it. */
  rateLimits?: Readonly<Record<string, { limit: number; period: number }>>;
  /** Registered on `"*"`; a request it leaves without a session on `sessionCtx` throws. */
  session?: SessionMiddleware;
  /** The app's one CSRF policy, minted right after `session` and verified after the request's origin check and rate limit. */
  csrf?: MiddlewareCsrfPolicy<NoInfer<Bindings>>;
  /** Registered on `"*"` after `session` and before the guard groups — where anything reading the session belongs. */
  globals?: (Middleware | MiddlewareGlobal)[];
  /** Per-path guard groups, registered after the global chain. */
  guards?: MiddlewareGuardGroup<Bindings>[];
  /** Each owner's bindings, session, globals and guards, merged after this object's own in array order. */
  contributions?: readonly MiddlewareContribution<Bindings>[];
}

/** What one owner adds to the global chain: the bindings it refuses to serve without, its session, its global and per-path guards, how long it needs the session cookie to last, and the paths it needs the CSRF policy to mint on. @public */
export interface MiddlewareContribution<Bindings = Record<string, unknown>> {
  bindings?: readonly BindingSpec[] | undefined;
  session?: SessionMiddleware | undefined;
  globals?: readonly (Middleware | MiddlewareGlobal)[] | undefined;
  guards?: readonly MiddlewareGuardGroup<Bindings>[] | undefined;
  /** The shortest session cookie `maxAge`, in milliseconds, this owner serves under; the chain refuses at registration a session slot whose cookie is shorter or sets none. */
  sessionMaxAgeAtLeastMs?: number | undefined;
  /** Sample URLs, one per route this owner mints a CSRF token on; the chain refuses at registration a CSRF policy whose `paths` miss one or whose `exclude` matches one, and no CSRF policy at all. */
  csrfCovers?: readonly string[] | undefined;
  /** Refused: the app root owns the CSRF policy, so it goes on `MiddlewareChainOptions.csrf`. */
  readonly csrf?: never;
}

/** One app's named contribution slots, each a frozen list in contribution order. @public */
export interface ContributionSlots<Shape extends object> {
  contributions: <K extends keyof Shape & string>(slot: K) => readonly Shape[K][];
}

/** The half of a mutation route's definition the shared submission pipeline consumes. @internal */
export type SubmissionPipelineDefinition<
  S extends v.GenericSchema,
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
> = Pick<ActionDefinition<S, Bindings, Params, ConfigData>, "schema" | (typeof PIPELINE_ONLY_KEYS)[number]>;

/** One request through read → drop → guard → validate, resolving to the validated body or the refusal that replaces it. @internal */
export type SubmissionPipeline<
  S extends v.GenericSchema,
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  ConfigData = unknown,
> = (c: AppContext<Bindings, Params>, config: ConfigData) => Promise<Result<v.InferOutput<S>, Response>>;

/** Which mount and page a shell is wrapping, so one shell can vary its chrome. @public */
export interface ShellSlot {
  /** The mountable rendering this page — `auth`, `logs`, or a consumer's own. */
  readonly mount: string;
  /** Which page of that mount, in the mount's own vocabulary. */
  readonly page: string;
  /** What this page says about itself in `<head>`, the mount's own copy resolved. */
  readonly meta: PageMeta;
}

/** The app's document shell, registered once and resolved per request. @public */
export type PageShell<Bindings = Record<string, unknown>> = (
  c: AppContext<Bindings>,
  content: JSXNode,
  slot: ShellSlot,
) => JSXNode | Promise<JSXNode>;

/** The chrome `pageShell` renders around a mount's content. @public */
export interface ShellDocument {
  /** Stylesheets to link; without one the page renders unstyled, since forge ships no URL it could guess. */
  readonly stylesheet?: string | readonly string[];
  /** Scripts to load as modules from `<head>`; a module script is deferred, so it runs after the document parses. */
  readonly script?: string | readonly string[];
  /** `<html lang>`. Defaults to `en`. */
  readonly lang?: string;
}

/** The message an error page discloses for `error`, or `undefined` to show the fixed page. @internal */
export type RelaxErrorDisclosure = (error: Error) => string | undefined;
