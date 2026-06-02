/** @jsxImportSource @y-core/forge */
import type { Context } from "hono";
import { html } from "hono/html";
import type { RouteModule } from "../../router/types";
import type { KVNamespace } from "../../storage/kv/types";
import type { LogLevel } from "../types";
import { LogTableBody } from "./components";
import { readLogs } from "./reader";

const TBODY_ID = "log-tbody";

/** Options for the log viewer route module. @public */
export interface LogViewerOptions {
  /** Returns the KV namespace to read from. Called per request. */
  kv: (c: Context) => KVNamespace;
  /** URL path prefix where the viewer is mounted (used for HTMX targets). */
  basePath?: string;
}

/** Data returned by the log viewer loader — type the `state.data` in your view. @public */
export interface LogViewerLoaderData {
  rows: Awaited<ReturnType<typeof readLogs>>["rows"];
  cursor?: string;
  complete: boolean;
  level?: string;
  q?: string;
  basePath: string;
}

/**
 * Returns a RouteModule for the HTML log viewer.
 * Mount with `route("/admin/logs", logViewer({ kv: (c) => ... }))`.
 * The viewer is unauthenticated by default — wrap with auth middleware at the route level. @public
 */
// TODO(auth): mount behind an auth middleware before exposing to production
export function logViewer(options: LogViewerOptions): RouteModule {
  const basePath = options.basePath ?? "/admin/logs";

  return {
    loader: async (c): Promise<LogViewerLoaderData | Response> => {
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
              id={TBODY_ID}
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
  };
}
