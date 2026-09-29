import htmx from "htmx.org";

import { ANNOUNCE_BUSY_CHANNEL, ANNOUNCE_FAILURE_CHANNEL } from "../contracts/announcer-contract";
import { announce, announceFailure, announceFieldError, announceSpinner } from "./announce";
import { asElement, eventTarget } from "./dom";
import { registerHtmxSecurity } from "./htmx-security";
import { resumeScope, sweepDetachedScopes } from "./resume";

// The bare `window` and `document` are correct here and nowhere else in `ui/client`: a side-effect entry
// point has no node to derive a realm from, so the realm it is imported into is the one it belongs to.
registerHtmxSecurity(htmx, window);

// htmx's d.ts types `noSwap` as `number[]`, but htmx matches a status-class string such as "5xx" too.
const swapPolicy: { noSwap: Array<number | string> } = htmx.config;
swapPolicy.noSwap = [204, 304, "5xx"];

document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => {
  const first = sheet.cssRules[0];
  return !(first instanceof CSSStyleRule && first.selectorText === `.${htmx.config.indicatorClass}`);
});

document.addEventListener("htmx:after:process", (event) => {
  const el = asElement(eventTarget(event));
  if (!el) return;
  if (el.matches("[data-scope]")) resumeScope(el);
  for (const node of el.querySelectorAll<HTMLElement>("[data-scope]")) resumeScope(node);
  announceFieldError(el);
  announceFailure(el);
  announceSpinner(el, (spinner) => spinner.closest(`.${htmx.config.indicatorClass},[hidden]`) === null);
});

document.addEventListener("htmx:before:request", () => {
  announceSpinner(document, (spinner) => spinner.closest(`.${htmx.config.requestClass}`) !== null);
});

// Not `htmx:finally:request`: htmx 4 fires it after the swap, so it would cancel a spinner the swapped content just queued.
const clearBusy = () => announce("", { channel: ANNOUNCE_BUSY_CHANNEL, within: document });
document.addEventListener("htmx:after:request", clearBusy);
document.addEventListener("htmx:error", clearBusy);

interface HtmxResponseContext {
  swap?: string;
  text?: string;
  response?: { status: number; headers: Headers };
}

const isHtmlResponse = (headers: Headers) => headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "text/html";

// A plain-text refusal (a CSRF 403, a 404, a 429) is a status line, not markup: swapped in, it
// replaces the form it answers. An explicit `hx-status:` still wins, since htmx applies it after this.
document.addEventListener("htmx:after:request", (event) => {
  const ctx = (event as CustomEvent<{ ctx?: HtmxResponseContext }>).detail?.ctx;
  if (!ctx?.response || ctx.response.status < 400 || isHtmlResponse(ctx.response.headers)) return;
  ctx.swap = "none";
  announce(ctx.text ?? "", { channel: ANNOUNCE_FAILURE_CHANNEL, politeness: "assertive", repeat: true, within: document });
});

document.addEventListener("htmx:finally:swap", () => sweepDetachedScopes());

export { htmx };
