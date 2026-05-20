import { Hono } from "hono";
import { escapeHtml } from "../html/escape";
import { makeSecurityHeaders } from "../security/headers";
import { createLogger } from "./logger";
import type { AppOptions } from "./types";

const logger = createLogger("app");

export function createApp<T extends object = Record<string, unknown>>(options?: AppOptions<T>): Hono<{ Bindings: T }> {
  const app = new Hono<{ Bindings: T }>();

  app.use("*", makeSecurityHeaders(options?.security));

  app.onError((err, c) => {
    if (options?.onError) {
      return options.onError(err, c);
    }
    logger.error("Unhandled error", { error: err.message });
    const detail = options?.isDebug?.(c)
      ? `<p>${escapeHtml(err.message)}</p>`
      : "<p>An unexpected error occurred.</p>";
    return c.html(
      `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1>${detail}</body></html>`,
      500,
    );
  });

  return app;
}
