import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme-constants";

export function initThemeCycler(): void {
  const cycle: Record<string, string> = { system: "light", light: "dark", dark: "system" };
  const mql = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme(pref: string): void {
    document.documentElement.setAttribute(THEME_ATTR, pref);
    document.documentElement.classList.toggle(
      DARK_CLASS,
      pref === DARK_CLASS || (pref === DEFAULT_PREF && mql.matches),
    );
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  }

  document.querySelectorAll<HTMLButtonElement>("[data-ref='theme-toggle']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const current =
        document.documentElement.getAttribute(THEME_ATTR) || DEFAULT_PREF;
      applyTheme(cycle[current]);
    });
  });

  mql.addEventListener("change", () => {
    if (
      (document.documentElement.getAttribute(THEME_ATTR) || DEFAULT_PREF) === DEFAULT_PREF
    ) {
      document.documentElement.classList.toggle(DARK_CLASS, mql.matches);
    }
  });
}
