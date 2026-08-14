// The chrome components' markup names the `menu` and `toolbar` scopes, which `ui/core/client`
// registers — an app importing only this entry would otherwise resume neither.
import "../core/client";
import { ownerDocument, ownerWindow } from "../client/dom";
import { registerScope } from "../client/resume";
import type { ReadonlySignal } from "../client/signal";
import { computed, createSignal, effect } from "../client/signal";
import { mountViewportCollapse } from "../client/viewport-collapse";
import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

let current: ReadonlySignal<boolean> = {
  get value() {
    return false;
  },
};

/** Whether the active resolved theme is dark. `false` until the theme scope resumes. @public */
export const isDark: ReadonlySignal<boolean> = {
  get value() {
    return current.value;
  },
};

registerScope<"cycleTheme">("theme", {
  eager: true,
  setup({ root, state }) {
    const pref = state.pref;
    const doc = ownerDocument(root);
    const win = ownerWindow(root);
    // The FOUC script already applied the stored preference, so the signal is synced to match it
    // rather than the other way round.
    const stored = win.localStorage.getItem(THEME_STORAGE_KEY);
    if (pref && stored) pref.value = stored;

    const mql = win.matchMedia("(prefers-color-scheme: dark)");
    const mqlDark = createSignal(mql.matches);
    const onMediaChange = () => {
      mqlDark.value = mql.matches;
    };
    mql.addEventListener("change", onMediaChange);

    const dark = computed(() => (pref?.value as string) === "dark" || ((pref?.value as string) === DEFAULT_PREF && mqlDark.value));
    current = dark;

    const disposeAttr = effect(() => {
      doc.documentElement.setAttribute(THEME_ATTR, (pref?.value as string) ?? DEFAULT_PREF);
      win.localStorage.setItem(THEME_STORAGE_KEY, (pref?.value as string) ?? DEFAULT_PREF);
    });

    const disposeClass = effect(() => {
      doc.documentElement.classList.toggle(DARK_CLASS, dark.value);
    });

    return () => {
      disposeAttr();
      disposeClass();
      mql.removeEventListener("change", onMediaChange);
    };
  },
  on: {
    cycleTheme({ state }) {
      const pref = state.pref;
      if (!pref) return;
      const cycle: Record<string, string> = { dark: "system", light: "dark", system: "light" };
      pref.value = cycle[pref.value as string] ?? DEFAULT_PREF;
    },
  },
});

// Eager: the navbar emits no `data-on-*`, so a lazy scope would never resume.
registerScope("navbar", {
  eager: true,
  setup: ({ root, state }) => {
    const filters = state.filters;

    effect(() => {
      const active = new Set(((filters?.value as string[] | undefined) ?? []).map(String));
      for (const el of root.querySelectorAll<HTMLElement>("[data-filter]")) {
        const tokens = (el.getAttribute("data-filter") ?? "").split(/\s+/).filter(Boolean);
        el.hidden = tokens.length > 0 && !tokens.some((t) => active.has(t));
      }
    });

    const onFiltersEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (filters && Array.isArray(detail)) filters.value = detail as string[];
    };
    const doc = ownerDocument(root);
    doc.addEventListener("navbar:filters", onFiltersEvent);

    // `~=` because `data-slot` is a token list: `slotToken` appends an inherited token when a
    // `Navbar` is composed under another compound, and an exact match would skip those bars.
    const bar = root.querySelector<HTMLDetailsElement>("[data-slot~='navbar']");
    const disposeCollapse = bar ? mountViewportCollapse({ element: bar }) : null;

    return () => {
      disposeCollapse?.();
      doc.removeEventListener("navbar:filters", onFiltersEvent);
    };
  },
});
