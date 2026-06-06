/** @jsxImportSource @y-core/forge */

import type { AppContext } from "../../context/types";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { KVNamespace } from "../../storage/kv/types";
import type { LogLevel } from "../types";
import type { LogViewerLoaderData } from "./components";
import { LOG_TBODY_ID, LogTableBody } from "./components";
import { readLogs } from "./reader";

/** Options for the log viewer loader. @public */
export interface LogViewerOptions<Bindings = Record<string, unknown>> {
  /** Returns the KV namespace to read from. Called per request. */
  kv: (c: AppContext<Bindings>) => KVNamespace;
  /** URL path prefix where the viewer is mounted (used for HTMX targets). */
  basePath?: string;
}

/**
 * Log viewer loader, designed to sit inside a `definePage` loader. Reads the requested log page and:
 * - returns the `<tbody>` fragment `Response` directly for HTMX requests (partial swap), or
 * - returns `LogViewerLoaderData` for the page view to compose into the app's own shell.
 *
 * The app owns the page shell — pass the returned data to `LogViewerContent` inside your `<Layout>`.
 * The viewer is unauthenticated by default; attach auth via the route's `middleware`. @public
 */
export async function readLogViewer<Bindings = Record<string, unknown>>(
  c: AppContext<Bindings>,
  options: LogViewerOptions<Bindings>,
): Promise<Response | LogViewerLoaderData> {
  const basePath = options.basePath ?? "/admin/logs";
  const kv = options.kv(c);
  const level = c.url.searchParams.get("level") as LogLevel | undefined;
  const q = c.url.searchParams.get("q") || undefined;
  const cursor = c.url.searchParams.get("cursor") || undefined;

  const query: Parameters<typeof readLogs>[1] = {};
  if (level) query.level = level;
  if (q !== undefined) query.q = q;
  if (cursor !== undefined) query.cursor = cursor;

  const result = await readLogs(kv, query);

  // HTMX partial: return only the <tbody> fragment
  if (c.request.headers.get("HX-Request") === "true") {
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
  return data;
}
