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

/** Narrows the untrusted `?level=` query parameter to a known level, dropping an unrecognised value. @internal */
function parseLevelParam(raw: string | null): LogLevel | undefined {
  if (raw === null) return undefined;
  const parsed = v.safeParse(LevelParamSchema, raw);
  return parsed.success ? parsed.output : undefined;
}

/** Access decision for the log viewer: a per-request predicate, or the explicit literal `"allow-unauthenticated"`. @public */
export type LogViewerAccess<Bindings = Record<string, unknown>> =
  | ((c: AppContext<Bindings>) => boolean | Promise<boolean>)
  | "allow-unauthenticated";

/** Options for the log viewer loader. @public */
export type LogViewerOptions<Bindings = Record<string, unknown>, Config = unknown, Ctx = unknown> = {
  channel: (c: AppContext<Bindings>) => LogChannel;
  /** Required access decision; runs before the channel is touched. */
  access: LogViewerAccess<Bindings>;
  icon: ForgeIcon<"chevron-down">;
  /** Async context factory called per request; its resolved value is the `ctx` prop of `layout`. */
  context: (c: AppContext<Bindings>, config: Config) => Promise<Ctx>;
  /**
   * Layout component wrapping the viewer page, receiving `ctx` from `context` and the content as `children`.
   *
   * The viewer's `<main>` is `flex-1 min-h-0` and carries `data-fill-viewport`, so it fills the height the
   * layout leaves it and scrolls the table inside that box rather than growing the document. To get that,
   * make `children` a direct child of a flex column that goes *definite* for a filling page:
   *
   * ```
   * <body class='flex min-h-dvh flex-col has-[[data-fill-viewport]]:h-dvh has-[[data-fill-viewport]]:overflow-hidden'>
   * ```
   *
   * `min-h-dvh` alone is not enough: an indefinite column takes its height from its items' content, so a
   * long table grows the page. Any other layout still renders correctly; the table then falls back to a
   * `max-h-dvh` box instead of filling the space between header and footer.
   */
  layout: FC<{ ctx: Ctx }>;
  basePath?: string;
};

/** Evaluates `access`, then renders the log page or the HTMX fragment the request asks for. @public */
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
    // The failure reason stays out of the markup: it can name a binding, key prefix or backend path.
    data.failed = true;
    if (cursor === undefined) {
      data.complete = true;
    } else {
      data.cursor = cursor;
      data.complete = false;
    }
  }

  if (isHxRequest(c)) {
    return cursor === undefined ? renderLogFragment(data) : renderLogAppendFragment(data);
  }
  return renderLogViewerPage(data, options, await options.context(c, config));
}

/** Renders the full viewer page — `LogViewerContent` as the children of the consumer's `layout`. @internal */
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

/** Renders the `<tbody>` HTMX partial from loader data. @internal */
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

/** Renders the next page of rows plus the load-more row carrying the new cursor out of band. @internal */
async function renderLogAppendFragment(data: LogViewerLoaderData): Promise<Response> {
  const body = await renderToString(<LogAppendFragment data={data} />);
  return fragmentResponse(body);
}

/** Renders the expanded detail `<tr>` HTMX partial for one stored record. @internal */
async function renderLogDetailFragment(record: LogRecord | null, rowKey: string): Promise<Response> {
  const body = await renderToString(<LogDetailRow record={record} rowKey={rowKey} />);
  return fragmentResponse(body);
}
