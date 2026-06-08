/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { AppContext } from "../../context/types";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { LogChannel, LogLevel, LogQuery, LogReadResult } from "../types";
import type { LogViewerLoaderData } from "./components";
import { LOG_TBODY_ID, LogTableBody } from "./components";

/**
 * Options for the log viewer loader. Forge does not gate access — mount the route behind
 * auth middleware in the consuming app. @public
 */
export type LogViewerOptions<Bindings = Record<string, unknown>> = {
  /** Returns the log channel to read from. Called per request. */
  channel: (c: AppContext<Bindings>) => LogChannel;
  /** URL path prefix where the viewer is mounted (used for HTMX targets). */
  basePath?: string;
};

/**
 * Log viewer loader. Reads the requested log page via the channel and returns `LogViewerLoaderData`.
 * Use inside `definePage`'s `loader`; pass the result to `renderLogFragment` (HTMX)
 * or `LogViewerContent` (full page) in the `view`. The app owns access control. @public
 */
export async function loadLogViewer<Bindings = Record<string, unknown>>(
  c: AppContext<Bindings>,
  options: LogViewerOptions<Bindings>,
): Promise<LogViewerLoaderData> {
  const basePath = options.basePath ?? "/admin/logs";
  const channel = options.channel(c);
  const level = c.url.searchParams.get("level") as LogLevel | undefined;
  const q = c.url.searchParams.get("q") || undefined;
  const cursor = c.url.searchParams.get("cursor") || undefined;

  const query: LogQuery = {};
  if (level) query.level = level;
  if (q !== undefined) query.q = q;
  if (cursor !== undefined) query.cursor = cursor;

  const result: LogReadResult = await (channel.read?.(query) ?? Promise.resolve({ rows: [], complete: true }));

  const data: LogViewerLoaderData = { rows: result.rows, complete: result.complete, basePath };
  if (result.cursor !== undefined) data.cursor = result.cursor;
  if (level) data.level = level;
  if (q) data.q = q;
  return data;
}

/**
 * Renders the `<tbody>` HTMX partial from loader data.
 * Return this directly from `definePage`'s `view` when `HX-Request === "true"`. @public
 */
export async function renderLogFragment(data: LogViewerLoaderData): Promise<Response> {
  const body = await renderToString(
    <LogTableBody
      id={LOG_TBODY_ID}
      rows={data.rows}
      {...(data.cursor !== undefined ? { cursor: data.cursor } : {})}
      complete={data.complete}
      loadMoreAction={data.basePath}
    />,
  );
  return fragmentResponse(body);
}
