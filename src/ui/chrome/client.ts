/**
 * Chrome client island — registers the `navbar` and `theme` resumable scopes.
 *
 * Import this module once in the app's client entry (side-effect import) BEFORE
 * calling `resume()`. Both scopes are registered here; `theme` is eager so it
 * reconciles state immediately when `resume()` runs.
 */

import { registerScope } from "../client/resume";
import type { ReadonlySignal } from "../client/signal";
import { computed, createSignal, effect } from "../client/signal";
import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

// ---------------------------------------------------------------------------
// isDark — exported live signal; reassigned inside theme setup (same module).
// ---------------------------------------------------------------------------

/** Whether the active resolved theme is dark. `false` until the theme scope resumes. @public */
export let isDark: ReadonlySignal<boolean> = {
  get value() {
    return false;
  },
};

// ---------------------------------------------------------------------------
// theme scope
// ---------------------------------------------------------------------------

registerScope<"cycleTheme">("theme", {
  eager: true,
  setup({ state }) {
    const pref = state.pref;
    // Reconcile: FOUC script already applied the preference from localStorage;
    // now sync the signal to match so effects start from the real value.
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (pref && stored) pref.value = stored;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const mqlDark = createSignal(mql.matches);
    const onMediaChange = () => {
      mqlDark.value = mql.matches;
    };
    mql.addEventListener("change", onMediaChange);

    const dark = computed(() => (pref?.value as string) === "dark" || ((pref?.value as string) === DEFAULT_PREF && mqlDark.value));
    isDark = dark;

    const disposeAttr = effect(() => {
      document.documentElement.setAttribute(THEME_ATTR, (pref?.value as string) ?? DEFAULT_PREF);
      localStorage.setItem(THEME_STORAGE_KEY, (pref?.value as string) ?? DEFAULT_PREF);
    });

    const disposeClass = effect(() => {
      document.documentElement.classList.toggle(DARK_CLASS, dark.value);
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

// ---------------------------------------------------------------------------
// navbar scope
// ---------------------------------------------------------------------------

registerScope("navbar", {
  setup: ({ root, state }) => {
    const filters = state.filters;

    // 1. Sync `hidden` on every filtered element to the active token set.
    effect(() => {
      const active = new Set(((filters?.value as string[] | undefined) ?? []).map(String));
      for (const el of root.querySelectorAll<HTMLElement>("[data-filter]")) {
        const tokens = (el.getAttribute("data-filter") ?? "").split(/\s+/).filter(Boolean);
        el.hidden = tokens.length > 0 && !tokens.some((t) => active.has(t));
      }
    });

    // 2. Apply runtime auth changes pushed by the app.
    const onFiltersEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (filters && Array.isArray(detail)) filters.value = detail as string[];
    };
    document.addEventListener("navbar:filters", onFiltersEvent);

    return () => {
      document.removeEventListener("navbar:filters", onFiltersEvent);
    };
  },
  on: {},
});
