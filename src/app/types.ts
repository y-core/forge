import type { Middleware } from "@remix-run/fetch-router";
import type { Matcher, MultiMatcher } from "@remix-run/route-pattern/match";

import type { AppContext } from "../context/types";
import type { TurnstileFailure, TurnstileVerifyOptions } from "../form/types";
import type { JSXNode } from "../jsx/types";
import type { Logger } from "../logging/types";
import type { RequestLoggerOptions } from "../logging/types";
import type { Result } from "../result/types";
import type { OriginProtectionOptions } from "../security/types";
import type { RateLimitOptions } from "../security/types";
import type { SecurityHeadersOptions } from "../security/types";
import type { v } from "../validation/validation";
import type { defineAction } from "./action";
import type { Forge } from "./forge-app";
import type { definePage } from "./page";
import type { PIPELINE_ONLY_KEYS } from "./pipeline";

/** Options for `createApp`; the wiring hooks run in the order they are numbered. @public */
export interface AppOptions<Bindings = Record<string, unknown>> {
  config?: object;
  isDebug?: (c: AppContext<Bindings>) => boolean;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /** Custom logger injected into the app error handler. */
  logger?: Logger;
  /** The document shell every mounted page renders into; absent, forge renders a bare one. */
  shell?: PageShell<Bindings>;
  /** Wiring step 1 — register global middleware. */
  middleware?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 2 — register routes. */
  routes?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 3 — late registrations that must precede the asset catch-all. */
  finalize?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 4 — registers the static-asset catch-all last. */
  assets?: AssetOptions<Bindings>;
}

/** A route's `Cache-Control` policy. @public */
export interface CacheDirective {
  maxAge: number;
  scope?: "public" | "private";
}

/** Loader/view/action state for `definePage`/`defineAction`. @internal */
export interface RouteRenderState<LoaderData = unknown, ActionData = unknown> {
  data: LoaderData;
  actionData: ActionData;
  method: "GET" | "POST";
}

/** A page's data loader, run before its view. @internal */
export type RouteLoader<Bindings = Record<string, unknown>, ConfigData = unknown, LoaderData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
) => LoaderData | Response | Promise<LoaderData | Response>;

/** A page's renderer, receiving the loader and action state for the request. @internal */
export type RouteView<Bindings = Record<string, unknown>, ConfigData = unknown, LoaderData = unknown, ActionData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
  state: RouteRenderState<LoaderData, ActionData>,
) => Response | Promise<Response>;

/** A page's mutation handler, receiving the validated body as `data`. @internal */
export type RouteAction<Bindings = Record<string, unknown>, ConfigData = unknown, ActionData = unknown, Data = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
  data: Data,
) => ActionData | Response | Promise<ActionData | Response>;

/** The submission-pipeline options a page may state, all of which require a `schema`. @internal */
export type PagePipeline<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> = Omit<
  SubmissionPipelineDefinition<S, Bindings, ConfigData>,
  "schema"
>;

/** The part of a page definition that stands independent of its optional schema. @internal */
export interface PageBase<
  Bindings = Record<string, unknown>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
> {
  loader?: RouteLoader<Bindings, ConfigData, LoaderData>;
  action?: RouteAction<Bindings, ConfigData, ActionData, v.InferOutput<S>>;
  view: RouteView<Bindings, ConfigData, LoaderData, ActionData>;
  headers?: Record<string, string>;
  cache?: "no-store" | CacheDirective;
  /** Called when `view` throws; receives the error and context. */
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
}

/** Declarative definition of a page route for `definePage`; pipeline options are gated on `schema`. @public */
export type PageDefinition<
  Bindings = Record<string, unknown>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
> = PageBase<Bindings, ConfigData, LoaderData, ActionData, S> &
  (({ schema: S } & PagePipeline<S, Bindings, ConfigData>) | ({ schema?: never } & { [K in keyof PagePipeline<S, Bindings, ConfigData>]?: never }));

/** Turnstile verification for one `defineAction` route. @public */
export interface ActionTurnstileOptions<Bindings = Record<string, unknown>, ConfigData = unknown> {
  /** Resolves the siteverify secret for this request. */
  secretKey: (c: AppContext<Bindings>, config: ConfigData) => string | Promise<string>;
  /** The field Cloudflare's widget writes the token into. */
  tokenField?: string;
  /** Verification constraints for this request; `expectedHostname` is what stops a token solved elsewhere being replayed here. */
  verify: (c: AppContext<Bindings>, config: ConfigData) => Omit<TurnstileVerifyOptions, "tokenField">;
}

/** Why a `defineAction` route refused a submission before it reached the schema. @public */
export type BotRejection = { guard: "turnstile"; reason: TurnstileFailure };

/** Declarative definition of a mutation route for `defineAction`. @public */
export interface ActionDefinition<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> {
  /** The body schema; prefer the `validation` namespace's `strictObject`. */
  schema: S;
  handle: (data: v.InferOutput<S>, c: AppContext<Bindings>, config: ConfigData) => Response | Promise<Response>;
  /** Replaces the default validation-errors fragment. */
  onValidationError?: (issues: readonly v.BaseIssue<unknown>[], c: AppContext<Bindings>) => Response | Promise<Response>;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /** Turnstile verification for this route; the pipeline consumes and drops the token field. */
  turnstile?: ActionTurnstileOptions<Bindings, ConfigData>;
  /** Replaces the refusal a tripped guard renders. */
  onBotDetected?: (rejection: BotRejection, c: AppContext<Bindings>) => Response | Promise<Response>;
  /**
   * Body-size cap for this route's form parse, in bytes. A CSRF guard on the same route parses the
   * body first, so raising this also requires raising `csrfProtection`'s own `maxBytes`.
   */
  maxBytes?: number;
}

/** The fetch surface of Cloudflare's static-asset binding. @public */
export interface AssetsFetcher {
  fetch(req: Request): Promise<Response>;
}

/** Configures the static-asset catch-all registered last. @public */
export interface AssetOptions<Bindings = Record<string, unknown>> {
  notFoundView: (c: AppContext<Bindings>, config: unknown) => Response | Promise<Response>;
}

/** The aggregate verdict of a health endpoint's registered checks. @public */
export interface HealthCheckResult {
  ok: boolean;
  checks: Record<string, boolean>;
}

/** One registered global middleware and the paths it runs for. @internal */
export interface GlobalMiddlewareEntry {
  /** Precompiled path matcher, or `null` to match every request. */
  matcher: Matcher<string> | MultiMatcher<null> | null;
  handler: Middleware;
}

/** Per-request state injected via a `WeakMap` keyed by the request. @internal */
export interface RequestState<Bindings> {
  env: Bindings;
  executionCtx: ExecutionContext;
  config: unknown;
}

/** A bindings shape that may carry a static-asset binding. @internal */
export type HasAssets = { ASSETS?: AssetsFetcher };

/** One named health check. @internal */
export type CheckFn<Bindings = Record<string, unknown>> = (c: AppContext<Bindings>) => boolean | Promise<boolean>;

/** Options for `createErrorPage`. @public */
export interface ErrorPageOptions<Bindings = Record<string, unknown>> {
  /** Show the real error message when it returns `true`. */
  isDebug?: (c: AppContext<Bindings>) => boolean;
  /** Page `<title>` and heading. */
  title?: string;
  /** Stylesheet `<link>` href, static or resolved per request. */
  stylesheetHref?: string | ((c: AppContext<Bindings>) => string);
  /** "Back to safety" link rendered under the error banner. */
  homeHref?: string;
}

/** Pre-bound `definePage`/`defineAction` pair returned by `createHandlerFactory`. @public */
export interface HandlerFactory<Bindings = Record<string, unknown>, ConfigData = unknown> {
  definePage: <LoaderData = unknown, ActionData = unknown, S extends v.GenericSchema = v.GenericSchema>(
    def: PageDefinition<Bindings, ConfigData, LoaderData, ActionData, S>,
  ) => ReturnType<typeof definePage>;
  defineAction: <S extends v.GenericSchema>(def: ActionDefinition<S, Bindings, ConfigData>) => ReturnType<typeof defineAction>;
}

/** A tag `PageMeta` has no field for, rendered verbatim. @public */
export type MetaTag =
  | { readonly name: string; readonly content: string }
  | { readonly property: string; readonly content: string }
  | { readonly tagName: "link"; readonly rel: string; readonly href: string };

// A compound value is the common case — `noindex, nofollow` — so the union is over tokens rather
// than over whole values, which would have to widen to `string` the first time two were needed.
/** One token of a `robots` value; give an array for a compound directive. @public */
export type RobotsDirective = "index" | "noindex" | "follow" | "nofollow" | "noarchive" | "nosnippet" | "noimageindex";

/** The `og:type` values a page is likely to claim. @public */
export type OgType = "website" | "article" | "profile";

/** What one page says about itself in `<head>`. @public */
export interface PageMeta {
  /** The `<title>`, and the default for `og:title` and `twitter:title`. */
  readonly title: string;
  readonly description?: string;
  /** Absolute URL. Forge derives none: behind a proxy a Worker's own `c.url` is not the public one. */
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
  // A field rather than an `extra` entry: forge ships `script-src 'self'`, so the inline script
  // needs this request's nonce, which `metaTags` is given and an `extra` entry could not receive.
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
  /** Origin/Referer verification for state-changing routes. */
  origin?: OriginProtectionOptions<Bindings>;
  /** Cloudflare rate-limit binding enforcement. */
  rateLimit?: RateLimitOptions<Bindings>;
  /** Prebuilt guards, registered after `origin` and `rateLimit`. */
  middleware?: Middleware[];
}

/** Declarative input to `applyMiddlewareChain`. @public */
export interface MiddlewareChainOptions<Bindings = Record<string, unknown>> {
  /** Adds `requestId()` first in the chain. */
  requestId?: boolean;
  /** Trust Cloudflare-injected request headers; only safe when the Worker is known to run behind Cloudflare. */
  trustCfHeaders?: boolean;
  /** Per-request structured logging. */
  logging?: RequestLoggerOptions<Bindings>;
  /** Security-header policy. */
  securityHeaders: SecurityHeadersOptions;
  /** Env schema for `validateBindings`. */
  bindings?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  /** Prebuilt session middleware. */
  session?: Middleware;
  /** Per-path guard groups, registered after the global chain. */
  guards?: MiddlewareGuardGroup<Bindings>[];
}

/** The half of a mutation route's definition the shared submission pipeline consumes. @internal */
export type SubmissionPipelineDefinition<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> = Pick<
  ActionDefinition<S, Bindings, ConfigData>,
  "schema" | (typeof PIPELINE_ONLY_KEYS)[number]
>;

/** One request through read → drop → guard → validate, resolving to the validated body or the refusal that replaces it. @internal */
export type SubmissionPipeline<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
) => Promise<Result<v.InferOutput<S>, Response>>;

// Open on purpose: a closed union of mount names would make every mountable forge adds later a
// breaking change for every shell a consumer has already written.
/** Which mount and page a shell is wrapping, so one shell can vary its chrome. @public */
export interface ShellSlot {
  /** The mountable rendering this page — `auth`, `showcase`, `logs`, or a consumer's own. */
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
  /** Scripts to load as modules at the end of `<body>`. */
  readonly script?: string | readonly string[];
  /** `<html lang>`. Defaults to `en`. */
  readonly lang?: string;
}
