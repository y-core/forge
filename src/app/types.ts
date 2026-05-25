import type { Context, Env, MiddlewareHandler } from "hono";
import type { ReadonlyFormData } from "../form/types";
import type { Logger } from "../logging/types";
import type { RouteAction, RouteView } from "../router/types";
import type { SecurityHeadersOptions } from "../security/types";
import type { ValidationResult } from "../validation/types";

export interface AppOptions<T extends object = Record<string, unknown>> {
  security?: SecurityHeadersOptions;
  isDebug?: (c: Context<{ Bindings: T }>) => boolean;
  onError?: (error: Error, c: Context<{ Bindings: T }>) => Response | Promise<Response>;
  /** Custom logger injected into the app error handler. Defaults to `createLogger("app")`. */
  logger?: Logger;
}

export interface CacheDirective {
  maxAge: number;
  scope?: "public" | "private";
}

export interface PageDefinition<
  E extends Env = Env,
  LoaderData = unknown,
  ActionData = unknown,
> {
  loader?: (c: Context<E>) => LoaderData | Response | Promise<LoaderData | Response>;
  action?: RouteAction<E, ActionData>;
  view: RouteView<E, LoaderData, ActionData>;
  headers?: Record<string, string>;
  cache?: "no-store" | CacheDirective;
  middleware?: MiddlewareHandler<E> | MiddlewareHandler<E>[];
  /** Called when `view` throws; receives the error and Hono context. If absent, the error re-throws to the app-level handler. */
  onError?: (error: Error, c: Context<E>) => Response | Promise<Response>;
}

export interface ActionDefinition<T, E extends Env = Env> {
  parse: (formData: ReadonlyFormData) => T;
  validate: (data: T) => ValidationResult<T>;
  handle: (data: T, c: Context<E>) => Response | Promise<Response>;
  middleware?: MiddlewareHandler<E> | MiddlewareHandler<E>[];
  onValidationError?: (errors: string[], c: Context<E>) => Response | Promise<Response>;
  onError?: (error: Error, c: Context<E>) => Response | Promise<Response>;
}

export interface AssetOptions<E extends Env = Env> {
  notFoundView: (c: Context<E>) => Response | Promise<Response>;
}

export interface HealthCheckResult {
  ok: boolean;
  checks: Record<string, boolean>;
}
