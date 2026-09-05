import htmx from "htmx.org";

import { asElement, eventTarget } from "./dom";
import { disposeScopesIn, resumeScope } from "./resume";

htmx.config.includeIndicatorStyles = false;

// The bare `document` is correct here and nowhere else in `ui/client`: this module is a
// side-effect entry point with no node to derive a realm from, so the realm it is imported into is
// the one it belongs to.
document.body.addEventListener("htmx:load", (event) => {
  const el = asElement(eventTarget(event));
  if (!el) return;
  if (el.matches("[data-scope]")) resumeScope(el);
  for (const node of el.querySelectorAll<HTMLElement>("[data-scope]")) resumeScope(node);
});

// `htmx:load` fires only for content the swap *introduced*, so a swap that removes scoped markup and
// introduces none would run no disposer at all. htmx cleans up every element it removes, and the
// event reaches here while the element is still attached — which is what makes the scope findable.
document.body.addEventListener("htmx:beforeCleanupElement", (event) => {
  const el = asElement(eventTarget(event));
  if (el) disposeScopesIn(el);
});

export { htmx };
