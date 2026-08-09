import type { Middleware } from "@remix-run/fetch-router";
import type { Matcher } from "@remix-run/route-pattern/match";
import type { AppContext } from "../context/types";
import type { TurnstileFailure, TurnstileVerifyOptions } from "../form/types";
import type { Logger } from "../logging/types";
import type { v } from "../validation/validation";
import type { Forge } from "./forge-app";
import type { SubmissionPipelineDefinition } from "./pipeline";

/** @public */
export interface AppOptions<Bindings = Record<string, unknown>> {
  config?: object;
  isDebug?: (c: AppContext<Bindings>) => boolean;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /** Custom logger injected into the app error handler. */
  logger?: Logger;
  /** Wiring step 1 — register global middleware (e.g. via `applyMiddlewareChain`). */
  middleware?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 2 — register routes (`app.map` calls). */
  routes?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 3 — late registrations (e.g. dev-only routes) that must precede the asset catch-all. */
  finalize?: (app: Forge<Bindings & object>) => void;
  /** Wiring step 4 — registers the static-asset catch-all last, so real routes always win. */
  assets?: AssetOptions<Bindings>;
}

/** @public */
export interface CacheDirective {
  maxAge: number;
  scope?: "public" | "private";
}

/** @internal — loader/view/action state for definePage/defineAction. */
export interface RouteRenderState<LoaderData = unknown, ActionData = unknown> {
  data: LoaderData;
  actionData: ActionData;
  method: "GET" | "POST";
}

/** @internal */
export type RouteLoader<Bindings = Record<string, unknown>, ConfigData = unknown, LoaderData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
) => LoaderData | Response | Promise<LoaderData | Response>;

/** @internal */
export type RouteView<Bindings = Record<string, unknown>, ConfigData = unknown, LoaderData = unknown, ActionData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
  state: RouteRenderState<LoaderData, ActionData>,
) => Response | Promise<Response>;

/**
 * `data` is the page's validated body, and is meaningful only on a page that declares a `schema`.
 * It comes last because that is where this family already puts its payload — `view` takes its render
 * state in the same position, and an action written before the schema existed keeps compiling.
 *
 * @internal
 */
export type RouteAction<Bindings = Record<string, unknown>, ConfigData = unknown, ActionData = unknown, Data = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
  data: Data,
) => ActionData | Response | Promise<ActionData | Response>;

/**
 * Everything the shared submission sequence consumes is inherited rather than restated, so a page and
 * an action configure that sequence through one set of options with one set of docs. Only `schema`
 * is projected out: an action must declare one, a page may, and a page that declares none keeps
 * running its action against the unparsed context.
 *
 * @public
 */
export interface PageDefinition<
  Bindings = Record<string, unknown>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
> extends Omit<SubmissionPipelineDefinition<S, Bindings, ConfigData>, "schema"> {
  loader?: RouteLoader<Bindings, ConfigData, LoaderData>;
  /**
   * The body schema for this page's own mutations. Declaring it *alongside an `action`* routes every
   * non-GET request through the same read → guard → validate sequence `defineAction` runs, so
   * `action` is reachable only with a body that passed it and receives the parsed result as its
   * third argument.
   *
   * A schema without an `action` runs no sequence at all — no read, no guard, no validation — and
   * the request renders the view as any other would. The sequence exists to protect a terminal step,
   * and a page with nothing to run on a mutation has none to protect.
   *
   * Omitting the schema leaves the page as it was: `action` runs against the unparsed context and
   * owns validation at its own boundary.
   */
  schema?: S;
  action?: RouteAction<Bindings, ConfigData, ActionData, v.InferOutput<S>>;
  view: RouteView<Bindings, ConfigData, LoaderData, ActionData>;
  headers?: Record<string, string>;
  cache?: "no-store" | CacheDirective;
  /** Called when `view` throws; receives the error and context. */
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
}

/**
 * Turnstile verification for one `defineAction` route.
 *
 * `tokenField` is fixed when the route is defined, because the pipeline drops that field whether or
 * not verification ever reaches the network. `secretKey` and `verify` resolve per request, because a
 * secret lives in a binding rather than in the route, and the hostname a token must have been minted
 * on is usually the request's own. `tokenField` is deliberately absent from what `verify` returns —
 * two spellings of one name, with only one of them consulted, is the defect this option removes.
 *
 * @public
 */
export interface ActionTurnstileOptions<Bindings = Record<string, unknown>, ConfigData = unknown> {
  /** Resolves the siteverify secret for this request. */
  secretKey: (c: AppContext<Bindings>, config: ConfigData) => string | Promise<string>;
  /** The field Cloudflare's widget writes the token into. Defaults to `TURNSTILE_FIELD_DEFAULT`. */
  tokenField?: string;
  /** Verification constraints for this request. `expectedHostname` is required — it is what stops a token solved elsewhere being replayed here. */
  verify: (c: AppContext<Bindings>, config: ConfigData) => Omit<TurnstileVerifyOptions, "tokenField">;
}

/**
 * Why a `defineAction` route refused a submission before it reached the schema.
 *
 * A `network-error` or `timeout` reason means the siteverify call failed, not that the caller is a
 * bot. The refusal is the same either way — a CAPTCHA that cannot be checked fails closed — but an
 * app reading the reason can tell an outage from an attack.
 *
 * @public
 */
export type BotRejection = { guard: "honeypot" } | { guard: "turnstile"; reason: TurnstileFailure };

/**
 * The schema is the only way in: `defineAction` reads the body itself, and `handle` is unreachable
 * except through a passing `v.safeParse` of `schema`.
 *
 * It replaces a `parse`/`validate` pair of arbitrary callbacks. That pair fixed the *order* the two
 * ran in and nothing more — neither was required to involve a schema, so `validate: (d) => ok(d)`
 * compiled and was accepted, and a route could declare a validation step that validated nothing.
 * Naming the schema instead makes the guarantee a property of the type rather than of a convention
 * each call site has to keep.
 *
 * @public
 */
export interface ActionDefinition<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> {
  /**
   * The body schema. Prefer the `validation` namespace's `strictObject`: it is what turns a field
   * nobody declared into a refusal rather than a value silently dropped on the way to `handle`.
   */
  schema: S;
  handle: (data: v.InferOutput<S>, c: AppContext<Bindings>, config: ConfigData) => Response | Promise<Response>;
  /**
   * Replaces the default validation-errors fragment. It receives the issues rather than formatted
   * strings, because a valibot issue embeds the rejected value and the caller's own key — so how
   * much of a caller's text travels back in a refusal is a decision only the app can make.
   */
  onValidationError?: (issues: readonly v.BaseIssue<unknown>[], c: AppContext<Bindings>) => Response | Promise<Response>;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /**
   * The field carrying this route's honeypot decoy — the same value the view gave
   * `<Honeypot field={…} />`, best held as one app-owned constant referenced by both. Naming it here
   * is what checks the decoy *and* drops it, so the schema never has to declare a field no human
   * fills.
   *
   * There is no default and no shorthand, because a decoy only works while its name is unguessable:
   * a name forge could supply is a name every bot already knows to skip.
   */
  honeypot?: string;
  /**
   * Turnstile verification for this route. The pipeline consumes the token, so it also drops the
   * token field — the schema is never asked to declare it.
   */
  turnstile?: ActionTurnstileOptions<Bindings, ConfigData>;
  /**
   * Replaces the refusal a tripped guard renders. The default answer says nothing about the guard,
   * so a bot learns neither which one it tripped nor that one is there; an app that would rather
   * ban, log or stall supplies this.
   */
  onBotDetected?: (rejection: BotRejection, c: AppContext<Bindings>) => Response | Promise<Response>;
  /**
   * Body-size cap for this route's form parse, in bytes. Defaults to `FORM_MAX_BYTES_DEFAULT`.
   * A CSRF guard on the same route parses the body first, so raising this above the default also
   * requires raising `csrfProtection`'s own `maxBytes`.
   */
  maxBytes?: number;
}

/** @public */
export interface AssetsFetcher {
  fetch(req: Request): Promise<Response>;
}

/** @public */
export interface AssetOptions<Bindings = Record<string, unknown>> {
  notFoundView: (c: AppContext<Bindings>, config: unknown) => Response | Promise<Response>;
}

/** @public */
export interface HealthCheckResult {
  ok: boolean;
  checks: Record<string, boolean>;
}

/** @internal */
export interface GlobalMiddlewareEntry {
  /** Precompiled path matcher, or `null` to match every request (`"*"`). */
  matcher: Matcher<string> | null;
  handler: Middleware;
}

/** Per-request state injected via a `WeakMap` keyed by the request, avoiding per-request closures. @internal */
export interface RequestState<Bindings> {
  env: Bindings;
  executionCtx: ExecutionContext;
  config: unknown;
}

/** @internal */
export type HasAssets = { ASSETS?: AssetsFetcher };

/** @internal */
export type CheckFn<Bindings = Record<string, unknown>> = (c: AppContext<Bindings>) => boolean | Promise<boolean>;
