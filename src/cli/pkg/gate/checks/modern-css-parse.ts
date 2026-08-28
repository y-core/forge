import { isClassAnchor } from "./css-parse";
import type { ModernCssReportedId, ModernCssRuleId } from "./modern-css-rules";

/** One modern-platform rule violated at one place. @public */
export interface ModernCssFinding {
  /** Repo-relative path of the file the violation sits in. */
  file: string;
  /** 1-indexed line. */
  line: number;
  ruleId: ModernCssReportedId;
  detail: string;
}

/** A `/* modern-css-allow: <rule> — <reason> *​/` comment on `line` or the one above it. The reason
 *  is mandatory — a bare marker with no text after the em dash does not suppress. @public */
export function isModernCssSuppressed(lines: readonly string[], line: number, ruleId: ModernCssReportedId): boolean {
  // `\S` alone is satisfied by the `*` of the closing `*/`, which would let a reasonless marker
  // suppress; the lookahead excludes it so the mandatory reason cannot be bypassed.
  const marker = new RegExp(`/\\*\\s*modern-css-allow:\\s*${ruleId}\\s+—\\s+(?!\\*/)\\S`);
  return [lines[line - 1], lines[line - 2]].some((candidate) => candidate !== undefined && marker.test(candidate));
}

/** Replaces every comment body with spaces, so offsets and line numbers survive the blanking. @public */
export function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** A declaration block — one with no nested block of its own — and the at-rules enclosing it. @public */
export interface CssBlock {
  /** The selector or at-rule prelude, whitespace collapsed. */
  prelude: string;
  /** The text between the braces. */
  body: string;
  /** Offset of the first character of `body`. */
  start: number;
  /** The preludes of every enclosing block, outermost first. */
  ancestors: string[];
}

interface Frame {
  preludeStart: number;
  braceIndex: number;
  nested: boolean;
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Every declaration block in a stylesheet, walked by brace depth. @public */
export function findCssBlocks(css: string): CssBlock[] {
  const out: CssBlock[] = [];
  const stack: Frame[] = [];
  let preludeStart = 0;

  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === "{") {
      const parent = stack[stack.length - 1];
      if (parent !== undefined) parent.nested = true;
      stack.push({ preludeStart, braceIndex: i, nested: false });
      preludeStart = i + 1;
      continue;
    }
    if (char === "}") {
      const frame = stack.pop();
      preludeStart = i + 1;
      if (frame === undefined || frame.nested) continue;
      out.push({
        prelude: collapse(css.slice(frame.preludeStart, frame.braceIndex)),
        body: css.slice(frame.braceIndex + 1, i),
        start: frame.braceIndex + 1,
        ancestors: stack.map((ancestor) => collapse(css.slice(ancestor.preludeStart, ancestor.braceIndex))),
      });
      continue;
    }
    if (char === ";") preludeStart = i + 1;
  }
  return out;
}

const PERCENT_PADDING = /(?<![\w-])padding-bottom\s*:\s*(\d+(?:\.\d+)?%)/g;

/** Percentage bottom padding standing in for a ratio box. @public */
export function findAspectRatioPadding(source: string, file: string): ModernCssFinding[] {
  const css = blankComments(source);
  const lines = source.split("\n");
  const findings: ModernCssFinding[] = [];

  for (const block of findCssBlocks(css)) {
    if (!/(?<![\w-])position\s*:\s*relative/.test(block.body)) continue;
    for (const match of block.body.matchAll(PERCENT_PADDING)) {
      const line = lineAt(css, block.start + match.index);
      if (isModernCssSuppressed(lines, line, "forge-ui-platform-aspect-ratio")) continue;
      findings.push({
        file,
        line,
        ruleId: "forge-ui-platform-aspect-ratio",
        detail: `\`padding-bottom: ${match[1]}\` in a \`position: relative\` rule reserves a ratio box — declare it with \`aspect-ratio\``,
      });
    }
  }
  return findings;
}

/** The offset-and-translate centring idiom. @public */
export function findTranslateCentering(source: string, file: string): ModernCssFinding[] {
  const css = blankComments(source);
  const lines = source.split("\n");
  const findings: ModernCssFinding[] = [];

  for (const block of findCssBlocks(css)) {
    if (!/(?<![\w-])top\s*:\s*50%/.test(block.body)) continue;
    if (!/(?<![\w-])left\s*:\s*50%/.test(block.body)) continue;
    const translate = /translate\(\s*-50%\s*,\s*-50%\s*\)/.exec(block.body);
    if (translate === null) continue;

    const line = lineAt(css, block.start + translate.index);
    if (isModernCssSuppressed(lines, line, "forge-ui-platform-centering")) continue;
    findings.push({
      file,
      line,
      ruleId: "forge-ui-platform-centering",
      detail: "`top: 50%` and `left: 50%` pulled back by `translate(-50%, -50%)` — centre the child with `place-items: center` on the container",
    });
  }
  return findings;
}

function scanLines(source: string, file: string, ruleId: ModernCssRuleId, pattern: RegExp, detail: (hit: string) => string): ModernCssFinding[] {
  const scanned = blankComments(source).split("\n");
  const lines = source.split("\n");
  const findings: ModernCssFinding[] = [];

  for (let i = 0; i < scanned.length; i++) {
    if (isModernCssSuppressed(lines, i + 1, ruleId)) continue;
    const hits = new Set<string>();
    for (const match of (scanned[i] ?? "").matchAll(pattern)) hits.add(match[1] ?? match[0]);
    for (const hit of hits) findings.push({ file, line: i + 1, ruleId, detail: detail(hit) });
  }
  return findings;
}

/** Density media queries standing in for a resolution-switched image. @public */
export function findDensityQueries(source: string, file: string): ModernCssFinding[] {
  return scanLines(
    source,
    file,
    "forge-ui-platform-image-set",
    /(?<![\w-])(min-resolution|-webkit-min-device-pixel-ratio)\s*:/g,
    (hit) => `\`${hit}\` selects an image by device density — declare the variants with \`image-set()\``,
  );
}

/** A negative `z-index`, which paints a layer out of its parent rather than behind a sibling. @public */
export function findNegativeZIndex(source: string, file: string): ModernCssFinding[] {
  return scanLines(
    source,
    file,
    "forge-ui-platform-isolation",
    /(?<![\w-])z-index\s*:\s*(-\d+)/g,
    (hit) => `\`z-index: ${hit}\` escapes the parent's paint order — create a stacking context with \`isolation: isolate\``,
  );
}

/** The prefixed line-clamp idiom. @public */
export function findPrefixedLineClamp(source: string, file: string): ModernCssFinding[] {
  return scanLines(
    source,
    file,
    "forge-ui-platform-line-clamp",
    /(?<![\w-])(-webkit-line-clamp|-webkit-box-orient)\s*:/g,
    (hit) => `\`${hit}\` is a prefixed property tied to \`display: -webkit-box\` — clamp with \`line-clamp\``,
  );
}

/** The non-standard scrollbar pseudo-elements. @public */
export function findWebkitScrollbar(source: string, file: string): ModernCssFinding[] {
  return scanLines(
    source,
    file,
    "forge-ui-platform-scrollbar",
    /::-webkit-scrollbar[a-z-]*/g,
    (hit) => `\`${hit}\` is a non-standard pseudo-element — style the scrollbar with \`scrollbar-color\` and \`scrollbar-width\``,
  );
}

/** A selector declared a second time under a `prefers-color-scheme` query. @public */
export function findDuplicatedColorScheme(source: string, file: string): ModernCssFinding[] {
  const css = blankComments(source);
  const lines = source.split("\n");
  const blocks = findCssBlocks(css);
  const underScheme = (block: CssBlock): boolean => block.ancestors.some((prelude) => prelude.includes("prefers-color-scheme"));
  const outside = new Set(blocks.filter((block) => !underScheme(block)).map((block) => block.prelude));
  const findings: ModernCssFinding[] = [];

  for (const block of blocks) {
    if (block.prelude === "" || !underScheme(block) || !outside.has(block.prelude)) continue;
    const line = lineAt(css, block.start);
    if (isModernCssSuppressed(lines, line, "forge-ui-platform-light-dark")) continue;
    findings.push({
      file,
      line,
      ruleId: "forge-ui-platform-light-dark",
      detail: `\`${block.prelude}\` is declared again under \`prefers-color-scheme\` — express the per-mode value with \`light-dark()\``,
    });
  }
  return findings;
}

// The inline axis only. `margin-top` and `margin-block-start` name the same edge in every writing
// mode forge ships, so a block-axis rewrite changes no rendering — mirroring is what the rule is for.
const LOGICAL_PROPERTY: Readonly<Record<string, string>> = {
  "margin-left": "margin-inline-start",
  "margin-right": "margin-inline-end",
  "padding-left": "padding-inline-start",
  "padding-right": "padding-inline-end",
  left: "inset-inline-start",
  right: "inset-inline-end",
};

const PHYSICAL_PROPERTY = /(?<![\w-])((?:margin|padding)-(?:left|right)|left|right)\s*:([^;}]*)/g;

const PHYSICAL_UTILITY =
  /(?<![\w-])(?:[a-z][a-z0-9-]*:)*(?:[mp][lr]-[a-z0-9./[\]-]+|(?:border|rounded)-[lr](?![a-z])[a-z0-9./[\]-]*|text-(?:left|right))(?![\w])/g;

const UTILITY_SWAP: readonly (readonly [RegExp, string])[] = [
  [/^ml-/, "ms-"],
  [/^mr-/, "me-"],
  [/^pl-/, "ps-"],
  [/^pr-/, "pe-"],
  [/^border-l\b/, "border-s"],
  [/^border-r\b/, "border-e"],
  [/^rounded-l\b/, "rounded-s"],
  [/^rounded-r\b/, "rounded-e"],
  [/^text-left$/, "text-start"],
  [/^text-right$/, "text-end"],
];

/** The logical spelling of a physical Tailwind utility, variants preserved. @public */
export function logicalUtility(token: string): string {
  const variants = token.slice(0, token.lastIndexOf(":") + 1);
  const base = token.slice(variants.length);
  for (const [physical, logical] of UTILITY_SWAP) {
    if (physical.test(base)) return `${variants}${base.replace(physical, logical)}`;
  }
  return token;
}

function findPhysicalProperties(source: string, file: string): ModernCssFinding[] {
  const scanned = blankComments(source).split("\n");
  const lines = source.split("\n");
  const findings: ModernCssFinding[] = [];

  for (let i = 0; i < scanned.length; i++) {
    if (isModernCssSuppressed(lines, i + 1, "forge-ui-platform-logical-spacing")) continue;
    const hits = new Set<string>();
    for (const match of (scanned[i] ?? "").matchAll(PHYSICAL_PROPERTY)) {
      // `anchor()` takes a physical `<anchor-side>` and has no inline-axis spelling, so an inset
      // resolved against one cannot be written logically at all.
      if ((match[2] ?? "").includes("anchor(")) continue;
      hits.add(match[1] ?? "");
    }
    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-platform-logical-spacing",
        detail: `physical property \`${hit}\` — use \`${LOGICAL_PROPERTY[hit] ?? hit}\``,
      });
    }
  }
  return findings;
}

const CLASS_POSITION = /\bclass(?:Name)?\s*[=:]|\bcn\(|\basClass\(/g;

function quotedStrings(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) out.push(match[1] ?? match[2] ?? match[3] ?? "");
  return out;
}

function closingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return i;
  }
  return source.length - 1;
}

function findClassPositionLines(source: string): Set<number> {
  const scanned = blankComments(source);
  const found = new Set<number>();
  for (const match of scanned.matchAll(CLASS_POSITION)) {
    const start = lineAt(scanned, match.index);
    // A `cn(` argument list wraps, so `dismissible && "pr-10"` sits lines below the call it belongs
    // to; balancing the call is what reaches it.
    const end = match[0].endsWith("(") ? lineAt(scanned, closingParen(scanned, match.index + match[0].length - 1)) : start;
    for (let line = start; line <= end; line++) found.add(line);
  }
  return found;
}

function findPhysicalUtilities(source: string, file: string): ModernCssFinding[] {
  const classPosition = findClassPositionLines(source);
  const scanned = blankComments(source).split("\n");
  const lines = source.split("\n");
  const findings: ModernCssFinding[] = [];

  for (let i = 0; i < scanned.length; i++) {
    if (isModernCssSuppressed(lines, i + 1, "forge-ui-platform-logical-spacing")) continue;
    const literals = quotedStrings(scanned[i] ?? "");
    const declares = literals.some((literal) => literal.split(/\s+/).filter(isClassAnchor).length >= 2);
    if (!classPosition.has(i + 1) && !declares) continue;
    const hits = new Set<string>();
    for (const literal of literals) {
      for (const match of literal.matchAll(PHYSICAL_UTILITY)) hits.add(match[0]);
    }
    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-platform-logical-spacing",
        detail: `physical utility \`${hit}\` — use \`${logicalUtility(hit)}\``,
      });
    }
  }
  return findings;
}

/** Physical spacing: CSS properties in a stylesheet, Tailwind utilities in a class literal. @public */
export function findPhysicalSpacing(source: string, file: string): ModernCssFinding[] {
  return file.endsWith(".css") ? findPhysicalProperties(source, file) : findPhysicalUtilities(source, file);
}

/** Every Tier A rule over one file, in rule order, then by line. @public */
export function findModernCssViolations(source: string, file: string): ModernCssFinding[] {
  return [
    ...findAspectRatioPadding(source, file),
    ...findTranslateCentering(source, file),
    ...findDensityQueries(source, file),
    ...findNegativeZIndex(source, file),
    ...findDuplicatedColorScheme(source, file),
    ...findPrefixedLineClamp(source, file),
    ...findPhysicalSpacing(source, file),
    ...findWebkitScrollbar(source, file),
  ].sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}
