import { elementById } from "../client/dom";
import { openPopoverAt } from "../client/popover-anchor";
import { registerScope } from "../client/resume";
import { computed, effect } from "../client/signal";

/**
 * The context-menu demo. Eager, because `contextmenu` is not one of the four delegated
 * `SCOPE_EVENTS` — there is no `data-on-*` in the markup for a lazy scope to resume on, so the
 * listener has to be bound at `resume()` or never.
 */
registerScope("show-context-menu", {
  eager: true,
  setup: ({ root, state }) => {
    const popup = elementById(root, String(state.target?.value ?? ""));
    if (!popup) return;
    const onContextMenu = (event: Event) => {
      event.preventDefault();
      const { clientX, clientY } = event as MouseEvent;
      openPopoverAt(popup, clientX, clientY);
    };
    root.addEventListener("contextmenu", onContextMenu);
    return () => root.removeEventListener("contextmenu", onContextMenu);
  },
});

registerScope("show-filter", {
  setup: ({ root, state }) => {
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-filter-item]")).map((el) => ({
      el,
      text: (el.textContent ?? "").toLowerCase(),
    }));
    const countEl = root.querySelector("[data-ref='count']");
    const querySignal = state.query;
    const visible = computed(() => items.filter((i) => i.text.includes(String(querySignal?.value ?? "").toLowerCase())));
    effect(() => {
      const shown = new Set(visible.value);
      for (const i of items) i.el.hidden = !shown.has(i);
      if (countEl) countEl.textContent = String(visible.value.length);
    });
  },
  on: {
    filter: ({ el, state }) => {
      const querySignal = state.query;
      if (querySignal) querySignal.value = (el as HTMLInputElement).value;
    },
  },
});
