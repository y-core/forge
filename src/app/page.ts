import type { RequestHandler } from "@remix-run/fetch-router";
import { ConfigKey, getAppContext } from "../context/types";
import { CacheControl } from "../http/headers";
import { createLogger } from "../logging/logger";
import { toError } from "../result/result";
import type { CacheDirective, PageDefinition } from "./types";

const logger = createLogger("page");

function buildCacheHeader(cache: "no-store" | CacheDirective | undefined): string | undefined {
  if (cache === "no-store") return new CacheControl({ noStore: true }).toString();
  if (cache && typeof cache === "object") {
    const scope = cache.scope ?? "public";
    return new CacheControl({ [scope]: true, maxAge: cache.maxAge }).toString();
  }
  return undefined;
}

function applyResponseHeaders(res: Response, def: { cache?: PageDefinition["cache"]; headers?: Record<string, string> }): Response {
  const cacheHeader = buildCacheHeader(def.cache);
  if (!cacheHeader && !def.headers) return res;
  const headers = new Headers(res.headers);
  if (cacheHeader) headers.set("cache-control", cacheHeader);
  if (def.headers) {
    for (const [key, value] of Object.entries(def.headers)) {
      headers.set(key, value);
    }
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Wraps a view/loader into a RequestHandler with caching, custom headers, and error recovery.
 *
 * A non-GET request runs the optional `action` first and its return value reaches the view as
 * `state.actionData`; a GET skips it and leaves `state.actionData` undefined. The action and the
 * loader may each return a `Response` (e.g. a redirect or a 403) to short-circuit rendering — the
 * configured `cache`/`headers` are still applied. A throw from either is handled exactly like a
 * throw from the view. Prefer `createHandlerFactory` to avoid repeating the `Bindings`/`ConfigData`
 * generics on every call.
 *
 * @example
 * ```typescript
 * export const homePage = definePage<Bindings, AppConfig>({
 *   cache: { maxAge: 300, scope: "public" },
 *   loader: async (c, config) => ({ greeting: `Hello from ${config.site.name}` }),
 *   view: (_c, _cfg, state) => renderPage(<Home greeting={state.data.greeting} />),
 *   onError: (err, c) => renderErrorPage(c, err),
 * });
 * ```
 * @public
 */
export function definePage<Bindings = Record<string, unknown>, ConfigData = unknown, LoaderData = unknown, ActionData = unknown>(
  def: PageDefinition<Bindings, ConfigData, LoaderData, ActionData>,
): RequestHandler {
  return async (context) => {
    const config = context.get(ConfigKey) as ConfigData;
    const c = getAppContext<Bindings>(context);

    // Every non-GET method is a mutation as far as the page pipeline is concerned. HEAD never
    // reaches here as itself — the app rewrites it to GET before routing.
    const isMutation = context.method.toUpperCase() !== "GET";

    try {
      // The action runs before the loader so the view renders the state the mutation left behind,
      // not the state it started from.
      let actionData: ActionData | undefined;
      if (isMutation && def.action) {
        const result = await def.action(c, config);
        if (result instanceof Response) {
          return applyResponseHeaders(result, def);
        }
        actionData = result as ActionData;
      }

      let data: LoaderData | undefined;
      if (def.loader) {
        const result = await def.loader(c, config);
        if (result instanceof Response) {
          return applyResponseHeaders(result, def);
        }
        data = result as LoaderData;
      }

      const state = { data: data as LoaderData, actionData: actionData as ActionData, method: isMutation ? ("POST" as const) : ("GET" as const) };
      const viewRes = await def.view(c, config, state);
      return applyResponseHeaders(viewRes, def);
    } catch (err) {
      const error = toError(err);
      logger.error("Page handler threw", { error: error.message });
      if (def.onError) return def.onError(error, c);
      throw err;
    }
  };
}
