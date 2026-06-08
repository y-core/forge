import { registerScope } from "../client/resume";
import { computed, effect } from "../client/signal";

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
