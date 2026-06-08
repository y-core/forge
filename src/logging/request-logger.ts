import type { Middleware } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
import { getAppContext } from "../context/types";
import { createLogger } from "./logger";
import type { Logger, RequestLoggerOptions } from "./types";

export const requestLog = contextVar<Logger>("logger");

/**
 * Middleware that creates a per-request child logger and sets it on the context.
 * Flushes all pending async channel writes via `executionCtx.waitUntil`. @public
 */
export function requestLogger<Bindings = Record<string, unknown>>(options: RequestLoggerOptions<Bindings>): Middleware {
  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const base = createLogger(options.prefix ?? "request", { channels: options.channels(c) });
    const log = base.child(options.bindings ? options.bindings(c) : {});
    requestLog.set(context, log);
    let res: Response | undefined;
    try {
      res = await next();
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
