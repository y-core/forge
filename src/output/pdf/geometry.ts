import type { Ink, TextStyle } from "./types";

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;
export const MARGIN = 56;

export const LABEL_WIDTH = 124;
export const LABEL_GAP = 16;

export const ANSWER_GUTTER = 12;
export const COLUMN_GUTTER = 12;

export const TITLE_SIZE = 14;
export const SUBTITLE_SIZE = 10;
export const INTRO_SIZE = 8;
export const INTRO_LINE = 11;
export const HEADING_SIZE = 12;
export const LABEL_SIZE = 9;
export const VALUE_SIZE = 10;
export const NOTE_SIZE = 9;
export const LINE = 13;

export const MARK_SIZE = 9;
export const MARK_WEIGHT = 0.7;
// The box straddles the baseline rather than sitting on it, so it centres on the label beside it.
export const MARK_DROP = 1.5;
export const MARK_INSET = 2;
export const MARK_RADIUS = 2;
export const GLYPH_WEIGHT = 1;
export const BLANK_DROP = 3;
export const BLANK_WEIGHT = 0.5;
export const RULE_WEIGHT = 0.5;
// A rule crowded against the next label reads as an underline of it, so a blank row is led wider.
export const BLANK_LEAD = 8;
export const PAIR_LEAD = 3;
export const TICK_GAP = 5;
export const OPTION_GUTTER = 14;
export const TICK_COLUMNS = 2;
// Wide enough for a yes, a no and an "I do not know"; narrower than any real list of choices.
export const WIDE_OPTIONS_WIDTH = 172;
export const SUBHEADING_LEAD = 7;

export const HEADING_TRACKING = 1.1;
export const BOLD_RUN: TextStyle = { bold: true };
export const HEADED: TextStyle = { bold: true, tracking: HEADING_TRACKING };

export const HEADING_LEAD = 20;
export const HEADING_LINE = 15;

export const SIGNATURE_LEAD = 12;
export const SIGNATURE_TRAIL = 14;
export const SIGNATURE_GUTTER = 36;

// Below this a value column has stopped being one, so the label goes above and the answer takes the
// whole cell instead.
export const MIN_VALUE_WIDTH = 82;

/** The ink every page opens and every painted run closes on. @internal */
export const BLACK_INK: Ink = [0, 0, 0];

/** What a translucent run closes on, which restores the opacity as well as the colour. @internal */
export const OPAQUE_INK: Ink = [0, 0, 0, 1];

// How wide a mark is drawn where the letterhead names no width of its own; the mark's own
// coordinate space is scaled out of this, so forge never holds a firm's artwork at its own size.
export const LETTERHEAD_MARK_WIDTH = 250;
export const LETTERHEAD_MARK_GAP = 16;
export const LETTERHEAD_NAME_SIZE = 14;
export const LETTERHEAD_TAGLINE_SIZE = 10;
export const LETTERHEAD_LINE_GAP = 4;

export const CONTACT_SIZE = 8.5;
export const LETTERHEAD_GAP = 10;

// PDF has no circle primitive; this is the Bézier constant that makes four arcs approximate one.
// `tooling/assets/mark-build.ts` repeats it: the two may not import each other, and that is worth more.
export const KAPPA = 0.5523;

/** The resource names the two base-14 faces are addressed by in a content stream. @internal */
export const REGULAR = "F1";
export const BOLD = "F2";

// Twelve columns and eleven gutters across the measure, as a CSS grid divides one.
export const ROW_COLUMNS = 12;
