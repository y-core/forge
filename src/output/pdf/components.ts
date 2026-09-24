import { splitByFace } from "./embed";
import { LINE, RULE_WEIGHT, VALUE_SIZE } from "./geometry";
import { DEFAULT_PDF_MAX_PAGES } from "./limits";
import { embeddedWidth, linesOf, preferredWidth, widestOf, wordsOf } from "./measure";
import { wrapBy } from "./text";
import { resolveTracks, trackOffsets } from "./tracks";
import type {
  BoxProps,
  DividerProps,
  KeepTogetherProps,
  PageNumberProps,
  PdfBaseFace,
  PdfBox,
  PdfElement,
  PdfEmbeddedFont,
  PdfFaceRun,
  PdfFragment,
  PdfTypesetting,
  RowProps,
  SpacerProps,
  StackProps,
  TextProps,
} from "./types";

// The room a page number takes is reserved against the widest number it could become, so a band
// laid out once does not shift between page 9 and page 10.
function widestPageNumber(digits: number): string {
  return "0".repeat(Math.max(digits, 1));
}

// A wrapper inherits only its *first* child's section break: that is the one position where the
// break lands where it would have without the wrapper, and pagination cannot break inside a container.
/** What a container declares about the elements it was given: them, and whether it opens a section. @internal */
export function pdfContainer(children: readonly PdfElement[]): Pick<PdfElement, "children" | "startsSection"> {
  const opens = children[0]?.startsSection;
  return { children, ...(opens === undefined ? {} : { startsSection: opens }) };
}

function stack(children: readonly PdfElement[], gap: number): PdfElement {
  return {
    ...pdfContainer(children),
    measure(width, set) {
      const measured = children.map((child) => child.measure(width, set));
      return {
        preferred: Math.max(...measured.map((one) => one.preferred), 0),
        minimum: Math.max(...measured.map((one) => one.minimum), 0),
        height: measured.reduce((total, one) => total + one.height, 0) + gap * Math.max(children.length - 1, 0),
      };
    },
    fragments(box, set) {
      return children.flatMap((child, index) => {
        const own = [...child.fragments(box, set)];
        if (index === children.length - 1 || gap === 0) return own;
        return [...own, { reserve: 0, advance: gap, paint: (cursor) => void (cursor.y += gap) }];
      });
    },
  };
}

/** Sets a run of type, wrapped to the width of its box. @public */
export function Text(props: TextProps): PdfElement {
  const size = props.size ?? VALUE_SIZE;
  const leading = props.leading ?? LINE;
  const style = { bold: props.bold, tracking: props.tracking };
  const tag = props.tag ?? "value";
  const own = props.font === undefined ? [] : Array.isArray(props.font) ? [...props.font] : [props.font as PdfEmbeddedFont];
  const face: PdfBaseFace = props.bold === true ? "bold" : "regular";
  // A run naming no face takes the document's, for measuring as well as painting: measuring in
  // Helvetica and painting in another face overlaps what follows.
  const facesIn = (set: PdfTypesetting | undefined): PdfEmbeddedFont[] => {
    if (own.length > 0) return own;
    const defaulted = set?.embedded(face);
    return defaulted === undefined ? [] : [defaulted];
  };
  const setting = (set: PdfTypesetting | undefined) => {
    const faces = facesIn(set);
    const coverage = faces.map((one) => ({ name: one.name, covers: (code: number) => one.metrics.advances.has(code) }));
    const byName = new Map(faces.map((one) => [one.name, one]));
    // A run is split where the face setting it changes, so one glyph missing from the first face
    // falls back for itself rather than dragging its neighbours onto another face — or failing.
    const segments = (text: string): PdfFaceRun[] => (faces.length === 0 ? [{ face: undefined, run: text }] : splitByFace(text, coverage));
    // Each segment measures in its own face, so a line breaks where the faces that set it say it
    // does rather than where the first of them would; an unmatched segment is base-14's.
    const widthOf = (text: string): number =>
      segments(text).reduce((total, segment) => {
        const one = segment.face === undefined ? undefined : byName.get(segment.face);
        return total + (one === undefined ? preferredWidth(segment.run, size, style) : embeddedWidth(segment.run, size, one.metrics, style));
      }, 0);
    // Only a named face keeps base-14 as its last resort: a defaulted run held to anything less
    // would quietly set part of a document's body in Helvetica.
    const resort = own.length > 0 ? null : undefined;
    // One wrapper for both paths, so `breakWord` reaches an embedded face by construction rather
    // than by remembering to thread it a second time.
    return { segments, widthOf, resort, wrap: (width: number) => wrapBy(props.children, width, widthOf, props.breakWord ?? false) };
  };
  return {
    measure(width, set) {
      const { widthOf, wrap } = setting(set);
      // Per line, because `widthOf` sums its segments: given a whole run, an embedded face gives
      // `\n` its own near-zero advance and answers the lines laid end to end, which nothing occupies.
      const preferred = widestOf(linesOf(props.children), widthOf);
      return { preferred, minimum: widestOf(wordsOf(props.children), widthOf), height: wrap(width).length * leading };
    },
    fragments(box, set) {
      const { segments, widthOf, resort, wrap } = setting(set);
      return wrap(box.width).map((line) => ({
        reserve: leading,
        advance: leading,
        paint(cursor) {
          cursor.tagged(tag, () => {
            cursor.y += leading;
            let x = box.x;
            for (const segment of segments(line)) {
              cursor.text(segment.run, x, cursor.y, face, size, props.tracking ?? 0, undefined, segment.face ?? resort);
              x += widthOf(segment.run);
            }
          });
        },
      }));
    },
  };
}

/** Stacks its children one under the next, with `gap` between them. @public */
export function Stack(props: StackProps): PdfElement {
  return stack(props.children, props.gap ?? 0);
}

/** Sets its children side by side across its tracks, each in the room its track resolves to. @public */
export function Row(props: RowProps): PdfElement {
  const gap = props.gap ?? 0;
  const tracks = props.tracks ?? props.children.map(() => 1);
  const boxesIn = (box: PdfBox): PdfBox[] => {
    const widths = resolveTracks(tracks, box.width, gap);
    const offsets = trackOffsets(widths, gap);
    return widths.map((width, index) => ({ x: box.x + (offsets[index] ?? 0), width, height: box.height }));
  };
  return {
    ...pdfContainer(props.children),
    measure(width, set) {
      const boxes = boxesIn({ x: 0, width, height: Number.POSITIVE_INFINITY });
      const measured = props.children.map((child, index) => child.measure(boxes[index]?.width ?? width, set));
      return {
        preferred: measured.reduce((total, one) => total + one.preferred, 0) + gap * Math.max(props.children.length - 1, 0),
        minimum: measured.reduce((total, one) => total + one.minimum, 0) + gap * Math.max(props.children.length - 1, 0),
        height: Math.max(...measured.map((one) => one.height), 0),
      };
    },
    fragments(box, set) {
      const boxes = boxesIn(box);
      const advance = Math.max(...props.children.map((child, index) => child.measure(boxes[index]?.width ?? box.width, set).height), 0);
      // A row is one fragment because its cells share a baseline; a row no page could hold has to
      // break somewhere all the same, so it gives its cells back their own fragments.
      if (advance > box.height) return props.children.flatMap((child, index) => [...child.fragments(boxes[index] ?? box, set)]);
      return [
        {
          reserve: advance,
          advance,
          paint(cursor) {
            const top = cursor.y;
            props.children.forEach((child, index) => {
              cursor.y = top;
              const cell = boxes[index];
              if (cell === undefined) return;
              for (const fragment of child.fragments(cell, set)) fragment.paint(cursor);
            });
            cursor.y = top + advance;
          },
        },
      ];
    },
  };
}

/** Insets its children from the box it was given, and stacks them. @public */
export function Box(props: BoxProps): PdfElement {
  const padding = props.padding ?? 0;
  const inner = stack(props.children, props.gap ?? 0);
  return {
    ...pdfContainer(props.children),
    measure(width, set) {
      const measured = inner.measure(width - padding * 2, set);
      return { preferred: measured.preferred + padding * 2, minimum: measured.minimum + padding * 2, height: measured.height + padding * 2 };
    },
    fragments(box, set) {
      const own = inner.fragments({ x: box.x + padding, width: box.width - padding * 2, height: box.height }, set);
      if (padding === 0) return own;
      const pad = (): PdfFragment => ({ reserve: padding, advance: padding, paint: (cursor) => void (cursor.y += padding) });
      return [pad(), ...own, pad()];
    },
  };
}

/** Sets the page's own number, or the document's page count, which only the writer knows. @public */
export function PageNumber(props: PageNumberProps = {}): PdfElement {
  const size = props.size ?? VALUE_SIZE;
  const style = { bold: props.bold };
  const placeholder = props.total === true ? "page-count" : "page-number";
  const reserved = widestPageNumber(props.digits ?? String(DEFAULT_PDF_MAX_PAGES).length);
  return {
    measure: () => ({ preferred: preferredWidth(reserved, size, style), minimum: 0, height: LINE }),
    fragments: (box) => [
      {
        reserve: LINE,
        advance: LINE,
        paint(cursor) {
          cursor.y += LINE;
          cursor.tagged("value", () => {
            cursor.text(reserved, box.x, cursor.y, props.bold === true ? "bold" : "regular", size, 0, placeholder);
          });
        },
      },
    ],
  };
}

/** Leaves empty vertical room. @public */
export function Spacer(props: SpacerProps): PdfElement {
  return {
    measure: () => ({ preferred: 0, minimum: 0, height: props.height }),
    fragments: () => [{ reserve: props.height, advance: props.height, paint: (cursor) => void (cursor.y += props.height) }],
  };
}

/** Rules a line across the width of its box. @public */
export function Divider(props: DividerProps = {}): PdfElement {
  const weight = props.weight ?? RULE_WEIGHT;
  const tag = props.tag ?? "rule";
  return {
    measure: () => ({ preferred: 0, minimum: 0, height: 0 }),
    fragments: (box) => [
      {
        reserve: 0,
        advance: 0,
        paint(cursor) {
          cursor.tagged(tag, () => {
            cursor.stroked(cursor.channel.rule, () => {
              cursor.segment(box.x, cursor.y, box.width, weight);
            });
          });
        },
      },
    ],
  };
}

/** Starts a new page, unless the page it is on holds nothing yet. @public */
export function PageBreak(): PdfElement {
  return {
    measure: () => ({ preferred: 0, minimum: 0, height: 0 }),
    fragments: () => [
      {
        reserve: 0,
        advance: 0,
        paint(cursor) {
          if (!cursor.empty) cursor.newPage();
        },
      },
    ],
  };
}

/** Moves its children to the next page together rather than letting a break fall inside them. @public */
export function KeepTogether(props: KeepTogetherProps): PdfElement {
  const inner = stack(props.children, props.gap ?? 0);
  return {
    ...pdfContainer(props.children),
    measure: (width, set) => inner.measure(width, set),
    fragments(box, set) {
      const own = inner.fragments(box, set);
      const advance = own.reduce((total, fragment) => total + fragment.advance, 0);
      // Keeping a group whole is only possible while a page could hold it; past that the choice is
      // between breaking it and printing it off the page, and `paginate` already rules for breaking.
      if (advance > box.height) return own;
      return [
        {
          reserve: advance,
          advance,
          paint(cursor) {
            for (const fragment of own) fragment.paint(cursor);
          },
        },
      ];
    },
  };
}
