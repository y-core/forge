import type { RequestHandler } from "@remix-run/fetch-router";
import { getAppContext } from "../context/types";
import { CacheControl } from "../http/headers";
import { toError } from "../result/result";
import { ConfigKey } from "./config-middleware";
import type { CacheDirective, PageDefinition } from "./types";

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
 * The loader may return a `Response` (e.g. a redirect or a 403) to short-circuit rendering —
 * the configured `cache`/`headers` are still applied. Prefer `createHandlerFactory` to avoid
 * repeating the `Bindings`/`ConfigData` generics on every call.
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

    try {
      let data: LoaderData | undefined;
      if (def.loader) {
        const result = await def.loader(c, config);
        if (result instanceof Response) {
          return applyResponseHeaders(result, def);
        }
        data = result as LoaderData;
      }

      const state = { data: data as LoaderData, actionData: undefined as ActionData, method: "GET" as const };
      const viewRes = await def.view(c, config, state);
      return applyResponseHeaders(viewRes, def);
    } catch (err) {
      if (def.onError) return def.onError(toError(err), c);
      throw err;
    }
  };
}
