import type { Middleware, RequestContext } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";

/** A function that converts input data into an HTTP Response. @public */
export type Renderer<Input = unknown, Init = ResponseInit> = (input: Input, init?: Init) => Response | Promise<Response>;

/** A renderer of any input and options shape. @public */
export type AnyRenderer = Renderer<never, never>;

/**
 * Context key used to read the current request renderer with `context.get(Renderer)`.
 * The `renderWith()` middleware also installs the renderer as `context.render`. @public
 */
export const Renderer = createContextKey<AnyRenderer>();

/**
 * Adds a renderer to request context and installs it as the `render` direct property.
 *
 * The factory is called once per request — any per-request values (nonce, CSRF tokens) set by
 * earlier middleware are available when the returned renderer is invoked by a handler. @public
 */
export function renderWith<const R extends AnyRenderer>(
  createRenderer: (context: RequestContext<any, any>) => R,
): Middleware<{ key: typeof Renderer; value: R; property: "render" }> {
  return (context, next) => {
    context.set(Renderer, createRenderer(context), { property: "render" });
    return next();
  };
}
