import htmx from "htmx.org";
import { resumeScope } from "./resume";

htmx.config.includeIndicatorStyles = false;

// Resume any resumable scopes inside OOB-swapped or dynamically-inserted content.
document.body.addEventListener("htmx:load", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.matches("[data-scope]")) resumeScope(el);
  for (const node of el.querySelectorAll<HTMLElement>("[data-scope]")) resumeScope(node);
});

export { htmx };
