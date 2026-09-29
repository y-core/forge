import type { Middleware } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import { matchedRoutePattern } from "../context/route-pattern";
import { getAppContext } from "../context/types";
import { createLogger } from "./logger";
import { serializeError } from "./serialize-error";
import type { Logger, LogLevel, RequestLoggerOptions } from "./types";

/** Typed accessor for the per-request logger that `requestLogger` sets on the context. @public */
export const requestLog = contextVar<Logger>("logger");

function levelForStatus(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

/** Middleware that creates a per-request child logger and emits one summary record per request. @public */
export function requestLogger<Bindings = Record<string, unknown>>(options: RequestLoggerOptions<Bindings>): Middleware {
  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const minLevel = typeof options.minLevel === "function" ? options.minLevel(c) : options.minLevel;
    const base = createLogger(options.prefix ?? "request", {
      channels: options.channels(c),
      ...(minLevel !== undefined ? { minLevel } : {}),
      ...(options.onChannelError !== undefined ? { onChannelError: options.onChannelError } : {}),
      ...(options.redact !== undefined ? { redact: options.redact } : {}),
    });
    const log = base.child(options.bindings ? options.bindings(c) : {});
    requestLog.set(context, log);
    const method = c.request.method;
    const path = c.url.pathname;
    const start = Date.now();
    let res: Response | undefined;
    try {
      res = await next();
      const routePattern = matchedRoutePattern.getOptional(context) ?? null;
      log[levelForStatus(res.status)]("request.completed", { method, path, routePattern, status: res.status, duration: Date.now() - start });
    } catch (err) {
      // A client that disconnected mid-request is cancellation, not an error worth a record.
      if (!c.request.signal.aborted) {
        const routePattern = matchedRoutePattern.getOptional(context) ?? null;
        log.error("request.failed", { method, path, routePattern, duration: Date.now() - start, error: serializeError(err) });
      }
      throw err;
    } finally {
      // A throw from this `finally` would replace the propagating error or the response, so flush can never reject here.
      const flush = log.flush().catch(() => {});
      try {
        c.executionCtx.waitUntil(flush);
      } catch {
        await flush;
      }
    }
    return res as Response;
  };
}
