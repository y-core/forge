import type { Middleware } from "@remix-run/fetch-router";
import type { Matcher } from "@remix-run/route-pattern/match";
import type { AppContext } from "../context/types";
import type { TurnstileFailure, TurnstileVerifyOptions } from "../form/types";
import type { Logger } from "../logging/types";
import type { v } from "../validation/validation";
import type { Forge } from "./forge-app";
import type { SubmissionPipelineDefinition } from "./pipeline";

/** Options for `createApp`; the wiring hooks run in the order they are numbered. @public */
export interface AppOptions<Bindings = Record<string, unknown>> {
  config?: object;
  isDebug?: (c: AppContext<Bindings>) => boolean;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /** Custom logger injected into the app error handler. */
  logger?: Logger;
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

/** Declarative definition of a page route for `definePage`. @public */
export interface PageDefinition<
  Bindings = Record<string, unknown>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
> extends Omit<SubmissionPipelineDefinition<S, Bindings, ConfigData>, "schema"> {
  loader?: RouteLoader<Bindings, ConfigData, LoaderData>;
  /** The body schema for this page's own mutations, which puts `action` behind the shared submission sequence. */
  schema?: S;
  action?: RouteAction<Bindings, ConfigData, ActionData, v.InferOutput<S>>;
  view: RouteView<Bindings, ConfigData, LoaderData, ActionData>;
  headers?: Record<string, string>;
  cache?: "no-store" | CacheDirective;
  /** Called when `view` throws; receives the error and context. */
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
}

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
export type BotRejection = { guard: "honeypot" } | { guard: "turnstile"; reason: TurnstileFailure };

/** Declarative definition of a mutation route for `defineAction`. @public */
export interface ActionDefinition<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> {
  /** The body schema; prefer the `validation` namespace's `strictObject`. */
  schema: S;
  handle: (data: v.InferOutput<S>, c: AppContext<Bindings>, config: ConfigData) => Response | Promise<Response>;
  /** Replaces the default validation-errors fragment. */
  onValidationError?: (issues: readonly v.BaseIssue<unknown>[], c: AppContext<Bindings>) => Response | Promise<Response>;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /** The field carrying this route's honeypot decoy, which the pipeline checks and then drops. */
  honeypot?: string;
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
  matcher: Matcher<string> | null;
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
