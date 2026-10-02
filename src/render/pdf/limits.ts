import type { PdfRendererOptions } from "./types";

/** The page ceiling a render is held to when the caller names none. */
export const DEFAULT_PDF_MAX_PAGES = 64;

// The ceiling bounds what a decode allocates, not what a viewer can draw: splitting an alpha channel
// out holds the samples, the colour and the alpha in memory at once, and a Worker's is not elastic.
/** The most pixels a PNG may declare before it is refused unread. */
export const MAX_PDF_IMAGE_PIXELS = 4_000_000;

// Frozen as well as typed readonly: this is the guard itself, published on a subpath, and `const`
// seals the binding rather than the contents — so anything sharing the isolate could push to it.
/** The URI schemes a link annotation may target; every other one is refused by name. */
export const LINK_SCHEMES: readonly string[] = Object.freeze(["http", "https", "mailto"]);

/** The fewest lines a paragraph leaves at the foot of a page before it is moved whole. */
export const DEFAULT_ORPHANS = 2;

/** The fewest lines a paragraph carries onto the next page. */
export const DEFAULT_WIDOWS = 2;

// A tagged document must declare a language, and a reader that finds none announces the text in
// whatever voice it happens to be set to — so there is a default, and it is visible in the option.
/** The language a tagged document declares when the caller names none. */
export const DEFAULT_PDF_LANG = "en";

// A structure tree over the base-14 faces is conformant only as far as whatever face the viewer
// substitutes, so the default turns on where the caller has supplied glyphs the file can carry.
/** Whether a render writes a structure tree: on wherever the caller supplies faces to embed. @internal */
export function pdfTaggingOn(options: PdfRendererOptions): boolean {
  return options.tagged ?? (options.fonts ?? []).length > 0;
}
