import type { RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "./accessor";

const pendingHeadersCtx = contextVar<Headers>("__pendingResponseHeaders");

// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for header queuing
function pendingHeaders(context: RequestContext<any, any>): Headers {
  const existing = pendingHeadersCtx.getOptional(context);
  if (existing) return existing;
  const headers = new Headers();
  pendingHeadersCtx.set(context, headers);
  return headers;
}

/** Queues a response header for this request. `mergePendingHeaders` folds them into a response's headers. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for header queuing
export function setPendingHeader(context: RequestContext<any, any>, name: string, value: string, options?: { append?: boolean }): void {
  const headers = pendingHeaders(context);
  if (options?.append) {
    headers.append(name, value);
  } else {
    headers.set(name, value);
  }
}

/** The value of the last `Set-Cookie` queued for `name` this request, or `null` when none is. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for header queuing
export function pendingCookieValue(context: RequestContext<any, any>, name: string): string | null {
  const headers = pendingHeadersCtx.getOptional(context);
  if (!headers) return null;
  const queued = headers.getSetCookie().findLast((header) => header.startsWith(`${name}=`));
  if (queued === undefined) return null;
  const end = queued.indexOf(";");
  return queued.slice(name.length + 1, end === -1 ? undefined : end);
}

/** Queues `setCookie` in place of every `Set-Cookie` already queued for the same cookie name this request. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for header queuing
export function replacePendingCookie(context: RequestContext<any, any>, setCookie: string): void {
  const name = setCookie.slice(0, setCookie.indexOf("="));
  const headers = pendingHeaders(context);
  const kept = headers.getSetCookie().filter((header) => !header.startsWith(`${name}=`));
  headers.delete("set-cookie");
  for (const header of kept) headers.append("set-cookie", header);
  headers.append("set-cookie", setCookie);
}

/** The response's headers with this request's queued ones folded in, or `null` when none are queued. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant
export function mergePendingHeaders(context: RequestContext<any, any>, response: Response): Headers | null {
  const pending = pendingHeadersCtx.getOptional(context);
  if (!pending) return null;
  const headers = new Headers(response.headers);
  // `getSetCookie()` yields each cookie individually; `entries()` may comma-join them into one value.
  for (const cookie of pending.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  for (const [name, value] of pending.entries()) {
    if (name === "set-cookie") continue;
    const own = name === "content-security-policy" ? response.headers.get(name) : null;
    headers.set(name, value);
    if (own !== null) headers.append(name, own);
  }
  return headers;
}
