/** @jsxImportSource @y-core/forge */

import type { RequestHandler } from "@remix-run/fetch-router";
import type { Renderer as RendererType } from "../../app/render-middleware";
import { Renderer } from "../../app/render-middleware";
import type { AppContext } from "../../context/types";
import { getAppContext } from "../../context/types";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { Child } from "../../jsx/types";
import type { KVNamespace } from "../../storage/kv/types";
import type { ForgeIcon } from "../../ui/core/icon";
import type { LogLevel } from "../types";
import type { LogViewerLoaderData } from "./components";
import { LOG_TBODY_ID, LogTableBody, LogViewerContent } from "./components";
import { readLogs } from "./reader";

/** Options for the log viewer route module. @public */
export interface LogViewerOptions<Bindings = Record<string, unknown>> {
  /** Returns the KV namespace to read from. Called per request. */
  kv: (c: AppContext<Bindings>) => KVNamespace;
  /** URL path prefix where the viewer is mounted (used for HTMX targets). */
  basePath?: string;
  /** App-bound icon supplying the filter `Select`'s chevron. */
  icon: ForgeIcon<"chevron-down">;
}

/**
 * Returns a RequestHandler for the HTML log viewer.
 * Wire it into a controller action, e.g. `createController(routes, { actions: { adminLogs: logViewer({ kv: (c) => ... }) } })`.
 * The viewer is unauthenticated by default — attach auth via the action's `middleware`. @public
 */
export function logViewer<Bindings = Record<string, unknown>>(options: LogViewerOptions<Bindings>): RequestHandler {
  const basePath = options.basePath ?? "/admin/logs";

  return async (context) => {
    const c = getAppContext<Bindings>(context);
    const kv = options.kv(c);
    const level = context.url.searchParams.get("level") as LogLevel | undefined;
    const q = context.url.searchParams.get("q") || undefined;
    const cursor = context.url.searchParams.get("cursor") || undefined;

    const query: Parameters<typeof readLogs>[1] = {};
    if (level) query.level = level;
    if (q !== undefined) query.q = q;
    if (cursor !== undefined) query.cursor = cursor;

    const result = await readLogs(kv, query);

    // HTMX partial: return only the <tbody> fragment
    if (context.request.headers.get("HX-Request") === "true") {
      const body = await renderToString(
        <LogTableBody
          id={LOG_TBODY_ID}
          rows={result.rows}
          {...(result.cursor !== undefined ? { cursor: result.cursor } : {})}
          complete={result.complete}
          loadMoreAction={basePath}
        />,
      );
      return fragmentResponse(body);
    }

    const data: LogViewerLoaderData = { rows: result.rows, complete: result.complete, basePath };
    if (result.cursor !== undefined) data.cursor = result.cursor;
    if (level) data.level = level;
    if (q) data.q = q;

    const render = context.get(Renderer);
    if (render) return (render as unknown as RendererType<Child>)(<LogViewerContent data={data} icon={options.icon} />);

    return Response.json(data);
  };
}
