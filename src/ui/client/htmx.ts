import htmx from "htmx.org";

import { ANNOUNCE_BUSY_CHANNEL } from "../contracts/announcer-contract";
import { announce, announceFailure, announceFieldError, announceSpinner } from "./announce";
import { asElement, eventTarget } from "./dom";
import { disposeScopesIn, resumeScope } from "./resume";

htmx.config.includeIndicatorStyles = false;

// The bare `document` is correct here and nowhere else in `ui/client`: a side-effect entry point
// has no node to derive a realm from, so the realm it is imported into is the one it belongs to.
document.body.addEventListener("htmx:load", (event) => {
  const el = asElement(eventTarget(event));
  if (!el) return;
  if (el.matches("[data-scope]")) resumeScope(el);
  for (const node of el.querySelectorAll<HTMLElement>("[data-scope]")) resumeScope(node);
  announceFieldError(el);
  announceFailure(el);
  announceSpinner(el, (spinner) => spinner.closest(`.${htmx.config.indicatorClass},[hidden]`) === null);
});

// `beforeRequest` fires before htmx marks the request's indicators, so the spinner is looked for once it has.
document.body.addEventListener("htmx:beforeSend", () => {
  announceSpinner(document, (spinner) => spinner.closest(`.${htmx.config.requestClass}`) !== null);
});

document.body.addEventListener("htmx:afterRequest", () => announce("", { channel: ANNOUNCE_BUSY_CHANNEL, within: document }));

// `htmx:load` fires only for content a swap *introduced*, so a removal needs its own hook; this one
// arrives while the element is still attached, which is what makes the scope findable.
document.body.addEventListener("htmx:beforeCleanupElement", (event) => {
  const el = asElement(eventTarget(event));
  if (el) disposeScopesIn(el);
});

export { htmx };
