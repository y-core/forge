import type { RequestHandler } from "@remix-run/fetch-router";

import { ConfigKey, getAppContext } from "../context/types";
import { CacheControl } from "../http/headers";
import { createLogger } from "../logging/logger";
import { serializeError } from "../logging/serialize-error";
import { toError } from "../result/result";
import type { v } from "../validation/validation";
import { createSubmissionPipeline, PIPELINE_ONLY_KEYS } from "./pipeline";
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

function applyResponseHeaders(res: Response, cacheHeader: string | undefined, extra: Record<string, string> | undefined): Response {
  if (!cacheHeader && !extra) return res;
  const headers = new Headers(res.headers);
  // A response that states its own caching — a redirect, or a refusal that must not be stored —
  // keeps it; `def.cache` is the page's default, not an override.
  if (cacheHeader && !headers.has("cache-control")) headers.set("cache-control", cacheHeader);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
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
  if (def.schema === undefined) {
    const stated = PIPELINE_ONLY_KEYS.filter((key) => (def as unknown as Record<string, unknown>)[key] !== undefined);
    if (stated.length > 0) {
      const names = stated.map((key) => `\`${key}\``).join(", ");
      throw new Error(
        stated.length === 1
          ? `definePage: ${names} requires \`schema\` — a submission-pipeline option without a schema is ignored.`
          : `definePage: ${names} require \`schema\` — submission-pipeline options without a schema are ignored.`,
      );
    }
  }

  const pipeline = def.schema === undefined ? undefined : createSubmissionPipeline<S, Bindings, ConfigData>({ ...def, schema: def.schema });
  const cacheHeader = buildCacheHeader(def.cache);

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
          return applyResponseHeaders(submission.error, cacheHeader, def.headers);
        }

        const result = await def.action(c, config, submission?.data as v.InferOutput<S>);
        if (result instanceof Response) {
          return applyResponseHeaders(result, cacheHeader, def.headers);
        }
        actionData = result as ActionData;
      }

      let data: LoaderData | undefined;
      if (def.loader) {
        const result = await def.loader(c, config);
        if (result instanceof Response) {
          return applyResponseHeaders(result, cacheHeader, def.headers);
        }
        data = result as LoaderData;
      }

      const state = { data: data as LoaderData, actionData: actionData as ActionData, method: isMutation ? ("POST" as const) : ("GET" as const) };
      const viewRes = await def.view(c, config, state);
      return applyResponseHeaders(viewRes, cacheHeader, def.headers);
    } catch (err) {
      const error = toError(err);
      // A gone client gets no page and no record — the boundary answers 499 (`ERROR_HANDLING.md` §5b).
      if (c.request.signal.aborted) throw error;
      if (def.onError) {
        // The boundary never sees a recovered error, so this is the one record for it.
        logger.error("Page handler threw", { error: serializeError(error) });
        try {
          return await def.onError(error, c);
        } catch (hookErr) {
          logger.error("definePage onError threw", { error: serializeError(hookErr), original: serializeError(error) });
        }
      }
      throw error;
    }
  };
}
