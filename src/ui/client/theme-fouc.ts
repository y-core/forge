import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme-constants";

export const FOUC_SCRIPT =
  `(function(){var e=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_PREF}";` +
  `document.documentElement.setAttribute("${THEME_ATTR}",e);` +
  `if(e==="${DARK_CLASS}"||(e==="${DEFAULT_PREF}"&&window.matchMedia("(prefers-color-scheme: dark)").matches)){` +
  `document.documentElement.classList.add("${DARK_CLASS}")}})();`;
