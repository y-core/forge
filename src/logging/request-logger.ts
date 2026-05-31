import type { Context, MiddlewareHandler } from "hono";
import { createLogger } from "./logger";
import type { LogChannel, Logger } from "./types";

/** Merge into your Hono app generic to type `c.get("logger")`. @public */
export type LoggerVariables = { Variables: { logger: Logger } };

/** @public */
export interface RequestLoggerOptions {
  prefix?: string;
  channels: LogChannel[];
  bindings?: (c: Context) => Record<string, unknown>;
}

/**
 * Middleware that creates a per-request child logger and sets it on the Hono context via
 * `c.set("logger", ...)`. Flushes all pending async channel writes (e.g. KV puts) via
 * `executionCtx.waitUntil` so log writes never block the response. @public
 */
export function requestLogger(options: RequestLoggerOptions): MiddlewareHandler<LoggerVariables> {
  return async (c, next) => {
    const base = createLogger(options.prefix ?? "request", { channels: options.channels });
    const extraBindings = options.bindings ? options.bindings(c) : {};
    const log = base.child(extraBindings);
    c.set("logger", log);
    try {
      await next();
    } finally {
      const flush = log.flush();
      try {
        c.executionCtx.waitUntil(flush);
      } catch {
        await flush;
      }
    }
  };
}
