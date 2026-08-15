/** Resumable-scope name a `Dialog` asked to open modally stamps. Eager. @public */
export const DIALOG_SCOPE = "dialog";

// A marker rather than the `open` attribute: `open` means *non-modal* to the platform, so stamping
// it here would paint a dialog the CSS dresses with a backdrop it will never be given.
/** Marks a dialog the client scope opens with `showModal()` on resume. @public */
export const DIALOG_OPEN_MODAL_ATTR = "data-open-modal";
