import type { RequestMethod, Route } from "@remix-run/fetch-router/routes";

import { ConfigKey, getAppContext } from "../context/types";
import { formToObject } from "../form/to-object";
import { CacheControl } from "../http/headers";
import { isSafeHttpMethod } from "../http/method";
import { rebuildResponse } from "../http/rebuild";
import { fragmentResponse } from "../http/response";
import { createLogger } from "../logging/logger";
import { loggerFor } from "../logging/request-logger";
import { serializeError } from "../logging/serialize-error";
import { renderValidationErrors } from "../render/htmx/fragment";
import { toError } from "../result/result";
import type { RouteParams } from "../router/types";
import { describeValidationIssue } from "../validation/format-issues";
import { v } from "../validation/validation";
import { hardenedText } from "./hardened-response";
import { createSubmissionPipeline, PIPELINE_ONLY_KEYS } from "./pipeline";
import type { CacheDirective, PageDefinition, RouteHandler } from "./types";

const fallbackLogger = createLogger("page");

const PAGE_SERVED_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE";

function pageAllowHeader(method: RequestMethod | "ANY"): string {
  if (method === "ANY") return PAGE_SERVED_METHODS;
  if (isSafeHttpMethod(method)) return "GET, HEAD";
  return method;
}

function buildCacheHeader(cache: "no-store" | CacheDirective | undefined): string | undefined {
  if (cache === "no-store") return new CacheControl({ noStore: true }).toString();
  if (cache && typeof cache === "object") {
    // `private` by default: the field spans personalised and shared pages alike, and marking a
    // dashboard shared-cacheable lets an edge serve one reader's HTML to another.
    const scope = cache.scope ?? "private";
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
  return rebuildResponse(res, headers);
}

function refuseQuery(issues: readonly v.BaseIssue<unknown>[]): Response {
  return fragmentResponse(renderValidationErrors(issues.map(describeValidationIssue)), 400);
}

/** Wraps a view/loader into a RequestHandler with query validation, caching, custom headers, and error recovery. @internal */
export function definePage<
  // oxlint-disable-next-line typescript/no-explicit-any -- any method and any pattern are both route shapes
  R extends Route<any, any>,
  Bindings = Record<string, unknown>,
  ConfigData = unknown,
  LoaderData = unknown,
  ActionData = unknown,
  S extends v.GenericSchema = v.GenericSchema,
  Q extends v.GenericSchema = v.GenericSchema,
>(route: R, def: PageDefinition<Bindings, RouteParams<R>, ConfigData, LoaderData, ActionData, S, Q>): RouteHandler<R> {
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

  const pipeline =
    def.schema === undefined ? undefined : createSubmissionPipeline<S, Bindings, RouteParams<R>, ConfigData>({ ...def, schema: def.schema });
  const cacheHeader = buildCacheHeader(def.cache);
  const allow = pageAllowHeader(route.method);
  const queryConfig: v.Config<v.InferIssue<Q>> = { abortEarly: true };

  return async (context) => {
    const config = context.get(ConfigKey) as ConfigData;
    const c = getAppContext<Bindings, RouteParams<R>>(context);

    // HEAD never reaches here as itself — the app rewrites it to GET before routing.
    const method = context.method.toUpperCase();
    const isMutation = !isSafeHttpMethod(method);
    if (!isMutation && method !== "GET") {
      return hardenedText("Method Not Allowed", 405, { allow });
    }

    try {
      let query: v.InferOutput<Q> | undefined;
      if (def.query !== undefined) {
        const parsed = v.safeParse(def.query, formToObject(c.url.searchParams), queryConfig);
        if (!parsed.success) {
          const refusal = def.onQueryError ? await def.onQueryError(parsed.issues, c) : refuseQuery(parsed.issues);
          return applyResponseHeaders(refusal, cacheHeader, def.headers);
        }
        query = parsed.output;
      }

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
        const result = await def.loader(c, config, query as v.InferOutput<Q>);
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
        const logger = loggerFor(c, "page", fallbackLogger);
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
