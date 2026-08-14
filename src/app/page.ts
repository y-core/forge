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

/** Wraps a view/loader into a RequestHandler with caching, custom headers, and error recovery. @public */
export function definePage<
  Bindings = Record<string, unknown>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
>(def: PageDefinition<Bindings, ConfigData, LoaderData, ActionData, S>): RequestHandler {
  const pipeline = def.schema === undefined ? undefined : createSubmissionPipeline<S, Bindings, ConfigData>({ ...def, schema: def.schema });

  return async (context) => {
    const config = context.get(ConfigKey) as ConfigData;
    const c = getAppContext<Bindings>(context);

    // HEAD never reaches here as itself — the app rewrites it to GET before routing.
    const isMutation = context.method.toUpperCase() !== "GET";

    try {
      // The action runs before the loader so the view renders the state the mutation left behind.
      let actionData: ActionData | undefined;
      if (isMutation && def.action) {
        const submission = pipeline === undefined ? undefined : await pipeline(c, config);
        if (submission !== undefined && !submission.ok) {
          return applyResponseHeaders(submission.error, def);
        }

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
