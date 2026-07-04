/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { AppContext } from "../../context/types";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { LogChannel, LogLevel, LogQuery, LogReadResult, LogRecord } from "../types";
import type { LogViewerLoaderData } from "./components";
import { LOG_TBODY_ID, LogDetailCell, LogTableBody } from "./components";

/**
 * Access decision for the log viewer. Either a per-request predicate (return `false` to deny
 * with a `403`), or the explicit literal `"allow-unauthenticated"` for viewers that are
 * intentionally public (dev-only mounts). There is no implicit-open default. @public
 */
export type LogViewerAccess<Bindings = Record<string, unknown>> =
  | ((c: AppContext<Bindings>) => boolean | Promise<boolean>)
  | "allow-unauthenticated";

/**
 * Options for the log viewer loader. Logs expose request paths, request ids, and error
 * messages, so `access` is required — forgetting a guard is a compile error, and opting
 * out is an explicit, greppable literal. @public
 */
export type LogViewerOptions<Bindings = Record<string, unknown>> = {
  /** Returns the log channel to read from. Called per request. */
  channel: (c: AppContext<Bindings>) => LogChannel;
  /** Required access decision; runs before the channel is touched. */
  access: LogViewerAccess<Bindings>;
  /** URL path prefix where the viewer is mounted (used for HTMX targets). */
  basePath?: string;
};

/**
 * Log viewer loader. Evaluates `access` first — a denial returns a `403 Forbidden` `Response`
 * (which `definePage` loaders short-circuit on) without touching the channel. On allow, reads
 * the requested log page via the channel and returns `LogViewerLoaderData`. Use inside
 * `definePage`'s `loader`; pass the data to `renderLogFragment` (HTMX) or `LogViewerContent`
 * (full page) in the `view`. A throwing `access` predicate propagates to the error boundary
 * (fail closed). @public
 */
export async function loadLogViewer<Bindings = Record<string, unknown>>(
  c: AppContext<Bindings>,
  options: LogViewerOptions<Bindings>,
): Promise<LogViewerLoaderData | Response> {
  if (options.access !== "allow-unauthenticated" && !(await options.access(c))) {
    return new Response("Forbidden", { status: 403 });
  }
  const basePath = options.basePath ?? "/admin/logs";
  const channel = options.channel(c);

  const detailKey = c.url.searchParams.get("detail");
  if (detailKey) {
    const record = (await channel.readEntry?.(detailKey)) ?? null;
    return renderLogDetailFragment(record);
  }

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

/**
 * Renders the expanded detail `<td>` HTMX partial for one stored record — the `outerHTML`
 * replacement of a clicked message cell. `loadLogViewer` returns this automatically when a
 * `?detail=<key>` query parameter is present. @public
 */
export async function renderLogDetailFragment(record: LogRecord | null): Promise<Response> {
  const body = await renderToString(<LogDetailCell record={record} />);
  return fragmentResponse(body);
}
