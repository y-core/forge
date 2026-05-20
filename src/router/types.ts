import type { Context, Env, MiddlewareHandler } from "hono";

export interface RouteModule<E extends Env = Env> {
  loader?: (c: Context<E>) => Response | Promise<Response>;
  action?: (c: Context<E>) => Response | Promise<Response>;
  view?: (c: Context<E>) => Response | Promise<Response>;
  middleware?: MiddlewareHandler<E> | MiddlewareHandler<E>[];
}

export interface RouteConfigEntry<E extends Env = Env> {
  path?: string;
  index?: boolean;
  module: RouteModule<E>;
  children?: RouteConfigEntry<E>[];
}

export type RouteConfig<E extends Env = Env> = RouteConfigEntry<E>[];
