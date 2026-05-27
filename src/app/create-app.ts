import type { Env } from "hono";
import { Hono } from "hono";
import { escapeHtml } from "../http/escape";
import { createLogger } from "../logging/logger";
import { makeSecurityHeaders } from "../security/headers";
import type { AppOptions } from "./types";

/** Creates a Hono app with security headers middleware and a structured error boundary pre-wired.
 * @public
 */
export function createApp<E extends Env = Env>(options?: AppOptions<E>): Hono<E> {
  const app = new Hono<E>();
  const logger = options?.logger ?? createLogger("app");

  app.use("*", makeSecurityHeaders(options?.security));

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
