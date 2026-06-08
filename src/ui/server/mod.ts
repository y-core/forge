/**
 * Server-side JSX components for `@y-core/forge/ui/server`. @public
 *
 * Exports flash messages, `ThemeToggle`, and `Resumable`.
 * HTMX helpers (headers, attrs, patterns) moved to `@y-core/forge/html/htmx`.
 * Import only in SSR/Workers contexts — never in browser bundles.
 */
export type { FlashMessage, FlashType } from "./flash";
export { Flash, FlashContainer, FlashOob } from "./flash";
export type { FlashCookieOptions, Flasher } from "./flash-cookie";
export { createFlash } from "./flash-cookie";
export { Resumable } from "./resumable";
export { SpeechRecognition } from "./speech-recognition";
export { ThemeToggle } from "./theme-toggle";
