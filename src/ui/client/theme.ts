import { computed, createSignal, effect, type ReadonlySignal } from "./signal";

export interface ThemeControllerOptions {
  toggleSelector?: string;
}

export const THEME_STORAGE_KEY = "themePreference";
export const THEME_ATTR = "data-theme-preference";
export const DARK_CLASS = "dark";
export const DEFAULT_PREF = "system";

export const FOUC_SCRIPT =
  `(function(){var e=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_PREF}";` +
  `document.documentElement.setAttribute("${THEME_ATTR}",e);` +
  `if(e==="${DARK_CLASS}"||(e==="${DEFAULT_PREF}"&&window.matchMedia("(prefers-color-scheme: dark)").matches)){` +
  `document.documentElement.classList.add("${DARK_CLASS}")}})();`;

export let isDark: ReadonlySignal<boolean> = { get value() { return false; } };

let mountedThemeCleanup: (() => void) | null = null;

/** Mounts theme preference controls and returns a cleanup function. Safe to call more than once. @public */
export function mountTheme(options?: ThemeControllerOptions): () => void {
  if (mountedThemeCleanup) {
    return mountedThemeCleanup;
  }

  const { toggleSelector = "[data-ref='theme-toggle']" } = options ?? {};
  const cycle: Record<string, string> = { dark: "system", light: "dark", system: "light" };
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const pref = createSignal(localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_PREF);
  const mqlDark = createSignal(mql.matches);
  const onMediaChange = () => {
    mqlDark.value = mql.matches;
  };

  mql.addEventListener("change", onMediaChange);

  isDark = computed(() =>
    pref.value === "dark" || (pref.value === DEFAULT_PREF && mqlDark.value),
  );

  const disposeAttr = effect(() => {
    document.documentElement.setAttribute(THEME_ATTR, pref.value);
    localStorage.setItem(THEME_STORAGE_KEY, pref.value);
  });

  const disposeClass = effect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, isDark.value);
  });

  const buttons = document.querySelectorAll<HTMLButtonElement>(toggleSelector);
  const onClick = () => {
    pref.value = cycle[pref.value] ?? DEFAULT_PREF;
  };
  buttons.forEach((button) => {
    button.addEventListener("click", onClick);
  });

  mountedThemeCleanup = () => {
    disposeAttr();
    disposeClass();
    mql.removeEventListener("change", onMediaChange);
    buttons.forEach((button) => {
      button.removeEventListener("click", onClick);
    });
    mountedThemeCleanup = null;
  };

  return mountedThemeCleanup;
}
