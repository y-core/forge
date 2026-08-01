/**
 * Chrome client island — registers the `navbar` and `theme` resumable scopes.
 *
 * Import this module once in the app's client entry (side-effect import) BEFORE
 * calling `resume()`. Both scopes are registered here; `theme` is eager so it
 * reconciles state immediately when `resume()` runs.
 */

// The chrome components' markup names the `menu` and `toolbar` scopes, which `ui/core/client`
// registers. A component whose markup names a scope has to guarantee the scope exists: without
// this, an app importing only `ui/chrome/client` would get `resume()` warnings for scopes nobody
// registered, and its navbar menus and toolbar rails would be dead to the keyboard.
import "../core/client";
import { ownerDocument, ownerWindow } from "../client/dom";
import { registerScope } from "../client/resume";
import type { ReadonlySignal } from "../client/signal";
import { computed, createSignal, effect } from "../client/signal";
import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

// ---------------------------------------------------------------------------
// isDark — stable exported accessor delegating to a module-local current signal.
// can safely destructure/capture `isDark` before resume() runs.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// theme scope
// ---------------------------------------------------------------------------

registerScope<"cycleTheme">("theme", {
  eager: true,
  setup({ root, state }) {
    const pref = state.pref;
    // Every global below is resolved from the scope root, so the theme a document shows is the one
    // its own realm stored and its own realm prefers.
    const doc = ownerDocument(root);
    const win = ownerWindow(root);
    // Reconcile: FOUC script already applied the preference from localStorage;
    // now sync the signal to match so effects start from the real value.
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

// ---------------------------------------------------------------------------
// navbar scope
// ---------------------------------------------------------------------------

// Eager, for the same reason the setup-only scopes in `ui/core/client` are: a lazy scope resumes on
// the first `data-on-*` interaction inside it, and the navbar emits none — its disclosure is a
// native `<details>`, its menus are native popovers and its leaves are plain links. Lazy, the setup
// below would never run at all and runtime auth filtering would silently do nothing.
registerScope("navbar", {
  eager: true,
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
    const doc = ownerDocument(root);
    doc.addEventListener("navbar:filters", onFiltersEvent);

    return () => {
      doc.removeEventListener("navbar:filters", onFiltersEvent);
    };
  },
});
