import type { RequestContext } from "@remix-run/fetch-router";

import { isHxRequest } from "./hx-request";
import type { HxRequest } from "./types";

// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
function readHxRequestType(c: RequestContext<any, any>): HxRequest["requestType"] {
  const value = c.request.headers.get("HX-Request-Type");
  return value === "full" || value === "partial" ? value : "";
}

/** Reads every `HX-*` header of a request into one object. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant for header reading
export function readHxRequest(c: RequestContext<any, any>): HxRequest {
  return {
    enabled: isHxRequest(c),
    boosted: c.request.headers.get("HX-Boosted") === "true",
    source: c.request.headers.get("HX-Source") ?? "",
    target: c.request.headers.get("HX-Target") ?? "",
    requestType: readHxRequestType(c),
    currentUrl: c.request.headers.get("HX-Current-URL") ?? "",
  };
}

/** True for an htmx request that asked for a fragment — a boosted navigation and a history restore ask for a page. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
export function isPartial(c: RequestContext<any, any>): boolean {
  return isHxRequest(c) && c.request.headers.get("HX-Request-Type") === "partial";
}

/** True when the request came from an `hx-boost`ed element. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
export function isBoosted(c: RequestContext<any, any>): boolean {
  return c.request.headers.get("HX-Boosted") === "true";
}

/** The `tag#id` identifier of the element that issued the request, or `""`. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
export function hxSource(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Source") ?? "";
}

/** The `tag#id` identifier of the element the response is swapped into, or `""`. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
export function hxTarget(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Target") ?? "";
}

/** The browser URL the request was made from, or `""`. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
export function hxCurrentUrl(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Current-URL") ?? "";
}
