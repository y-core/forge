/**
 * Server-side HTMX helpers and JSX components for `@y-core/forge/ui/server`. @public
 *
 * Exports flash messages, HTMX header helpers (`hxTrigger`, `setPushUrl`, etc.),
 * HTMX patterns (`formSubmit`, `liveSearch`, `infiniteScroll`, etc.), `ThemeToggle`,
 * and `Resumable`. Import only in SSR/Workers contexts — never in browser bundles.
 */
export type { FlashMessage, FlashType } from "./flash";
export { Flash, FlashContainer, FlashOob } from "./flash";
export type { FlashCookieOptions, Flasher } from "./flash-cookie";
export { createFlash } from "./flash-cookie";
export type { HxAttrs, HxAttrsProps } from "./htmx-attrs";
export { hxAttrs } from "./htmx-attrs";
export type { HxRequest } from "./htmx-headers";
export {
  hxCurrentUrl,
  hxTarget,
  hxTrigger,
  hxTriggerName,
  isBoosted,
  isPartial,
  readHxRequest,
  setPushUrl,
  setRedirect,
  setRefresh,
  setReplaceUrl,
  setReswap,
  setRetarget,
  setTrigger,
  setTriggerAfterSettle,
  setTriggerAfterSwap,
} from "./htmx-headers";
export {
  asyncDialogTrigger,
  dependentSelect,
  formSubmit,
  infiniteScroll,
  inlineValidation,
  liveSearch,
  oobAppend,
  oobSwap,
  paginatedTableLink,
  SWAP,
  toastOob,
} from "./htmx-patterns";
export { Resumable } from "./resumable";
export { ThemeToggle } from "./theme-toggle";
