/** localStorage key for the persisted theme preference. @public */
export const THEME_STORAGE_KEY = "themePreference";

/** `<html>` attribute that records the active preference. @public */
export const THEME_ATTR = "data-theme-preference";

/** CSS class toggled on `<html>` when dark mode is active. @public */
export const DARK_CLASS = "dark";

/** Server-default preference (resolved to the OS preference client-side). @public */
export const DEFAULT_THEME_PREF = "system";

/** Every theme preference, in the order the toggle cycles through them. @internal */
export const THEME_PREFS = ["light", DARK_CLASS, DEFAULT_THEME_PREF] as const;

/** Inline script that sets the theme attribute and `.dark` class before first paint. @public */
export const FOUC_SCRIPT =
  `(function(){var e="${DEFAULT_THEME_PREF}";try{e=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(_){}` +
  `if(${JSON.stringify(THEME_PREFS)}.indexOf(e)<0)e="${DEFAULT_THEME_PREF}";` +
  `document.documentElement.setAttribute("${THEME_ATTR}",e);` +
  `if(e==="${DARK_CLASS}"` +
  /* modern-css-allow: forge-ui-platform-theme-detection — the theme is class-driven, so the media query only resolves the `system` preference into that class */
  `||(e==="${DEFAULT_THEME_PREF}"&&typeof window.matchMedia==="function"&&window.matchMedia("(prefers-color-scheme: dark)").matches)){` +
  `document.documentElement.classList.add("${DARK_CLASS}")}})();`;
