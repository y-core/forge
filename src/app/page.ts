import type { RequestHandler } from "@remix-run/fetch-router";
import { ConfigKey, getAppContext } from "../context/types";
import { CacheControl } from "../http/headers";
import { createLogger } from "../logging/logger";
import { toError } from "../result/result";
import type { v } from "../validation/validation";
import { createSubmissionPipeline } from "./pipeline";
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
 * **Declaring a `schema` alongside an `action` puts that action behind the same read → guard →
 * validate sequence `defineAction` runs**, and hands it the validated body as its third argument; a
 * body the schema refuses becomes a 422 fragment and the action never runs. The sequence's other
 * options — `honeypot`, `turnstile`, `onBotDetected`, `onValidationError`, `maxBytes` — are declared
 * on the page as well, and `onValidationError` is what lets a self-posting page answer a refused body
 * by re-rendering its own view with field errors instead of the default fragment.
 *
 * A `schema` with no `action` runs no sequence: the sequence guards a terminal step, and a page that
 * runs nothing on a mutation has none to guard, so the request renders the view like any other. A
 * page with no `schema` is likewise unchanged: its action sees the unparsed context and validates at
 * its own boundary.
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
export function definePage<
  Bindings = Record<string, unknown>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
>(def: PageDefinition<Bindings, ConfigData, LoaderData, ActionData, S>): RequestHandler {
  // Built once per route, and only for a page that declares a schema: a page without one keeps
  // running its action against the unparsed context, so there is no sequence to build. The whole
  // definition is spread rather than its pipeline options listed, so an option added to the sequence
  // reaches a page without a second list here to keep in step; the pipeline reads only what it
  // declares. `schema` is restated because the guard narrows it, and the sequence requires it.
  const pipeline = def.schema === undefined ? undefined : createSubmissionPipeline<S, Bindings, ConfigData>({ ...def, schema: def.schema });

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
        // A refusal from the pipeline is already the whole answer, so it short-circuits exactly like
        // an action's own `Response` — headers and all.
        const submission = pipeline === undefined ? undefined : await pipeline(c, config);
        if (submission !== undefined && !submission.ok) {
          return applyResponseHeaders(submission.error, def);
        }

        // With no pipeline there is no body to hand over, and the cast is a no-op: a page that
        // declared no schema types its action's `data` as `unknown`, which is what it already ignores.
        const result = await def.action(c, config, submission?.data as v.InferOutput<S>);
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
