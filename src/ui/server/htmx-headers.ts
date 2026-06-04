import type { Context } from "hono";
import { isHxRequest } from "../../security/hx-request";

export interface HxRequest {
  enabled: boolean;
  boosted: boolean;
  trigger: string;
  target: string;
  triggerName: string;
  currentUrl: string;
}

export function readHxRequest(c: Context): HxRequest {
  return {
    enabled: isHxRequest(c),
    boosted: c.req.header("HX-Boosted") === "true",
    trigger: c.req.header("HX-Trigger") ?? "",
    target: c.req.header("HX-Target") ?? "",
    triggerName: c.req.header("HX-Trigger-Name") ?? "",
    currentUrl: c.req.header("HX-Current-URL") ?? "",
  };
}

export function isPartial(c: Context): boolean {
  return isHxRequest(c) && c.req.header("HX-Boosted") !== "true";
}

export function isBoosted(c: Context): boolean {
  return c.req.header("HX-Boosted") === "true";
}

export function hxTrigger(c: Context): string {
  return c.req.header("HX-Trigger") ?? "";
}

export function hxTarget(c: Context): string {
  return c.req.header("HX-Target") ?? "";
}

export function hxTriggerName(c: Context): string {
  return c.req.header("HX-Trigger-Name") ?? "";
}

export function hxCurrentUrl(c: Context): string {
  return c.req.header("HX-Current-URL") ?? "";
}

export function setRedirect(c: Context, url: string): void {
  c.header("HX-Redirect", url);
}

export function setRefresh(c: Context): void {
  c.header("HX-Refresh", "true");
}

export function setPushUrl(c: Context, url: string): void {
  c.header("HX-Push-Url", url);
}

export function setReplaceUrl(c: Context, url: string): void {
  c.header("HX-Replace-Url", url);
}

export function setTrigger(c: Context, value: string): void {
  c.header("HX-Trigger", value);
}

export function setTriggerAfterSettle(c: Context, value: string): void {
  c.header("HX-Trigger-After-Settle", value);
}

export function setTriggerAfterSwap(c: Context, value: string): void {
  c.header("HX-Trigger-After-Swap", value);
}

export function setRetarget(c: Context, selector: string): void {
  c.header("HX-Retarget", selector);
}

export function setReswap(c: Context, strategy: string): void {
  c.header("HX-Reswap", strategy);
}
