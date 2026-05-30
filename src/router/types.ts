import type { Context, Env, MiddlewareHandler } from "hono";
import type { InferConfig } from "../config/config";

export interface RouteRenderState<LoaderData = unknown, ActionData = unknown> {
  data: LoaderData;
  actionData: ActionData;
  method: "GET" | "POST";
}

export type RouteLoader<E extends Env = Env, LoaderData = unknown> = (
  c: Context<E>,
  config: InferConfig<E>,
) => LoaderData | Response | Promise<LoaderData | Response>;

export type RouteAction<E extends Env = Env, ActionData = unknown> = (
  c: Context<E>,
  config: InferConfig<E>,
) => ActionData | Response | Promise<ActionData | Response>;

export type RouteView<E extends Env = Env, LoaderData = unknown, ActionData = unknown> = (
  c: Context<E>,
  config: InferConfig<E>,
  state: RouteRenderState<LoaderData, ActionData>,
) => Response | Promise<Response>;

export interface RouteModule<
  E extends Env = Env,
  LoaderData = unknown,
  ActionData = unknown,
> {
  loader?: RouteLoader<E, LoaderData>;
  action?: RouteAction<E, ActionData>;
  view?: RouteView<E, LoaderData, ActionData>;
  middleware?: MiddlewareHandler<E> | MiddlewareHandler<E>[];
}

export interface RouteConfigEntry<E extends Env = Env> {
  path?: string;
  index?: boolean;
  module: RouteModule<E>;
  children?: RouteConfigEntry<E>[];
}

export type RouteConfig<E extends Env = Env> = RouteConfigEntry<E>[];
