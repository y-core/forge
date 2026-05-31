import type { Context, Env, MiddlewareHandler } from "hono";
import { createLogger } from "./logger";
import type { LogChannel, Logger } from "./types";

/** Merge into your Hono app generic to type `c.get("logger")`. @public */
export type LoggerVariables = { Variables: { logger: Logger } };

/**
 * Note: middleware that sets values consumed by `bindings` (e.g. `requestId`) must run
 * **before** `requestLogger` so those values are available when the callbacks execute. @public
 */
export interface RequestLoggerOptions<E extends Env & LoggerVariables = LoggerVariables> {
  prefix?: string;
  /** Factory called once per request; return the channels to write log records to. */
  channels: (c: Context<E>) => LogChannel[];
  bindings?: (c: Context<E>) => Record<string, unknown>;
}

/**
 * Middleware that creates a per-request child logger and sets it on the Hono context via
 * `c.set("logger", ...)`. Flushes all pending async channel writes (e.g. KV puts) via
 * `executionCtx.waitUntil` so log writes never block the response. @public
 */
export function requestLogger<E extends Env & LoggerVariables = LoggerVariables>(
  options: RequestLoggerOptions<E>,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const base = createLogger(options.prefix ?? "request", { channels: options.channels(c) });
    const log = base.child(options.bindings ? options.bindings(c) : {});
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
