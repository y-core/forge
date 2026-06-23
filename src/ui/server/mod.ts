/**
 * Server-side JSX components for `@y-core/forge/ui/server`. @public
 *
 * Exports flash messages, `ThemeToggle`, and `Resumable`.
 * HTMX helpers (headers, attrs, patterns) moved to `@y-core/forge/html/htmx`.
 * Import only in SSR/Workers contexts — never in browser bundles.
 */

export { fieldAttr } from "./field-attr";
export type { FlashMessage, FlashType } from "./flash";
export { Flash, FlashContainer, FlashOob } from "./flash";
export type { FlashCookieOptions, Flasher } from "./flash-cookie";
export { createFlash } from "./flash-cookie";
export type { ResumableProps } from "./resumable";
export { Resumable } from "./resumable";
export type { ScopeAttrsProps } from "./scope-attrs";
export { scopeAttrs } from "./scope-attrs";
export { ThemeToggle } from "./theme-toggle";
