import htmx from "htmx.org";
import { asElement, eventTarget } from "./dom";
import { resumeScope } from "./resume";

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

export { htmx };
