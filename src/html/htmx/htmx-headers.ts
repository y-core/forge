import type { RequestContext } from "@remix-run/fetch-router";
import { isHxRequest } from "./hx-request";

export interface HxRequest {
  enabled: boolean;
  boosted: boolean;
  trigger: string;
  target: string;
  triggerName: string;
  currentUrl: string;
}

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

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function isPartial(c: RequestContext<any, any>): boolean {
  return isHxRequest(c) && c.request.headers.get("HX-Boosted") !== "true";
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function isBoosted(c: RequestContext<any, any>): boolean {
  return c.request.headers.get("HX-Boosted") === "true";
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxTrigger(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Trigger") ?? "";
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxTarget(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Target") ?? "";
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxTriggerName(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Trigger-Name") ?? "";
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function hxCurrentUrl(c: RequestContext<any, any>): string {
  return c.request.headers.get("HX-Current-URL") ?? "";
}
