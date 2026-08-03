import type { Middleware } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
import { getAppContext } from "../context/types";
import { createLogger } from "./logger";
import { serializeError } from "./serialize-error";
import type { Logger, LogLevel, RequestLoggerOptions } from "./types";

export const requestLog = contextVar<Logger>("logger");

function levelForStatus(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

/**
 * Middleware that creates a per-request child logger, sets it on the context, and emits one
 * summary record per request/response cycle — method, query-stripped path, status, and
 * duration, at a level derived from the status code. A throwing handler is converted to a 500 by
 * the app's error boundary before `next()` resolves, so it appears here as an error-level summary;
 * the boundary publishes the serialized error as a separate record on this same logger. A throw
 * that escapes `next()` — from middleware registered below this one — is recorded here with the
 * serialized error and rethrown. Flushes all pending async channel writes via
 * `executionCtx.waitUntil`. @public
 */
export function requestLogger<Bindings = Record<string, unknown>>(options: RequestLoggerOptions<Bindings>): Middleware {
  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const minLevel = typeof options.minLevel === "function" ? options.minLevel(c) : options.minLevel;
    const base = createLogger(options.prefix ?? "request", { channels: options.channels(c), ...(minLevel !== undefined ? { minLevel } : {}) });
    const log = base.child(options.bindings ? options.bindings(c) : {});
    requestLog.set(context, log);
    const method = c.request.method;
    const path = c.url.pathname;
    const start = Date.now();
    let res: Response | undefined;
    try {
      res = await next();
      log[levelForStatus(res.status)](`${method} ${path}`, { method, path, status: res.status, duration: Date.now() - start });
    } catch (err) {
      // Reached when a throw escapes `next()` — in practice, middleware registered below this
      // one, since the app's error boundary sits deeper still and absorbs handler throws before
      // they get here. The outer boundary appends a second, `"unhandled error"` record after this
      // one; the `finally` below has already spliced the pending buffer by then, so that record
      // schedules its *own* flush rather than relying on this window.
      log.error(`${method} ${path}`, { method, path, duration: Date.now() - start, error: serializeError(err) });
      throw err;
    } finally {
      const flush = log.flush();
      try {
        c.executionCtx.waitUntil(flush);
      } catch {
        await flush;
      }
    }
    return res as Response;
  };
}
