// The chrome components' markup names the `menu` and `toolbar` scopes, which `ui/core/client`
// registers — an app importing only this entry would otherwise resume neither.
import "../core/client";
import { ownerDocument, ownerWindow, safeStorage } from "../client/dom";
import { mountNavDrawer } from "../client/drawer";
import { registerScope } from "../client/resume";
import type { ReadonlySignal, Signal } from "../client/signal";
import { computed, createSignal, effect, withOwner } from "../client/signal";
import { mountViewportCollapse } from "../client/viewport-collapse";
import { NAVBAR_DRAWER_ATTR, NAVBAR_FILTERS_EVENT } from "../contracts/navbar-contract";
import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

const CONSTANT_FALSE: ReadonlySignal<boolean> = {
  get value() {
    return false;
  },
};

/** One document's theme preference, the media listener that resolves `system`, and the effects that
 * paint `<html>` — held open by however many theme scopes have acquired it. */
interface ThemeDocument {
  pref: Signal<string>;
  dark: ReadonlySignal<boolean>;
  holders: number;
  release: () => void;
}

/** Per document rather than per scope: the preference belongs to the document, and a navbar toggle
 * beside a settings toggle each mutating its own signal left the other cycling from a stale value. */
const themes = new WeakMap<Document, ThemeDocument>();

/** Every live document's theme, newest last, so the single `isDark` export has one to report. */
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
  const pref = createSignal(storage?.getItem(THEME_STORAGE_KEY) ?? DEFAULT_PREF);

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

  const dark = computed(() => pref.value === "dark" || (pref.value === DEFAULT_PREF && mqlDark.value));

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

registerScope<"cycleTheme">("theme", {
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
      theme.pref.value = cycle[theme.pref.value] ?? DEFAULT_PREF;
    },
  },
});

// Eager: the navbar emits no `data-on-*`, so a lazy scope would never resume.
registerScope<"closeNav">("navbar", {
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
    doc.addEventListener(NAVBAR_FILTERS_EVENT, onFiltersEvent);

    // `~=` because `data-slot` is a token list: `slotToken` appends an inherited token when a
    // `Navbar` is composed under another compound, and an exact match would skip those bars.
    const bar = root.querySelector<HTMLDetailsElement>("[data-slot~='navbar']");
    const disposeCollapse = bar ? mountViewportCollapse({ element: bar }) : null;
    const disposeDrawer = bar?.hasAttribute(NAVBAR_DRAWER_ATTR) ? mountNavDrawer({ element: bar }) : null;

    return () => {
      disposeDrawer?.();
      disposeCollapse?.();
      doc.removeEventListener(NAVBAR_FILTERS_EVENT, onFiltersEvent);
    };
  },
  on: {
    closeNav: ({ root }) => {
      const bar = root.querySelector<HTMLDetailsElement>("[data-slot~='navbar']");
      if (bar) bar.open = false;
    },
  },
});
