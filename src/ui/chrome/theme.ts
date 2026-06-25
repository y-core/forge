/** Theme constants shared between the SSR view and the client scope. SSR-safe: no DOM access. */

/** localStorage key for the persisted theme preference. @public */
export const THEME_STORAGE_KEY = "themePreference";

/** `<html>` attribute that records the active preference. @public */
export const THEME_ATTR = "data-theme-preference";

/** CSS class toggled on `<html>` when dark mode is active. @public */
export const DARK_CLASS = "dark";

/** Server-default preference (resolved to the OS preference client-side). @public */
export const DEFAULT_PREF = "system";

/** Inline script that sets the theme attribute + `.dark` class before first paint (FOUC guard).
 *  Embed in a nonce'd `<script>` tag in the `<head>`. @public */
export const FOUC_SCRIPT =
  `(function(){var e=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_PREF}";` +
  `document.documentElement.setAttribute("${THEME_ATTR}",e);` +
  `if(e==="${DARK_CLASS}"` +
  `||(e==="${DEFAULT_PREF}"&&window.matchMedia("(prefers-color-scheme: dark)").matches)){` +
  `document.documentElement.classList.add("${DARK_CLASS}")}})();`;
