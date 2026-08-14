/** HTMX server-side utilities for `@y-core/forge/html/htmx`. @public */

export type { HxAttrs, HxAttrsProps } from "./htmx-attrs";
export { hxAttrs } from "./htmx-attrs";
export type { HxRequest } from "./htmx-headers";
export { hxCurrentUrl, hxTarget, hxTrigger, hxTriggerName, isBoosted, isPartial, readHxRequest } from "./htmx-headers";
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
} from "./htmx-patterns";
export type { HxResponseHeaders, HxResponseProps } from "./htmx-response";
export { hxHeaders } from "./htmx-response";
export { isHxRequest } from "./hx-request";
