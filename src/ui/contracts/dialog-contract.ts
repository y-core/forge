import type { DialogNaming } from "./types";

/** Resumable-scope name a `Dialog` asked to open modally stamps. Eager. @public */
export const DIALOG_SCOPE = "dialog";

// A marker rather than the `open` attribute: `open` means *non-modal* to the platform, so stamping
// it here would paint a dialog the CSS dresses with a backdrop it will never be given.
/** Marks a dialog the client scope opens with `showModal()` on resume. @public */
export const DIALOG_OPEN_MODAL_ATTR = "data-open-modal";

// A reference beats a literal: only the reference tracks text the page already shows, so the name a
// reader hears cannot drift from the heading they see.
/** The name a caller asked for, or nothing at all where they asked for none. @public */
export function nameAttrs(naming: DialogNaming): Record<string, string> {
  if (naming.labelledby !== undefined) return { "aria-labelledby": naming.labelledby };
  if (naming.label !== undefined) return { "aria-label": naming.label };
  return {};
}

// `dialog` is `nameFrom: author`, so a caller who names the root must win outright: emitting the
// derived reference beside their own would leave the panel named by a heading they did not write.
/** How a `<dialog>` root is named — the caller's own name, else the reference derived from its `.Title`. @public */
export function dialogNameAttrs(id: string, naming: DialogNaming): Record<string, string> {
  const named = nameAttrs(naming);
  return Object.keys(named).length > 0 ? named : { "aria-labelledby": `${id}-title` };
}
