/**
 * Tailwind conflict-group table: maps a utility to the name of the CSS concern it sets, so
 * `cn` can drop every earlier utility that a later one would fight over.
 *
 * **Coverage boundary.** The table covers the families forge's own primitives emit plus those a
 * consumer override plausibly targets. It is deliberately *not* a complete map of Tailwind:
 * utilities outside it return `undefined` and pass through untouched, leaving stylesheet order to
 * decide — which is the pre-existing behaviour, not a regression. Adding a family is a one-line
 * data edit to one of the tables below.
 *
 * **Fail-open.** An unrecognised utility is always kept. This inverts the fail-closed posture of
 * `ERROR_HANDLING.md` on purpose: the "failure" here is incomplete knowledge of a third-party
 * vocabulary, not untrusted input. Failing closed would silently delete a consumer's custom class
 * or a utility from a newer Tailwind — with no error, and no fix available from outside this file.
 * Failing open has the status quo as its worst case.
 *
 * **Closed value spaces get exact whole-utility entries; only open value spaces get prefix
 * matching.** A `select-` prefix entry would make a consumer's `select-wrapper` claim the
 * user-select group and silently delete a real `select-none`.
 *
 * @internal
 */

const DISPLAY = [
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "flow-root",
  "grid",
  "inline-grid",
  "contents",
  "hidden",
  "table",
  "inline-table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row",
  "table-row-group",
  "list-item",
] as const;

const POSITION = ["static", "fixed", "absolute", "relative", "sticky"] as const;

const USER_SELECT = ["select-none", "select-text", "select-all", "select-auto"] as const;

const POINTER_EVENTS = ["pointer-events-none", "pointer-events-auto"] as const;

const OVERFLOW_VALUES = ["auto", "hidden", "clip", "visible", "scroll"] as const;

const OVERSCROLL_VALUES = ["auto", "contain", "none"] as const;

const OBJECT_FIT = ["object-contain", "object-cover", "object-fill", "object-none", "object-scale-down"] as const;

const TEXT_TRANSFORM = ["uppercase", "lowercase", "capitalize", "normal-case"] as const;

const TEXT_DECORATION = ["underline", "overline", "line-through", "no-underline"] as const;

const VISIBILITY = ["visible", "invisible", "collapse"] as const;

const FONT_VARIANT_NUMERIC = [
  "normal-nums",
  "ordinal",
  "slashed-zero",
  "lining-nums",
  "oldstyle-nums",
  "proportional-nums",
  "tabular-nums",
  "diagonal-fractions",
  "stacked-fractions",
] as const;

const SR_ONLY = ["sr-only", "not-sr-only"] as const;

const BORDER_COLLAPSE = ["border-collapse", "border-separate"] as const;

const ALIGN_ITEMS_VALUES = ["start", "end", "center", "baseline", "stretch"] as const;

const ALIGN_SELF_VALUES = ["auto", "start", "end", "center", "stretch", "baseline"] as const;

const JUSTIFY_CONTENT_VALUES = ["start", "end", "center", "between", "around", "evenly", "stretch", "normal"] as const;

const JUSTIFY_SELF_VALUES = ["auto", "start", "end", "center", "stretch"] as const;

const CURSOR_VALUES = [
  "auto",
  "default",
  "pointer",
  "wait",
  "text",
  "move",
  "help",
  "not-allowed",
  "none",
  "context-menu",
  "progress",
  "cell",
  "crosshair",
  "vertical-text",
  "alias",
  "copy",
  "no-drop",
  "grab",
  "grabbing",
  "all-scroll",
  "col-resize",
  "row-resize",
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
  "ne-resize",
  "nw-resize",
  "se-resize",
  "sw-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "zoom-in",
  "zoom-out",
] as const;

/** Value sets consulted by the prefix dispatchers, which match on the remainder after the prefix. */
const TEXT_ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right", "justify", "start", "end"]);
const TEXT_OVERFLOWS: ReadonlySet<string> = new Set(["ellipsis", "clip"]);
const FONT_SIZES: ReadonlySet<string> = new Set(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]);
const FLEX_DIRECTIONS: ReadonlySet<string> = new Set(["row", "row-reverse", "col", "col-reverse"]);
const FLEX_WRAPS: ReadonlySet<string> = new Set(["wrap", "nowrap", "wrap-reverse"]);
const BORDER_STYLES: ReadonlySet<string> = new Set(["solid", "dashed", "dotted", "double", "hidden", "none"]);
const BORDER_SIDES: ReadonlySet<string> = new Set(["x", "y", "t", "r", "b", "l", "s", "e"]);
const ROUNDED_CORNERS: ReadonlySet<string> = new Set(["t", "r", "b", "l", "s", "e", "tl", "tr", "br", "bl", "ss", "se", "ee", "es"]);
const BG_ATTACHMENTS: ReadonlySet<string> = new Set(["fixed", "local", "scroll"]);
const BG_REPEATS: ReadonlySet<string> = new Set(["repeat", "no-repeat", "repeat-x", "repeat-y", "repeat-round", "repeat-space"]);
const BG_SIZES: ReadonlySet<string> = new Set(["auto", "cover", "contain"]);
const BG_POSITIONS: ReadonlySet<string> = new Set([
  "bottom",
  "center",
  "left",
  "left-bottom",
  "left-top",
  "right",
  "right-bottom",
  "right-top",
  "top",
]);
const SHADOW_SIZES: ReadonlySet<string> = new Set(["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "inner", "none"]);
const FONT_WEIGHTS: ReadonlySet<string> = new Set(["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"]);
const OUTLINE_STYLES: ReadonlySet<string> = new Set(["none", "hidden", "dashed", "dotted", "double", "solid"]);
const BG_IMAGE_PREFIXES = ["gradient-", "linear-", "radial-", "conic-"] as const;

/** Anchored unit-suffix check — the only regex on the resolver's hot path. */
const ARBITRARY_LENGTH = /^\[-?[\d.]+(?:px|rem|em|%|ch|ex|vw|vh|vmin|vmax|pt|pc|in|cm|mm|q)\]$/;

const isArbitraryLength = (value: string): boolean => value.startsWith("[length:") || ARBITRARY_LENGTH.test(value);

/** Bare, plain-numeric and `px` remainders all denote a size rather than a colour. */
const isNumericValue = (value: string): boolean => {
  if (value.length === 0 || value === "px") return true;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i] as string;
    if (ch !== "." && (ch < "0" || ch > "9")) return false;
  }
  return true;
};

const isSizeValue = (value: string): boolean => isNumericValue(value) || isArbitraryLength(value);

/** Splits `"b-red-500"` into `["b", "red-500"]` so a side/corner letter can be tested alone. */
const firstSegment = (value: string): string => {
  const dash = value.indexOf("-");
  return dash === -1 ? value : value.slice(0, dash);
};

const restAfterSegment = (value: string, segment: string): string => value.slice(segment.length + 1);

type Dispatcher = (rest: string) => string | undefined;

const constant =
  (group: string): Dispatcher =>
  () =>
    group;

/**
 * `text-` spans four concerns at once. Splitting them keeps a base `text-xs` alive alongside a
 * variant `text-blue-700`.
 */
const textGroup: Dispatcher = (rest) => {
  if (TEXT_ALIGNS.has(rest)) return "text-align";
  if (TEXT_OVERFLOWS.has(rest)) return "text-overflow";
  if (FONT_SIZES.has(rest) || isArbitraryLength(rest)) return "font-size";
  return "text-color";
};

/** `flex` itself is a display value; `flex-col` and `flex-1` are unrelated concerns. */
const flexGroup: Dispatcher = (rest) => {
  if (FLEX_DIRECTIONS.has(rest)) return "flex-direction";
  if (FLEX_WRAPS.has(rest)) return "flex-wrap";
  return "flex";
};

const borderGroup: Dispatcher = (rest) => {
  if (BORDER_STYLES.has(rest)) return "border-style";
  const side = firstSegment(rest);
  if (BORDER_SIDES.has(side)) {
    const value = restAfterSegment(rest, side);
    return isSizeValue(value) ? `border-w-${side}` : `border-color-${side}`;
  }
  return isSizeValue(rest) ? "border-w" : "border-color";
};

const roundedGroup: Dispatcher = (rest) => {
  const corner = firstSegment(rest);
  return ROUNDED_CORNERS.has(corner) ? `rounded-${corner}` : "rounded";
};

const bgGroup: Dispatcher = (rest) => {
  if (BG_ATTACHMENTS.has(rest)) return "bg-attachment";
  if (BG_REPEATS.has(rest)) return "bg-repeat";
  if (BG_SIZES.has(rest)) return "bg-size";
  if (BG_POSITIONS.has(rest)) return "bg-position";
  if (rest === "none" || BG_IMAGE_PREFIXES.some((prefix) => rest.startsWith(prefix))) return "bg-image";
  return "bg-color";
};

const ringGroup: Dispatcher = (rest) => {
  if (rest === "inset") return "ring-inset";
  if (rest.startsWith("offset-")) return "ring-offset";
  return isSizeValue(rest) ? "ring-w" : "ring-color";
};

const shadowGroup: Dispatcher = (rest) => (SHADOW_SIZES.has(rest) ? "shadow" : "shadow-color");

const fontGroup: Dispatcher = (rest) => (FONT_WEIGHTS.has(rest) ? "font-weight" : "font-family");

const outlineGroup: Dispatcher = (rest) => {
  if (OUTLINE_STYLES.has(rest)) return "outline-style";
  if (rest.startsWith("offset-")) return "outline-offset";
  return isSizeValue(rest) ? "outline-w" : "outline-color";
};

const strokeGroup: Dispatcher = (rest) => (isSizeValue(rest) ? "stroke-w" : "stroke-color");

/**
 * `cursor-` is closed apart from arbitrary values, so only the bracketed form goes through the
 * prefix path — a consumer's `cursor-brand` must not claim the group.
 */
const cursorGroup: Dispatcher = (rest) => (rest.startsWith("[") ? "cursor" : undefined);

const exactEntries = (utilities: readonly string[], group: string): [string, string][] => utilities.map((utility) => [utility, group]);

const valueEntries = (prefix: string, values: readonly string[], group: string): [string, string][] =>
  values.map((value) => [`${prefix}${value}`, group]);

/** Closed value spaces: every legal value is enumerated, so nothing else can claim the group. */
const EXACT_GROUPS: ReadonlyMap<string, string> = new Map<string, string>([
  ...exactEntries(DISPLAY, "display"),
  ...exactEntries(POSITION, "position"),
  ...exactEntries(USER_SELECT, "user-select"),
  ...exactEntries(POINTER_EVENTS, "pointer-events"),
  ...valueEntries("overflow-", OVERFLOW_VALUES, "overflow"),
  ...valueEntries("overflow-x-", OVERFLOW_VALUES, "overflow-x"),
  ...valueEntries("overflow-y-", OVERFLOW_VALUES, "overflow-y"),
  ...valueEntries("overscroll-", OVERSCROLL_VALUES, "overscroll"),
  ...valueEntries("overscroll-x-", OVERSCROLL_VALUES, "overscroll-x"),
  ...valueEntries("overscroll-y-", OVERSCROLL_VALUES, "overscroll-y"),
  ...exactEntries(OBJECT_FIT, "object-fit"),
  ...exactEntries(TEXT_TRANSFORM, "text-transform"),
  ...exactEntries(TEXT_DECORATION, "text-decoration"),
  ...exactEntries(VISIBILITY, "visibility"),
  ...exactEntries(FONT_VARIANT_NUMERIC, "font-variant-numeric"),
  ...exactEntries(SR_ONLY, "sr-only"),
  ...exactEntries(BORDER_COLLAPSE, "border-collapse"),
  ...valueEntries("items-", ALIGN_ITEMS_VALUES, "align-items"),
  ...valueEntries("self-", ALIGN_SELF_VALUES, "align-self"),
  ...valueEntries("justify-", JUSTIFY_CONTENT_VALUES, "justify-content"),
  ...valueEntries("justify-self-", JUSTIFY_SELF_VALUES, "justify-self"),
  ...valueEntries("cursor-", CURSOR_VALUES, "cursor"),
  ["truncate", "truncate"],
  ["border", "border-w"],
  ["rounded", "rounded"],
  ["shadow", "shadow"],
  ["ring", "ring-w"],
  ["outline", "outline-w"],
]);

/** Open value spaces: numeric, colour or arbitrary values that cannot be enumerated. */
const PREFIX_GROUPS: ReadonlyMap<string, Dispatcher> = new Map<string, Dispatcher>([
  ["p-", constant("p")],
  ["px-", constant("px")],
  ["py-", constant("py")],
  ["pt-", constant("pt")],
  ["pr-", constant("pr")],
  ["pb-", constant("pb")],
  ["pl-", constant("pl")],
  ["ps-", constant("ps")],
  ["pe-", constant("pe")],
  ["m-", constant("m")],
  ["mx-", constant("mx")],
  ["my-", constant("my")],
  ["mt-", constant("mt")],
  ["mr-", constant("mr")],
  ["mb-", constant("mb")],
  ["ml-", constant("ml")],
  ["ms-", constant("ms")],
  ["me-", constant("me")],
  ["w-", constant("w")],
  ["h-", constant("h")],
  ["size-", constant("size")],
  ["gap-", constant("gap")],
  ["gap-x-", constant("gap-x")],
  ["gap-y-", constant("gap-y")],
  ["z-", constant("z")],
  ["opacity-", constant("opacity")],
  ["inset-", constant("inset")],
  ["inset-x-", constant("inset-x")],
  ["inset-y-", constant("inset-y")],
  ["top-", constant("top")],
  ["right-", constant("right")],
  ["bottom-", constant("bottom")],
  ["left-", constant("left")],
  ["start-", constant("start")],
  ["end-", constant("end")],
  ["leading-", constant("leading")],
  ["tracking-", constant("tracking")],
  ["translate-", constant("translate")],
  ["translate-x-", constant("translate-x")],
  ["translate-y-", constant("translate-y")],
  ["animate-", constant("animate")],
  ["duration-", constant("duration")],
  ["text-", textGroup],
  ["flex-", flexGroup],
  ["border-", borderGroup],
  ["rounded-", roundedGroup],
  ["bg-", bgGroup],
  ["ring-", ringGroup],
  ["shadow-", shadowGroup],
  ["font-", fontGroup],
  ["outline-", outlineGroup],
  // The object-fit values are enumerated exactly above, so the prefix only ever sees a position.
  ["object-", constant("object-position")],
  ["stroke-", strokeGroup],
  ["cursor-", cursorGroup],
]);

const BORDER_SIDE_NAMES = ["x", "y", "t", "r", "b", "l", "s", "e"] as const;

const sideGroups = (base: string, sides: readonly string[]): string[] => sides.map((side) => `${base}-${side}`);

/**
 * One-directional override edges: accepting the shorthand marks its longhands consumed, never the
 * reverse. So `cn("px-2", "p-4")` collapses to `p-4`, while `cn("p-4", "px-2")` keeps both — the
 * second is a deliberate narrowing of the first, not a conflict.
 */
export const GROUP_OVERRIDES: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["p", ["px", "py", "pt", "pr", "pb", "pl", "ps", "pe"]],
  ["px", ["pl", "pr", "ps", "pe"]],
  ["py", ["pt", "pb"]],
  ["m", ["mx", "my", "mt", "mr", "mb", "ml", "ms", "me"]],
  ["mx", ["ml", "mr", "ms", "me"]],
  ["my", ["mt", "mb"]],
  ["size", ["w", "h"]],
  ["inset", ["inset-x", "inset-y", "top", "right", "bottom", "left", "start", "end"]],
  ["inset-x", ["left", "right", "start", "end"]],
  ["inset-y", ["top", "bottom"]],
  ["gap", ["gap-x", "gap-y"]],
  ["overflow", ["overflow-x", "overflow-y"]],
  ["overscroll", ["overscroll-x", "overscroll-y"]],
  [
    "rounded",
    [
      "rounded-t",
      "rounded-r",
      "rounded-b",
      "rounded-l",
      "rounded-s",
      "rounded-e",
      "rounded-tl",
      "rounded-tr",
      "rounded-br",
      "rounded-bl",
      "rounded-ss",
      "rounded-se",
      "rounded-ee",
      "rounded-es",
    ],
  ],
  ["rounded-t", ["rounded-tl", "rounded-tr"]],
  ["rounded-r", ["rounded-tr", "rounded-br"]],
  ["rounded-b", ["rounded-br", "rounded-bl"]],
  ["rounded-l", ["rounded-tl", "rounded-bl"]],
  ["rounded-s", ["rounded-ss", "rounded-es"]],
  ["rounded-e", ["rounded-se", "rounded-ee"]],
  ["border-w", sideGroups("border-w", BORDER_SIDE_NAMES)],
  ["border-w-x", ["border-w-l", "border-w-r", "border-w-s", "border-w-e"]],
  ["border-w-y", ["border-w-t", "border-w-b"]],
  ["border-color", sideGroups("border-color", BORDER_SIDE_NAMES)],
  ["border-color-x", ["border-color-l", "border-color-r", "border-color-s", "border-color-e"]],
  ["border-color-y", ["border-color-t", "border-color-b"]],
  // `flex-1` governs grow/shrink only. Display lives in its own group, so accepting one must
  // never consume the other.
  ["flex", []],
]);

/**
 * Names the CSS concern a utility sets, or `undefined` when the utility is outside the table.
 * The argument must already have its modifier prefix, importance marker and value slash removed.
 *
 * @internal
 */
export function classGroup(utility: string): string | undefined {
  if (utility.length === 0) return undefined;

  if (utility.startsWith("[")) {
    const colon = utility.indexOf(":");
    return colon === -1 ? undefined : `arb:${utility.slice(1, colon)}`;
  }

  const bare = utility.startsWith("-") ? utility.slice(1) : utility;

  const exact = EXACT_GROUPS.get(bare);
  if (exact !== undefined) return exact;

  // Longest dash-prefix wins, so `border-b-` is offered before `border-`.
  for (let i = bare.length - 1; i >= 0; i -= 1) {
    if (bare[i] !== "-") continue;
    const dispatch = PREFIX_GROUPS.get(bare.slice(0, i + 1));
    if (dispatch) return dispatch(bare.slice(i + 1));
  }

  return undefined;
}
