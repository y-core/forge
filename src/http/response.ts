import type { SafeHtml } from "./html";

const DOCTYPE = "<!DOCTYPE html>";

// `renderPage` prepends its own DOCTYPE, so the check tolerates casing and leading whitespace.
function withDoctype(body: string): string {
  return /^\s*<!doctype html/i.test(body) ? body : DOCTYPE + body;
}

/** Constructs a redirect `Response` for a location, with an optional status or `ResponseInit`. @public */
export function createRedirectResponse(location: string | URL, init?: ResponseInit | number): Response {
  let status = 302;
  if (typeof init === "number") {
    status = init;
    init = undefined;
  }
  const headers = new Headers(init?.headers);
  if (!headers.has("Location")) {
    headers.set("Location", typeof location === "string" ? location : location.toString());
  }
  return new Response(null, { status, ...init, headers });
}

/** Constructs a full-page HTML `Response` with a leading `<!DOCTYPE html>`; throws on a caller-supplied `content-type`. @public */
export function htmlResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("htmlResponse: content-type is fixed for HTML responses — remove it from headers");
  }
  return new Response(withDoctype(String(body)), { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/** Constructs a JSON `Response`; throws on a caller-supplied `content-type`. @public */
export function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("jsonResponse: content-type is fixed for JSON responses — remove it from headers");
  }
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}

/** Constructs a PDF `Response` from rendered bytes; throws on a caller-supplied `content-type`. @public */
export function pdfResponse(body: BufferSource, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("pdfResponse: content-type is fixed for PDF responses — remove it from headers");
  }
  return new Response(body, { status, headers: { ...headers, "content-type": "application/pdf" } });
}

/** Constructs an HTML fragment `Response` with no DOCTYPE; throws on a caller-supplied `content-type`. @public */
export function fragmentResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("fragmentResponse: content-type is fixed for HTML responses — remove it from headers");
  }
  return new Response(String(body), { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}
