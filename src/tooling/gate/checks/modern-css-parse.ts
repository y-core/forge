import type { ModernCssReportedId, ModernCssRuleId } from "../../lint/modern-css-rules";
import { blankComments, lineAt, suppressedBy } from "./source-scan";

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
export const isModernCssSuppressed: (lines: readonly string[], line: number, ruleId: ModernCssReportedId) => boolean =
  suppressedBy("modern-css-allow");

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

/** Physical spacing properties in a stylesheet. The utility half is `forge/platform-logical-spacing`
 *  in forge's oxlint plugin, which reads a class literal off the AST rather than off the line. @public */
export function findPhysicalSpacing(source: string, file: string): ModernCssFinding[] {
  return file.endsWith(".css") ? findPhysicalProperties(source, file) : [];
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
