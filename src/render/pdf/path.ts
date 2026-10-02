import { KAPPA } from "./geometry";
import { num } from "./text";
import type { PdfCorners, PdfPathCommand, PdfPathNode, PdfPen, PdfResources } from "./types";

interface Corners {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

function cornersOf(radius: number | PdfCorners): Corners {
  const spec = typeof radius === "number" ? { all: radius } : radius;
  const all = spec.all ?? 0;
  return { topLeft: spec.topLeft ?? all, topRight: spec.topRight ?? all, bottomRight: spec.bottomRight ?? all, bottomLeft: spec.bottomLeft ?? all };
}

/** A pen over one path: move, line, curve, rect and close, in the order they are drawn. @public */
export function createPdfPen(): PdfPen {
  const commands: PdfPathCommand[] = [];
  const pen: PdfPen = {
    move(x, y) {
      commands.push({ op: "move", x, y });
      return pen;
    },
    line(x, y) {
      commands.push({ op: "line", x, y });
      return pen;
    },
    curve(x1, y1, x2, y2, x, y) {
      commands.push({ op: "curve", x1, y1, x2, y2, x, y });
      return pen;
    },
    rect(x, y, width, height) {
      commands.push({ op: "rect", x, y, width, height });
      return pen;
    },
    close() {
      commands.push({ op: "close" });
      return pen;
    },
    commands: () => commands,
  };
  return pen;
}

// PDF has no rounded rectangle: straight edges with a Bézier quarter-arc turning each corner, each
// arc taking its own corner's radius so a panel can be rounded on one side and square on the other.
/** A box with a radius at each corner, drawn from its bottom-left edge. @internal */
export function roundedBoxCommands(x: number, y: number, width: number, height: number, radius: number | PdfCorners): readonly PdfPathCommand[] {
  const { topLeft, topRight, bottomRight, bottomLeft } = cornersOf(radius);
  const right = x + width;
  const bottom = y + height;
  const pen = createPdfPen()
    .move(x + bottomLeft, bottom)
    .line(right - bottomRight, bottom);
  const br = bottomRight * KAPPA;
  pen.curve(right - bottomRight + br, bottom, right, bottom - bottomRight + br, right, bottom - bottomRight).line(right, y + topRight);
  const tr = topRight * KAPPA;
  pen.curve(right, y + topRight - tr, right - topRight + tr, y, right - topRight, y).line(x + topLeft, y);
  const tl = topLeft * KAPPA;
  pen.curve(x + topLeft - tl, y, x, y + topLeft - tl, x, y + topLeft).line(x, bottom - bottomLeft);
  const bl = bottomLeft * KAPPA;
  return pen
    .curve(x, bottom - bottomLeft + bl, x + bottomLeft - bl, bottom, x + bottomLeft, bottom)
    .close()
    .commands();
}

/** A path moved to where it is drawn and scaled to the room it is drawn in. @internal */
export function transformCommands(commands: readonly PdfPathCommand[], dx: number, dy: number, scale = 1): readonly PdfPathCommand[] {
  const at = (x: number, y: number): { x: number; y: number } => ({ x: dx + x * scale, y: dy + y * scale });
  return commands.map((command) => {
    switch (command.op) {
      case "curve":
        return { op: "curve", ...renamed(at(command.x1, command.y1), at(command.x2, command.y2)), ...at(command.x, command.y) };
      case "rect":
        return { ...command, ...at(command.x, command.y), width: command.width * scale, height: command.height * scale };
      case "close":
        return command;
      default:
        return { ...command, ...at(command.x, command.y) };
    }
  });
}

function renamed(one: { x: number; y: number }, other: { x: number; y: number }): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: one.x, y1: one.y, x2: other.x, y2: other.y };
}

function operator(command: PdfPathCommand, up: (y: number) => number): string {
  switch (command.op) {
    case "move":
      return `${num(command.x)} ${num(up(command.y))} m`;
    case "line":
      return `${num(command.x)} ${num(up(command.y))} l`;
    case "curve": {
      const { x1, y1, x2, y2, x, y } = command;
      return `${num(x1)} ${num(up(y1))} ${num(x2)} ${num(up(y2))} ${num(x)} ${num(up(y))} c`;
    }
    case "rect":
      return `${num(command.x)} ${num(up(command.y + command.height))} ${num(command.width)} ${num(command.height)} re`;
    default:
      return "h";
  }
}

const PAINT: Readonly<Record<"fill" | "stroke" | "fill-stroke", string>> = { fill: "f", stroke: "S", "fill-stroke": "B" };

// `f` and `W n` both close an open subpath themselves, so an `h` before either is two bytes that
// draw nothing. `S` needs it to join the ends, and `B`'s stroke half does not close implicitly.
function drawn(commands: readonly PdfPathCommand[], closes: boolean): readonly PdfPathCommand[] {
  return closes && commands.at(-1)?.op === "close" ? commands.slice(0, -1) : commands;
}

/** One path node as the operators that draw it, in PDF's y-up user space. @internal */
export function pathOperators(node: PdfPathNode, up: (y: number) => number, resources: PdfResources): string {
  const geometryOf = (closes: boolean): string =>
    drawn(node.commands, closes)
      .map((command) => operator(command, up))
      .join(" ");
  // A gradient paints the whole clip region rather than a path, so the path becomes the clip and the
  // shading is painted through it — which is also why it has to be bracketed by `q`/`Q`.
  if (node.shading !== undefined) {
    return `q ${alphaPrefix(node, resources)}${geometryOf(true)} W n /${resources.shading(node.shading)} sh Q`;
  }
  const paint = node.paint ?? "fill";
  const parts = [...(paint === "fill" ? [] : [`${num(node.weight ?? 0)} w`]), geometryOf(paint === "fill"), PAINT[paint]];
  const painted = parts.filter((part) => part !== "").join(" ");
  return node.alpha === undefined ? painted : `q ${alphaPrefix(node, resources)}${painted} Q`;
}

function alphaPrefix(node: PdfPathNode, resources: PdfResources): string {
  return node.alpha === undefined ? "" : `/${resources.alpha(node.alpha)} gs `;
}
