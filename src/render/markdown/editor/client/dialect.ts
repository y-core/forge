import { Facet } from "@codemirror/state";

import type { ViewportDialect } from "./types";

const NO_DIALECT: ViewportDialect = { spans: () => [], calloutKinds: [] };
const CALLOUT_MARKERS = new WeakMap<ViewportDialect, RegExp | null>();
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** The dialect a viewport state decorates, the first one provided, or none. @internal */
export const viewportDialect = Facet.define<ViewportDialect, ViewportDialect>({ combine: (values) => values[0] ?? NO_DIALECT });

/** The pattern a line opening one of the dialect's callouts starts with, or null when it names no kinds. @internal */
export function calloutPattern(dialect: ViewportDialect): RegExp | null {
  const cached = CALLOUT_MARKERS.get(dialect);
  if (cached !== undefined) return cached;
  const kinds = dialect.calloutKinds.map((kind) => kind.replace(REGEX_SPECIALS, "\\$&"));
  const pattern = kinds.length === 0 ? null : new RegExp(`^>(?: {0,4}|\\t)\\[!(${kinds.join("|")})\\](?=[ \\t\\r\\n]|$)`, "i");
  CALLOUT_MARKERS.set(dialect, pattern);
  return pattern;
}
