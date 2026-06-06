import type { RequestContext } from "@remix-run/fetch-router";
import { setPendingHeader } from "../../context/pending-headers";
import { isHxRequest } from "../../security/hx-request";

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

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setRedirect(c: RequestContext<any, any>, url: string): void {
  setPendingHeader(c, "HX-Redirect", url);
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setRefresh(c: RequestContext<any, any>): void {
  setPendingHeader(c, "HX-Refresh", "true");
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setPushUrl(c: RequestContext<any, any>, url: string): void {
  setPendingHeader(c, "HX-Push-Url", url);
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setReplaceUrl(c: RequestContext<any, any>, url: string): void {
  setPendingHeader(c, "HX-Replace-Url", url);
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setTrigger(c: RequestContext<any, any>, value: string): void {
  setPendingHeader(c, "HX-Trigger", value);
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setTriggerAfterSettle(c: RequestContext<any, any>, value: string): void {
  setPendingHeader(c, "HX-Trigger-After-Settle", value);
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setTriggerAfterSwap(c: RequestContext<any, any>, value: string): void {
  setPendingHeader(c, "HX-Trigger-After-Swap", value);
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setRetarget(c: RequestContext<any, any>, selector: string): void {
  setPendingHeader(c, "HX-Retarget", selector);
}

// biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
export function setReswap(c: RequestContext<any, any>, strategy: string): void {
  setPendingHeader(c, "HX-Reswap", strategy);
}
