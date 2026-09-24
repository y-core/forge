import { nameAttrs, titleId } from "./naming";
/** Resumable-scope name a `Dialog` asked to open modally stamps. Eager. @public */
export const DIALOG_SCOPE = "dialog";

// A marker rather than the `open` attribute: `open` means *non-modal* to the platform, so stamping
// it here would paint a dialog the CSS dresses with a backdrop it will never be given.
/** Marks a dialog the client scope opens with `showModal()` on resume. @public */
export const DIALOG_OPEN_MODAL_ATTR = "data-open-modal";

// The derived reference is reachable only through `titled`, which is the caller asserting the `.Title`
// it points at: emitted unconditionally it is a dangling IDREF, which names nothing at all.
/** How a `<dialog>` root is named — the caller's own name, else the reference derived from its `.Title`. @public */
export function dialogNameAttrs(
  id: string,
  naming: { label?: string | undefined; labelledby?: string | undefined; titled?: true | undefined },
): Record<string, string> {
  const named = nameAttrs(naming);
  if (Object.keys(named).length > 0) return named;
  return naming.titled === true ? { "aria-labelledby": titleId(id) } : {};
}
