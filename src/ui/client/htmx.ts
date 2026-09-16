import htmx from "htmx.org";

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
});

// `htmx:load` fires only for content a swap *introduced*, so a removal needs its own hook; this one
// arrives while the element is still attached, which is what makes the scope findable.
document.body.addEventListener("htmx:beforeCleanupElement", (event) => {
  const el = asElement(eventTarget(event));
  if (el) disposeScopesIn(el);
});

export { htmx };
