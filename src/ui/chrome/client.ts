// The chrome components' markup names the `menu` and `toolbar` scopes, which `ui/core/client`
// registers — an app importing only this entry would otherwise resume neither.
import "../core/client";
import { eventTarget, ownerDocument, ownerWindow, safeStorage } from "../client/dom";
import { mountNavDrawer } from "../client/drawer";
import { registerScope } from "../client/resume";
import { computed, createSignal, effect, withOwner } from "../client/signal";
import type { ReadonlySignal, Signal } from "../client/types";
import { mountViewportCollapse } from "../client/viewport-collapse";
import { NAVBAR_DRAWER_ATTR, NAVBAR_FILTERS_EVENT, NAVBAR_SCOPE } from "../contracts/navbar-contract";
import { THEME_SCOPE } from "../contracts/theme-toggle-contract";
import type { ThemeAction } from "../contracts/types";
import { DARK_CLASS, DEFAULT_THEME_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

const CONSTANT_FALSE: ReadonlySignal<boolean> = {
  get value() {
    return false;
  },
};

interface ThemeDocument {
  pref: Signal<string>;
  dark: ReadonlySignal<boolean>;
  holders: number;
  release: () => void;
}

const themes = new WeakMap<Document, ThemeDocument>();

const liveThemes: ThemeDocument[] = [];

/** Whether the active resolved theme is dark. `false` until a theme scope resumes. @public */
export const isDark: ReadonlySignal<boolean> = {
  get value() {
    return (liveThemes.at(-1)?.dark ?? CONSTANT_FALSE).value;
  },
};

function createThemeDocument(doc: Document): ThemeDocument {
  const win = ownerWindow(doc);
  const storage = safeStorage(win);
  // The FOUC script already applied the stored preference, so the signal is seeded from storage
  // rather than the other way round.
  const pref = createSignal(storage?.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_PREF);

  // A realm without `matchMedia` still gets a working explicit light/dark preference; only the
  // `system` branch degrades, so this reports and carries on with a signal nothing ever moves.
  /* modern-css-allow: forge-ui-platform-theme-detection — the theme is class-driven, so the media query only resolves the `system` preference into that class */
  const mql = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mql === null) console.warn("[theme] matchMedia is unavailable; the system colour-scheme preference will not track");
  const mqlDark = createSignal(mql?.matches === true);
  const onMediaChange = () => {
    mqlDark.value = mql?.matches === true;
  };
  mql?.addEventListener("change", onMediaChange);

  const dark = computed(() => pref.value === "dark" || (pref.value === DEFAULT_THEME_PREF && mqlDark.value));

  // Nested inside the owner the resuming scope installed, so these effects land in a bag that scope's
  // disposal does not empty — the first of two toggles to go away must not stop the painting.
  const owned = withOwner(() => {
    effect(() => {
      doc.documentElement.setAttribute(THEME_ATTR, pref.value);
      storage?.setItem(THEME_STORAGE_KEY, pref.value);
    });

    effect(() => {
      doc.documentElement.classList.toggle(DARK_CLASS, dark.value);
    });
  });

  const theme: ThemeDocument = {
    pref,
    dark,
    holders: 0,
    release: () => {
      owned.dispose();
      mql?.removeEventListener("change", onMediaChange);
      themes.delete(doc);
      const index = liveThemes.indexOf(theme);
      if (index !== -1) liveThemes.splice(index, 1);
    },
  };
  themes.set(doc, theme);
  liveThemes.push(theme);
  return theme;
}

function acquireTheme(doc: Document): ThemeDocument {
  const theme = themes.get(doc) ?? createThemeDocument(doc);
  theme.holders += 1;
  return theme;
}

function releaseTheme(theme: ThemeDocument): void {
  theme.holders -= 1;
  if (theme.holders <= 0) theme.release();
}

registerScope<ThemeAction>(THEME_SCOPE, {
  eager: true,
  setup({ root, state }) {
    const theme = acquireTheme(ownerDocument(root));
    // Re-points this root's hydrated `pref` at the document's, so every toggle reads and writes one
    // signal — `resume` hands this same record to the action handlers.
    state.pref = theme.pref;
    return () => releaseTheme(theme);
  },
  on: {
    cycleTheme({ root }) {
      const theme = themes.get(ownerDocument(root));
      if (!theme) return;
      const cycle: Record<string, string> = { dark: "system", light: "dark", system: "light" };
      theme.pref.value = cycle[theme.pref.value] ?? DEFAULT_THEME_PREF;
    },
  },
});

// Eager: the navbar emits no `data-on-*`, so a lazy scope would never resume.
registerScope<"closeNav">(NAVBAR_SCOPE, {
  eager: true,
  setup: ({ root, state }) => {
    const filters = state.filters;

    effect(() => {
      const active = new Set(((filters?.value as string[] | undefined) ?? []).map(String));
      for (const el of root.querySelectorAll<HTMLElement>("[data-filter]")) {
        const tokens = (el.getAttribute("data-filter") ?? "").split(/\s+/).filter(Boolean);
        // Carrying `data-filter` at all is the opt-in: an empty token list can match nothing, so it
        // stays hidden rather than being unhidden back over the `hidden` the server rendered.
        el.hidden = !tokens.some((t) => active.has(t));
      }
    });

    const applyFilters = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (filters && Array.isArray(detail)) filters.value = detail as string[];
    };
    // Per bar on the root, since a document listener misses a shadow-hosted bar's uncomposed dispatch
    // and sees a composed one retargeted to the host; the document keeps only its own dispatches.
    const doc = ownerDocument(root);
    const onDocumentFilters = (event: Event) => {
      if (eventTarget(event) === doc) applyFilters(event);
    };
    root.addEventListener(NAVBAR_FILTERS_EVENT, applyFilters, { capture: true });
    doc.addEventListener(NAVBAR_FILTERS_EVENT, onDocumentFilters);

    // `~=` because `data-slot` is a token list: `slotToken` appends an inherited token when a
    // `Navbar` is composed under another compound, and an exact match would skip those bars.
    const bar = root.querySelector<HTMLDetailsElement>("[data-slot~='navbar']");
    const disposeCollapse = bar ? mountViewportCollapse({ element: bar }) : null;
    const disposeDrawer = bar?.hasAttribute(NAVBAR_DRAWER_ATTR) ? mountNavDrawer({ element: bar }) : null;

    return () => {
      disposeDrawer?.();
      disposeCollapse?.();
      root.removeEventListener(NAVBAR_FILTERS_EVENT, applyFilters, { capture: true });
      doc.removeEventListener(NAVBAR_FILTERS_EVENT, onDocumentFilters);
    };
  },
  on: {
    closeNav: ({ root }) => {
      const bar = root.querySelector<HTMLDetailsElement>("[data-slot~='navbar']");
      if (bar) bar.open = false;
    },
  },
});
