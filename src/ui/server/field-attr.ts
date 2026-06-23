/**
 * SSR `data-field` attribute naming the signal field a control two-way-binds to. Spread it onto a
 * control alongside `scopeAttrs({ on<Event>: "bindField" })`: the client `bindField` action reads
 * this attribute to know which signal to write.
 *
 *     <Switch {...scopeAttrs({ onChange: "bindField" })} {...fieldAttr("gridVisible")} checked={v} />
 *
 * forge owns the generic binding vocabulary (`data-field` + the `bindField` action); the app supplies
 * the signal record and any domain effects layered on it. @public
 */
export function fieldAttr(name: string): { "data-field": string } {
  return { "data-field": name };
}
