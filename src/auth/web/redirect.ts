import type { RequestContext } from "../../context/types";
import { hxHeaders } from "../../html/htmx/htmx-response";
import { isHxRequest } from "../../html/htmx/hx-request";
import { createRedirectResponse } from "../../http/response";

/** The status an auth write redirects a plain request with, so the browser follows it by GET. @internal */
export const AUTH_REDIRECT_STATUS = 303;

// `fetch` follows a 3xx transparently, so an htmx request answered with one swaps the other page
// into the form and leaves the address bar behind; `HX-Redirect` makes htmx navigate instead.
/** Sends the visitor to `location`: a 204 carrying `HX-Redirect` for an htmx request, else a redirect with `status`. @internal */
export function createAuthRedirect(context: RequestContext, location: string, status: number = AUTH_REDIRECT_STATUS): Response {
  if (isHxRequest(context)) return new Response(null, { status: 204, headers: hxHeaders({ redirect: location }) });
  return createRedirectResponse(location, status);
}
