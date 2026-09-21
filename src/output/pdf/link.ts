import { pdfContainer, Stack } from "./components";
import type { LinkProps, PdfElement } from "./types";

/** Takes a reader somewhere when they activate the run it wraps, and says so to the structure tree. @public */
export function Link(props: LinkProps): PdfElement {
  const inner = Stack({ children: props.children });
  return {
    ...pdfContainer(props.children),
    measure: (width, set) => inner.measure(width, set),
    fragments(box, set) {
      // The rectangle is measured from where the run is actually painted rather than from the box,
      // because a fragment moved to the next page is activated where it landed, not where it was.
      return inner.fragments(box, set).map((fragment) => ({
        ...fragment,
        paint(cursor) {
          cursor.linked(props.to, box, () => {
            fragment.paint(cursor);
          });
        },
      }));
    },
  };
}
