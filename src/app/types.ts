import type { Middleware } from "@remix-run/fetch-router";
import type { Matcher } from "@remix-run/route-pattern/match";
import type { AppContext } from "../context/types";
import type { ReadonlyFormData } from "../form/types";
import type { Logger } from "../logging/types";
import type { ValidationResult } from "../result/result";

/** @public */
export interface AppOptions<Bindings = Record<string, unknown>> {
  config?: object;
  isDebug?: (c: AppContext<Bindings>) => boolean;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  /** Custom logger injected into the app error handler. */
  logger?: Logger;
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

/** @internal */
export type RouteAction<Bindings = Record<string, unknown>, ConfigData = unknown, ActionData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
) => ActionData | Response | Promise<ActionData | Response>;

/** @public */
export interface PageDefinition<Bindings = Record<string, unknown>, ConfigData = unknown, LoaderData = unknown, ActionData = unknown> {
  loader?: RouteLoader<Bindings, ConfigData, LoaderData>;
  action?: RouteAction<Bindings, ConfigData, ActionData>;
  view: RouteView<Bindings, ConfigData, LoaderData, ActionData>;
  headers?: Record<string, string>;
  cache?: "no-store" | CacheDirective;
  /** Called when `view` throws; receives the error and context. */
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
}

/** @public */
export interface ActionDefinition<Input, Bindings = Record<string, unknown>, ConfigData = unknown> {
  parse: (formData: ReadonlyFormData) => Input;
  validate: (data: Input) => ValidationResult<Input>;
  handle: (data: Input, c: AppContext<Bindings>, config: ConfigData) => Response | Promise<Response>;
  onValidationError?: (errors: string[], c: AppContext<Bindings>) => Response | Promise<Response>;
  onError?: (error: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
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
