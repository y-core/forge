import type { RequestContext } from "@remix-run/fetch-router";
import { isHxRequest } from "./hx-request";

/** The `HX-*` request headers, read in one pass. @public */
export interface HxRequest {
  enabled: boolean;
  boosted: boolean;
  trigger: string;
  target: string;
  triggerName: string;
  currentUrl: string;
}

/** Reads every `HX-*` header of a request into one object. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant for header reading
export function readHxRequest(c: RequestContext<any, any>): HxRequest {
  return {
    enabled: isHxRequest(c),
    boosted: c.request.headers.get("HX-Boosted") === "true",
    trigger: c.request.headers.get("HX-Trigger") ?? "",
    target: c.request.headers.get("HX-Target") ?? "",
    triggerName: c.request.headers.get("HX-Trigger-Name") ?? "",
    currentUrl: c.request.headers.get("HX-Current-URL") ?? "",
  };
}

/** True for an htmx request that is not a boosted full-page navigation. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function isPartial(c: RequestContext<any, any>): boolean {
  return isHxRequest(c) && c.request.headers.get("HX-Boosted") !== "true";
}

/** True when the request came from an `hx-boost`ed element. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function isBoosted(c: RequestContext<any, any>): boolean {
  return c.request.headers.get("HX-Boosted") === "true";
}

/** The id of the element that triggered the request, or `""`. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxTrigger(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Trigger") ?? "";
}

/** The id of the element the response will be swapped into, or `""`. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxTarget(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Target") ?? "";
}

/** The `name` of the element that triggered the request, or `""`. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxTriggerName(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Trigger-Name") ?? "";
}

/** The browser URL the request was made from, or `""`. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxCurrentUrl(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Current-URL") ?? "";
}
