// A pairing derived from the one id a caller writes, rather than a second prop they must keep in
// step: an `aria-labelledby` and the element it points at can then never disagree.

/** The id of the heading that names the `<dialog>` root `rootId`. @public */
export const titleId = (rootId: string): string => `${rootId}-title`;

/** The id of the message that describes the `<dialog>` root `rootId`. @public */
export const descriptionId = (rootId: string): string => `${rootId}-description`;

/** The id of the tab that names the tab panel `panelId`. @public */
export const tabId = (panelId: string): string => `${panelId}-tab`;

/** The id of the invoker that names the popup `popupId`. @public */
export const triggerId = (popupId: string): string => `${popupId}-trigger`;

/** The name a caller asked for, or nothing at all where they asked for none. @public */
export function nameAttrs(naming: { label?: string | undefined; labelledby?: string | undefined }): Record<string, string> {
  if (naming.labelledby !== undefined) return { "aria-labelledby": naming.labelledby };
  if (naming.label !== undefined) return { "aria-label": naming.label };
  return {};
}
