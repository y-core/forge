// Slot record and the zero-width-means-skip convention adapted from @visulima/tabular
// (MIT, Copyright (c) visulima) — https://github.com/visulima/visulima — packages/terminal/tabular/src/style.ts

/** One drawing position, whose `width` of zero means the engine skips the slot entirely. @public */
export interface BorderSlot {
  char: string;
  width: number;
}

/** The fifteen positions a rectangular grid can draw. @public */
export interface BorderStyle {
  topLeft: BorderSlot;
  topBody: BorderSlot;
  topJoin: BorderSlot;
  topRight: BorderSlot;
  joinLeft: BorderSlot;
  joinBody: BorderSlot;
  joinJoin: BorderSlot;
  joinRight: BorderSlot;
  bodyLeft: BorderSlot;
  bodyJoin: BorderSlot;
  bodyRight: BorderSlot;
  bottomLeft: BorderSlot;
  bottomBody: BorderSlot;
  bottomJoin: BorderSlot;
  bottomRight: BorderSlot;
}

const SKIP: BorderSlot = { char: "", width: 0 };

function slot(char: string): BorderSlot {
  return { char, width: 1 };
}

function style(chars: Record<keyof BorderStyle, string>): BorderStyle {
  const built = {} as Record<keyof BorderStyle, BorderSlot>;
  for (const [name, char] of Object.entries(chars)) {
    built[name as keyof BorderStyle] = char === "" ? SKIP : slot(char);
  }
  return built;
}

/** The border presets `renderGrid` accepts. @public */
export const BORDERS: Readonly<Record<"none" | "ascii" | "single" | "markdown", BorderStyle>> = Object.freeze({
  /** No rules and no verticals — columns separated by the grid's `gap`. */
  none: style({
    topLeft: "",
    topBody: "",
    topJoin: "",
    topRight: "",
    joinLeft: "",
    joinBody: "",
    joinJoin: "",
    joinRight: "",
    bodyLeft: "",
    bodyJoin: "",
    bodyRight: "",
    bottomLeft: "",
    bottomBody: "",
    bottomJoin: "",
    bottomRight: "",
  }),
  /** A fully boxed grid in characters every terminal has. */
  ascii: style({
    topLeft: "+",
    topBody: "-",
    topJoin: "+",
    topRight: "+",
    joinLeft: "+",
    joinBody: "-",
    joinJoin: "+",
    joinRight: "+",
    bodyLeft: "|",
    bodyJoin: "|",
    bodyRight: "|",
    bottomLeft: "+",
    bottomBody: "-",
    bottomJoin: "+",
    bottomRight: "+",
  }),
  /** A fully boxed grid in single-line box-drawing characters — what `forge sync` prints. */
  single: style({
    topLeft: "┌",
    topBody: "─",
    topJoin: "┬",
    topRight: "┐",
    joinLeft: "├",
    joinBody: "─",
    joinJoin: "┼",
    joinRight: "┤",
    bodyLeft: "│",
    bodyJoin: "│",
    bodyRight: "│",
    bottomLeft: "└",
    bottomBody: "─",
    bottomJoin: "┴",
    bottomRight: "┘",
  }),
  /** Pipes and one rule under the header, with no line above or below — a Markdown table. */
  markdown: style({
    topLeft: "",
    topBody: "",
    topJoin: "",
    topRight: "",
    joinLeft: "|",
    joinBody: "-",
    joinJoin: "|",
    joinRight: "|",
    bodyLeft: "|",
    bodyJoin: "|",
    bodyRight: "|",
    bottomLeft: "",
    bottomBody: "",
    bottomJoin: "",
    bottomRight: "",
  }),
});
