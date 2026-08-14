import type { SafeHtml } from "@remix-run/html-template";
import { createHtmlResponse } from "@remix-run/response/html";

/** Re-export of `@remix-run/response`'s redirect helper (also aliased as `redirect`). @public */
export { createRedirectResponse, createRedirectResponse as redirect } from "@remix-run/response/redirect";

/** Constructs a full-page HTML `Response` with a leading `<!DOCTYPE html>`; throws on a caller-supplied `content-type`. @public */
export function htmlResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("htmlResponse: content-type is fixed for HTML responses — remove it from headers");
  }
  return createHtmlResponse(body, { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/** Constructs an HTML fragment `Response` with no DOCTYPE; throws on a caller-supplied `content-type`. @public */
export function fragmentResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("fragmentResponse: content-type is fixed for HTML responses — remove it from headers");
  }
  return new Response(String(body), { status, headers: { ...(headers ?? {}), "content-type": "text/html; charset=utf-8" } });
}
