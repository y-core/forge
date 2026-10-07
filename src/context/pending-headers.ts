import type { RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "./accessor";

const pendingHeadersCtx = contextVar<Headers>("__pendingResponseHeaders");

/** Queues a response header for this request. `mergePendingHeaders` folds them into a response's headers. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for header queuing
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
