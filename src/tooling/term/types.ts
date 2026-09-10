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

/** How much colour a stream can carry: none, 16, 256, or 24-bit. @public */
export type ColorLevel = 0 | 1 | 2 | 3;

/** Everything the resolver is allowed to look at. @public */
export interface CapabilityInput {
  /** The environment, passed in rather than read — see `resolveColorLevel`. */
  env: Readonly<Record<string, string | undefined>>;
  /** Whether the stream being resolved for is attached to a terminal. */
  isTTY?: boolean;
  /** Command line, for the `--color` family of flags. */
  argv?: readonly string[];
}

/** The pair of sequences that opens and closes one style. @public */
export interface ColorCode {
  open: string;
  close: string;
}

/** Every named colour, foreground and background. @public */
export type AnsiColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "grey"
  | "blackBright"
  | "redBright"
  | "greenBright"
  | "yellowBright"
  | "blueBright"
  | "magentaBright"
  | "cyanBright"
  | "whiteBright"
  | "bgBlack"
  | "bgRed"
  | "bgGreen"
  | "bgYellow"
  | "bgBlue"
  | "bgMagenta"
  | "bgCyan"
  | "bgWhite"
  | "bgGray"
  | "bgGrey"
  | "bgBlackBright"
  | "bgRedBright"
  | "bgGreenBright"
  | "bgYellowBright"
  | "bgBlueBright"
  | "bgMagentaBright"
  | "bgCyanBright"
  | "bgWhiteBright";

/** Every named non-colour attribute. @public */
export type AnsiStyle = "reset" | "bold" | "dim" | "italic" | "underline" | "inverse" | "hidden" | "strikethrough";

/** The style methods that take a value rather than a name. @public */
export interface ColorMethods {
  ansi256: (code: number) => ColorCode;
  bgAnsi256: (code: number) => ColorCode;
  rgb: (r: number, g: number, b: number) => ColorCode;
  bgRgb: (r: number, g: number, b: number) => ColorCode;
  hex: (value: string) => ColorCode;
  bgHex: (value: string) => ColorCode;
}

/** A whole code table, resolved for one colour level. @public */
export interface AnsiCodes {
  colors: Record<AnsiColor, ColorCode>;
  styles: Record<AnsiStyle, ColorCode>;
  methods: ColorMethods;
}

/** Every colour and style name, each returning a styler to chain the next off. */
type Chain = { readonly [K in AnsiColor | AnsiStyle]: Colorize };

/**
 * A callable styler that is also a chain: `style.red.bold("x")`.
 *
 * Threaded, never ambient. There is no detected module-level singleton to reach for, because a
 * level is a property of the stream being written to and `CODE_RULES.md` §1 bans the global that
 * would have to hold it.
 * @public
 */
export interface Colorize extends Chain {
  (input: string): string;
  /** The sequences this chain opens and closes with — empty at level 0. */
  readonly open: string;
  readonly close: string;
  /** The level this styler was built for. */
  readonly level: ColorLevel;
  /** Removes every escape sequence, whatever produced it. */
  strip(input: string): string;
  hex(value: string): Colorize;
  bgHex(value: string): Colorize;
  rgb(r: number, g: number, b: number): Colorize;
  bgRgb(r: number, g: number, b: number): Colorize;
  ansi256(code: number): Colorize;
  bgAnsi256(code: number): Colorize;
}

/** One column of a grid: which key it reads, what it is headed, and how it behaves when space runs out. @public */
export interface GridColumn {
  /** Row key this column reads. */
  key: string;
  /** Heading text. Defaults to `key`. */
  header?: string;
  /** Where the slack goes in a cell narrower than the column. Defaults to `left`. */
  align?: Align;
  /** Gives up width first when the grid must shrink, and wraps rather than truncates. */
  wrap?: boolean;
}

/** How to lay a grid out. @public */
export interface GridOptions {
  /** Columns in render order. Omitted, they are derived from the first row's key order. */
  columns?: readonly (string | GridColumn)[];
  /** Border preset. Defaults to `BORDERS.markdown`. */
  border?: BorderStyle;
  /** Render the column headings and the rule under them. Defaults to `true`. */
  header?: boolean;
  /** Columns between two cells where the border draws no vertical. Defaults to 2. */
  gap?: number;
  /** Columns of space inside each cell, on both sides. Defaults to 1. */
  padding?: number;
  /** Columns every line is prefixed with. Defaults to 0. */
  indent?: number;
  /** Total columns the grid must fit in. Omitted, it is as wide as its content. */
  maxWidth?: number;
  /** Drop a column that is empty in every row. Defaults to `true`. */
  dropEmptyColumns?: boolean;
}

/** One `term — description` pair. @public */
export interface DefinitionEntry {
  term: string;
  description: string;
}

/** How to lay a definition list out. @public */
export interface DefinitionOptions {
  /** Total columns the list must fit in; descriptions wrap to stay inside it. */
  width?: number;
  /** Columns every line is prefixed with. Defaults to 0. */
  indent?: number;
  /** Columns between the term and its description. Defaults to 2. */
  gap?: number;
}

/** How many columns each class of character is counted as occupying. @public */
export interface WidthOptions {
  /** Columns a tab advances. Defaults to 8. */
  tabWidth?: number;
  /** Columns an emoji sequence occupies. Defaults to 2. */
  emojiWidth?: number;
  /** Columns an East-Asian wide character occupies. Defaults to 2. */
  wideWidth?: number;
  /** Columns everything else occupies. Defaults to 1. */
  regularWidth?: number;
}

/** What `truncate` returns: the cut text, its width, and whether anything was dropped. @public */
export interface TruncateResult {
  text: string;
  width: number;
  truncated: boolean;
  /** Offset into `input` the cut was made at, before any reset or ellipsis was appended. */
  index: number;
}

/** Width options plus the marker written in place of what was cut. @public */
export interface TruncateOptions extends WidthOptions {
  /** Appended when the input does not fit. Defaults to `"…"`. */
  ellipsis?: string;
}

/** Where the shorter side's padding goes when a cell is wider than its content. @public */
export type Align = "left" | "center" | "right";
