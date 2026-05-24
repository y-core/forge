import { computed, createSignal, effect, type ReadonlySignal } from "./signal";

// ── constants ─────────────────────────────────
export const THEME_STORAGE_KEY = "themePreference";
export const THEME_ATTR = "data-theme-preference";
export const DARK_CLASS = "dark";
export const DEFAULT_PREF = "system";

// ── FOUC prevention ──────────────────────────
export const FOUC_SCRIPT =
  `(function(){var e=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_PREF}";` +
  `document.documentElement.setAttribute("${THEME_ATTR}",e);` +
  `if(e==="${DARK_CLASS}"||(e==="${DEFAULT_PREF}"&&window.matchMedia("(prefers-color-scheme: dark)").matches)){` +
  `document.documentElement.classList.add("${DARK_CLASS}")}})();`;

// ── runtime theme switch ─────────────────────
export let isDark: ReadonlySignal<boolean>;

/** Wires `[data-ref="theme-toggle"]` buttons to cycle through system/light/dark and persists the choice to localStorage. @public */
export function initThemeSwitch(): void {
  const cycle: Record<string, string> = { system: "light", light: "dark", dark: "system" };
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const pref = createSignal(localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_PREF);
  const mqlDark = createSignal(mql.matches);
  mql.addEventListener("change", () => { mqlDark.value = mql.matches; });

  isDark = computed(() =>
    pref.value === "dark" || (pref.value === "system" && mqlDark.value),
  );

  effect(() => {
    document.documentElement.setAttribute(THEME_ATTR, pref.value);
    localStorage.setItem(THEME_STORAGE_KEY, pref.value);
  });

  effect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, isDark.value);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ref='theme-toggle']").forEach((btn) => {
    btn.addEventListener("click", () => {
      pref.value = cycle[pref.value];
    });
  });
}
