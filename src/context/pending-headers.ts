import type { RequestContext } from "@remix-run/fetch-router";
import { contextVar } from "./accessor";

const pendingHeadersCtx = contextVar<Headers>("__pendingResponseHeaders");

/** Queues a response header for this request. Use `applyPendingHeaders` to apply them to the Response. @internal */
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for header queuing
export function setPendingHeader(context: RequestContext<any, any>, name: string, value: string, options?: { append?: boolean }): void {
  let headers = pendingHeadersCtx.getOptional(context);
  if (!headers) {
    headers = new Headers();
    pendingHeadersCtx.set(context, headers);
  }
  if (options?.append) {
    headers.append(name, value);
  } else {
    headers.set(name, value);
  }
}

/** Applies any queued response headers from this context to a Response object. @internal */
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant
export function applyPendingHeaders(context: RequestContext<any, any>, response: Response): Response {
  const pending = pendingHeadersCtx.getOptional(context);
  if (!pending) return response;
  const headers = new Headers(response.headers);
  // `set-cookie` is multi-valued: append each distinct cookie so none clobbers another.
  // `getSetCookie()` returns them individually (unlike `entries()`, which may comma-join).
  for (const cookie of pending.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  // All other queued headers replace any existing value so single-valued headers
  // (e.g. content-security-policy) cannot be duplicated when applied.
  for (const [name, value] of pending.entries()) {
    if (name === "set-cookie") continue;
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
