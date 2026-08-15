/** Names an element's text content as a view of one signal in the enclosing scope. @public */
export const BIND_TEXT_ATTR = "data-bind-text";

/** Names one attribute as a view of one signal, spelled `attribute:field`. @public */
export const BIND_ATTR_ATTR = "data-bind-attr";

/** Builds the `data-bind-text` attribute for an SSR element, to be spread onto it. @public */
export function bindTextAttr(field: string): Record<string, string> {
  return { [BIND_TEXT_ATTR]: field };
}

/** Builds the `data-bind-attr` attribute pairing one attribute name with one signal field. @public */
export function bindAttrAttr(attribute: string, field: string): Record<string, string> {
  return { [BIND_ATTR_ATTR]: `${attribute}:${field}` };
}

/** Splits a `data-bind-attr` value into its attribute name and its field, or `null` when malformed. @public */
export function parseBindAttr(value: string): { attribute: string; field: string } | null {
  // The *last* colon, because a signal field is an identifier and never contains one, while an
  // attribute may — `xlink:href:target` is the attribute `xlink:href` bound to the field `target`.
  const at = value.lastIndexOf(":");
  if (at <= 0 || at === value.length - 1) return null;
  return { attribute: value.slice(0, at), field: value.slice(at + 1) };
}
