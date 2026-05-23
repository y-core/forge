import { type ReadonlySignal, computed, createSignal, effect } from "./signal";
import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme-constants";

export let isDark: ReadonlySignal<boolean>;

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
