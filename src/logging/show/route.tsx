/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { renderShell } from "../../app/shell";
import type { AppContext } from "../../context/types";
import { isHxRequest } from "../../html/htmx/hx-request";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import { v } from "../../validation/mod";
import type { LogLevel, LogQuery, LogReadResult, LogRecord } from "../types";
import { LOG_LEVELS } from "../types";
import { LOG_TBODY_ID, LogAppendFragment, LogDetailRow, LogTableBody, LogViewerContent } from "./components";
import type { LogViewerLoaderData } from "./types";
import type { LogViewerOptions } from "./types";

const LevelParamSchema = v.picklist(LOG_LEVELS);

/** Narrows the untrusted `?level=` query parameter to a known level, dropping an unrecognised value. @internal */
function parseLevelParam(raw: string | null): LogLevel | undefined {
  if (raw === null) return undefined;
  const parsed = v.safeParse(LevelParamSchema, raw);
  return parsed.success ? parsed.output : undefined;
}

/** Evaluates `access`, then renders the log page or the HTMX fragment the request asks for. @public */
export async function loadLogViewer<Bindings = Record<string, unknown>>(
  c: AppContext<Bindings>,
  options: LogViewerOptions<Bindings>,
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
  return renderShell(c, <LogViewerContent data={data} icon={options.icon} />, {
    mount: "logs",
    page: "logs",
    meta: { title: "Logs", robots: "noindex" },
  });
}

/** Renders the `<tbody>` HTMX partial from loader data. @internal */
async function renderLogFragment(data: LogViewerLoaderData): Promise<Response> {
  const body = await renderToString(
    <LogTableBody
      id={LOG_TBODY_ID}
      rows={data.rows}
      loadMoreAction={data.basePath}
      level={data.level}
      q={data.q}
      failed={data.failed}
      more={!data.complete && data.cursor !== undefined}
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
