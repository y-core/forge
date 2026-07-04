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
 * duration, at a level derived from the status code. A throwing handler produces one `error`
 * record with the serialized error instead, then rethrows. Flushes all pending async channel
 * writes via `executionCtx.waitUntil`. @public
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
