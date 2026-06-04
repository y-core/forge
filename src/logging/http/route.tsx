/** @jsxImportSource @y-core/forge */
import type { Context, Env } from "hono";
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import type { InferConfig } from "../../config/config";
import type { RouteModule, RouteRenderState } from "../../router/types";
import type { KVNamespace } from "../../storage/kv/types";
import type { ForgeIcon } from "../../ui/core/icon";
import type { LogLevel } from "../types";
import type { LogViewerLoaderData } from "./components";
import { LOG_TBODY_ID, LogTableBody, LogViewerContent } from "./components";
import { readLogs } from "./reader";

/** Options for the log viewer route module. @public */
export interface LogViewerOptions<E extends Env = Env> {
  /** Returns the KV namespace to read from. Called per request. */
  kv: (c: Context<E>) => KVNamespace;
  /** URL path prefix where the viewer is mounted (used for HTMX targets). */
  basePath?: string;
  /** App-bound icon supplying the filter `Select`'s chevron. The app's sprite must contain `chevron-down`. */
  icon: ForgeIcon<"chevron-down">;
  /** Renders the full HTML page around the viewer content. When provided, logViewer returns a `view`; when omitted the module is loader-only. @public */
  renderPage?: (c: Context<E>, config: InferConfig<E>, content: Child) => Response | Promise<Response>;
}

/**
 * Returns a RouteModule for the HTML log viewer.
 * Mount with `route("/admin/logs", logViewer({ kv: (c) => ... }))`.
 * The viewer is unauthenticated by default — wrap with auth middleware at the route level. @public
 */
// TODO(auth): mount behind an auth middleware before exposing to production
export function logViewer<E extends Env = Env>(options: LogViewerOptions<E>): RouteModule<E, LogViewerLoaderData> {
  const basePath = options.basePath ?? "/admin/logs";
  const renderPage = options.renderPage;

  return {
    loader: async (c: Context<E>): Promise<LogViewerLoaderData | Response> => {
      const kv = options.kv(c);
      const level = c.req.query("level") as LogLevel | undefined;
      const q = c.req.query("q");
      const cursor = c.req.query("cursor");

      const result = await readLogs(kv, {
        level: level || undefined,
        q: q || undefined,
        cursor: cursor || undefined,
      });

      // HTMX partial: return only the <tbody> fragment; id must survive outerHTML swap
      if (c.req.header("HX-Request") === "true") {
        return c.html(
          html`${(
            <LogTableBody
              id={LOG_TBODY_ID}
              rows={result.rows}
              cursor={result.cursor}
              complete={result.complete}
              loadMoreAction={basePath}
            />
          )}`,
        );
      }

      return {
        rows: result.rows,
        cursor: result.cursor,
        complete: result.complete,
        level: level || undefined,
        q: q || undefined,
        basePath,
      };
    },
    ...(renderPage
      ? {
          view: (c: Context<E>, config: InferConfig<E>, state: RouteRenderState<LogViewerLoaderData>) =>
            renderPage(c, config, <LogViewerContent data={state.data} icon={options.icon} />),
        }
      : {}),
  };
}
