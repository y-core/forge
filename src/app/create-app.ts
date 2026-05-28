import type { Env } from "hono";
import { Hono } from "hono";
import { registerConfig } from "../config/registry";
import { escapeHtml } from "../http/escape";
import { createLogger } from "../logging/logger";
import type { AppOptions } from "./types";

/** Creates a Hono app with a structured error boundary. Security headers must be applied explicitly via `makeSecurityHeaders`. @public */
export function createApp<E extends Env = Env>(options?: AppOptions<E>): Hono<E> {
  const app = new Hono<E>();
  const logger = options?.logger ?? createLogger("app");

  if (options?.config) {
    registerConfig(app, options.config);
  }

  app.onError((err, c) => {
    if (options?.onError) {
      return options.onError(err, c);
    }
    logger.error("Unhandled error", { error: err.message });
    const detail = options?.isDebug?.(c) ? `<p>${escapeHtml(err.message)}</p>` : "<p>An unexpected error occurred.</p>";
    return c.html(
      `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1>${detail}</body></html>`,
      500,
    );
  });

  return app;
}
