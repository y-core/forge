/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { AppContext } from "../../context/types";
import { isHxRequest } from "../../html/htmx/hx-request";
import { fragmentResponse } from "../../http/response";
import { renderPage, renderToString } from "../../jsx/render-to-string";
import type { FC } from "../../jsx/types";
import type { ForgeIcon } from "../../ui/core/icon";
import { v } from "../../validation/mod";
import type { LogChannel, LogLevel, LogQuery, LogReadResult, LogRecord } from "../types";
import { LOG_LEVELS } from "../types";
import type { LogViewerLoaderData } from "./components";
import { LOG_TBODY_ID, LogAppendFragment, LogDetailRow, LogTableBody, LogViewerContent } from "./components";

const LevelParamSchema = v.picklist(LOG_LEVELS);

/**
 * Narrows the untrusted `?level=` query parameter to a known level at the request boundary. An
 * unrecognised value is dropped rather than rejected: the filter only narrows a row set the caller
 * has already been authorised to read in full, so falling back to every level cannot expose
 * anything `access` did not already permit, and the unfiltered view is a state the filter bar
 * renders anyway as "All". @internal
 */
function parseLevelParam(raw: string | null): LogLevel | undefined {
  if (raw === null) return undefined;
  const parsed = v.safeParse(LevelParamSchema, raw);
  return parsed.success ? parsed.output : undefined;
}

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
export type LogViewerOptions<Bindings = Record<string, unknown>, Config = unknown, Ctx = unknown> = {
  /** Returns the log channel to read from. Called per request. */
  channel: (c: AppContext<Bindings>) => LogChannel;
  /** Required access decision; runs before the channel is touched. */
  access: LogViewerAccess<Bindings>;
  /** App-bound icon (must provide `chevron-down`) rendered in the filter bar's level select. */
  icon: ForgeIcon<"chevron-down">;
  /**
   * Async context factory called per request for a full-page render. The resolved value is forwarded
   * as the `ctx` prop to `layout`. Mirrors `ShowcaseOptions.context`.
   */
  context: (c: AppContext<Bindings>, config: Config) => Promise<Ctx>;
  /**
   * Layout component wrapping the viewer page, receiving `ctx` from `context` and the viewer content
   * as `children`. **Required**, and required for a reason: the document is where the theme lives.
   * The `<html>` element carries the dark class, the head carries the FOUC script that sets it before
   * first paint, and `<body>` carries `bg-background`. A viewer that builds its own bare document —
   * which this one used to — cannot reach any of that, so its markup renders light whatever classes
   * the components carry. Handing the shell to the consumer is the same move `registerShowcase`
   * makes, and for the same reason.
   * @example
   * ```ts
   * layout: Layout  // FC<{ ctx: MyRenderContext }>
   * ```
   */
  layout: FC<{ ctx: Ctx }>;
  /** URL path prefix where the viewer is mounted (used for HTMX targets). */
  basePath?: string;
};

/**
 * Log viewer loader. Evaluates `access` first — a denial returns a `403 Forbidden` `Response`
 * without touching the channel. On allow, reads the requested log page via the channel and
 * returns a rendered `Response` for every path: the detail `<tr>` fragment for `?detail=<key>`,
 * the append fragment (rows plus an out-of-band load-more row) for an `HX-Request` carrying a
 * `?cursor=`, the `<tbody>` HTMX partial for any other `HX-Request`, or the full viewer page
 * rendered inside `options.layout` otherwise.
 *
 * A rejected `channel.read` is **caught** and rendered as the surface's error state, rather than
 * propagating. Letting it reach the error boundary is wrong specifically for a fragment request: the
 * boundary answers with a page, and HTMX would swap that page's body into the log table. `access` is
 * deliberately not covered by that catch — a throwing predicate still propagates, so the viewer
 * fails closed.
 *
 * Rendering happens only here — the record-rendering components are internal, so records can
 * never be rendered without passing `access`. Use inside `definePage`'s `loader`; a loader
 * returning a `Response` short-circuits rendering. @public
 */
export async function loadLogViewer<Bindings = Record<string, unknown>, Config = unknown, Ctx = unknown>(
  c: AppContext<Bindings>,
  config: Config,
  options: LogViewerOptions<Bindings, Config, Ctx>,
): Promise<Response> {
  if (options.access !== "allow-unauthenticated" && !(await options.access(c))) {
    return new Response("Forbidden", { status: 403 });
  }
  const basePath = options.basePath ?? "/admin/logs";
  const channel = options.channel(c);

  const detailKey = c.url.searchParams.get("detail");
  if (detailKey) {
    const record = (await channel.readEntry?.(detailKey)) ?? null;
    return renderLogDetailFragment(record, detailKey);
  }

  const level = parseLevelParam(c.url.searchParams.get("level"));
  const q = c.url.searchParams.get("q") || undefined;
  const cursor = c.url.searchParams.get("cursor") || undefined;

  const query: LogQuery = {};
  if (level) query.level = level;
  if (q !== undefined) query.q = q;
  if (cursor !== undefined) query.cursor = cursor;

  const data: LogViewerLoaderData = { rows: [], complete: true, basePath };
  if (level) data.level = level;
  if (q) data.q = q;

  try {
    const result: LogReadResult = await (channel.read?.(query) ?? Promise.resolve({ rows: [], complete: true }));
    data.rows = result.rows;
    data.complete = result.complete;
    if (result.cursor !== undefined) data.cursor = result.cursor;
  } catch {
    // The reason is deliberately not carried into the markup: a channel error can name a binding, a
    // key prefix or a backend path, and `STRUCTURED_LOGGING.md`'s no-PII rule governs what a log
    // surface is allowed to show. The reader gets a retry; the operator gets the platform's own log.
    data.failed = true;
    // A cursor the read never consumed is still good, so the load-more control keeps it and becomes
    // its own retry. Reporting `complete` here instead would delete that control on a transient
    // failure — the one outcome from which the reader has no way back.
    if (cursor === undefined) {
      data.complete = true;
    } else {
      data.cursor = cursor;
      data.complete = false;
    }
  }

  if (isHxRequest(c)) {
    // A cursor means the load-more control fired: return the new rows plus the replacement control.
    // Without one it is a filter submit, which replaces the whole tbody.
    return cursor === undefined ? renderLogFragment(data) : renderLogAppendFragment(data);
  }
  return renderLogViewerPage(data, options, await options.context(c, config));
}

/**
 * Renders the full viewer page — `LogViewerContent` as the children of the consumer's `layout`.
 *
 * No `<html>`, `<head>` or `<body>` is built here on purpose; see `LogViewerOptions.layout`.
 * @internal
 */
async function renderLogViewerPage<Bindings, Config, Ctx>(
  data: LogViewerLoaderData,
  options: LogViewerOptions<Bindings, Config, Ctx>,
  ctx: Ctx,
): Promise<Response> {
  const LayoutComponent = options.layout;
  return renderPage(
    <LayoutComponent ctx={ctx}>
      <LogViewerContent data={data} icon={options.icon} />
    </LayoutComponent>,
  );
}

/**
 * Renders the `<tbody>` HTMX partial from loader data. `loadLogViewer` returns this when the
 * request carries `HX-Request` without a cursor. @internal
 */
async function renderLogFragment(data: LogViewerLoaderData): Promise<Response> {
  const body = await renderToString(
    <LogTableBody
      id={LOG_TBODY_ID}
      rows={data.rows}
      loadMoreAction={data.basePath}
      {...(data.level !== undefined ? { level: data.level } : {})}
      {...(data.q !== undefined ? { q: data.q } : {})}
      {...(data.failed !== undefined ? { failed: data.failed } : {})}
    />,
  );
  return fragmentResponse(body);
}

/**
 * Renders the next page as a `<tr>` sequence appended to the tbody, followed by the load-more row
 * carrying the new cursor out of band. `loadLogViewer` returns this for an HTMX request carrying a
 * `?cursor=`. @internal
 */
async function renderLogAppendFragment(data: LogViewerLoaderData): Promise<Response> {
  const body = await renderToString(<LogAppendFragment data={data} />);
  return fragmentResponse(body);
}

/**
 * Renders the expanded detail `<tr>` HTMX partial for one stored record — the `outerHTML`
 * replacement of that row's own detail row. `loadLogViewer` returns this when a `?detail=<key>`
 * query parameter is present. @internal
 */
async function renderLogDetailFragment(record: LogRecord | null, rowKey: string): Promise<Response> {
  const body = await renderToString(<LogDetailRow record={record} rowKey={rowKey} />);
  return fragmentResponse(body);
}
