import { Box, pdfContainer } from "./components";
import { roundedBoxCommands, transformCommands } from "./path";
import type { ImageProps, Ink, PanelProps, PathProps, PdfCursor, PdfElement, PdfPathCommand, PdfPathPaint, PdfShading } from "./types";

function isShading(fill: Ink | PdfShading): fill is PdfShading {
  return !Array.isArray(fill);
}

function paintFor(props: { fill?: Ink | PdfShading | undefined; stroke?: Ink | undefined }): PdfPathPaint["paint"] {
  if (props.stroke === undefined) return "fill";
  return props.fill === undefined ? "stroke" : "fill-stroke";
}

// A gradient replaces the fill ink rather than joining it, so only a solid fill reaches `painted`.
function draw(
  cursor: PdfCursor,
  commands: readonly PdfPathCommand[],
  props: { fill?: Ink | PdfShading | undefined; stroke?: Ink | undefined; weight?: number | undefined; alpha?: number | undefined },
): void {
  const shading = props.fill !== undefined && isShading(props.fill) ? props.fill : undefined;
  const solid = props.fill !== undefined && !isShading(props.fill) ? props.fill : undefined;
  const paint: PdfPathPaint = {
    paint: paintFor(props),
    ...(props.weight === undefined ? {} : { weight: props.weight }),
    ...(props.alpha === undefined ? {} : { alpha: props.alpha }),
    ...(shading === undefined ? {} : { shading }),
  };
  cursor.painted(solid, () => {
    cursor.stroked(props.stroke, () => {
      cursor.path(commands, paint);
    });
  });
}

/** Draws a path in the room it is given, filled with an ink or a gradient and stroked with a pen. @public */
export function Path(props: PathProps): PdfElement {
  const tag = props.tag ?? "artwork";
  return {
    audit: { drawing: { alt: props.alt !== undefined } },
    measure: () => ({ preferred: 0, minimum: 0, height: props.height }),
    fragments: (box) => [
      {
        reserve: props.height,
        advance: props.height,
        paint(cursor) {
          cursor.tagged(
            tag,
            () => {
              draw(cursor, transformCommands(props.commands, box.x, cursor.y), props);
            },
            props.alt,
          );
          cursor.y += props.height;
        },
      },
    ],
  };
}

/** Sets an image across its box, scaled at the image's own aspect ratio unless told otherwise. @public */
export function Image(props: ImageProps): PdfElement {
  const tag = props.tag ?? "artwork";
  const drawn = (available: number): { width: number; height: number } => {
    const width = props.width ?? available;
    return { width, height: props.height ?? (width * props.image.height) / props.image.width };
  };
  return {
    audit: { drawing: { alt: props.alt !== undefined } },
    measure: (width) => ({ preferred: props.width ?? props.image.width, minimum: 0, height: drawn(width).height }),
    fragments(box) {
      const { width, height } = drawn(box.width);
      return [
        {
          reserve: height,
          advance: height,
          paint(cursor) {
            cursor.tagged(
              tag,
              () => {
                cursor.image(props.image, box.x, cursor.y, width, height, props.alpha);
              },
              props.alt,
            );
            cursor.y += height;
          },
        },
      ];
    },
  };
}

/** Draws a rounded panel behind its children, which it keeps whole rather than breaking. @public */
export function Panel(props: PanelProps): PdfElement {
  const padding = props.padding ?? 0;
  const inner = Box({ children: props.children, gap: props.gap ?? 0, padding });
  const radius = props.radius ?? 0;
  return {
    ...pdfContainer(props.children),
    measure: (width, set) => inner.measure(width, set),
    fragments(box, set) {
      const height = inner.measure(box.width, set).height;
      const own = inner.fragments(box, set);
      return [
        {
          reserve: height,
          advance: height,
          paint(cursor) {
            const top = cursor.y;
            cursor.tagged("artwork", () => {
              draw(cursor, roundedBoxCommands(box.x, top, box.width, height, radius), props);
            });
            for (const fragment of own) fragment.paint(cursor);
            cursor.y = top + height;
          },
        },
      ];
    },
  };
}
