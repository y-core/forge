import { blankComments, findCssBlocks, isModernCssSuppressed, type ModernCssFinding } from "./modern-css-parse";
import type { ModernCssReportedId } from "./modern-css-rules";

function blankSource(source: string): string {
  return blankComments(source).replace(/^([ \t]*)\/\/.*$/gm, (line, indent: string) => indent + " ".repeat(line.length - indent.length));
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

interface Emitter {
  file: string;
  lines: readonly string[];
  scanned: string;
  findings: ModernCssFinding[];
}

function emit(out: Emitter, index: number, ruleId: ModernCssReportedId, detail: string): void {
  const line = lineAt(out.scanned, index);
  if (isModernCssSuppressed(out.lines, line, ruleId)) return;
  out.findings.push({ file: out.file, line, ruleId, detail });
}

function emitter(source: string, file: string): Emitter {
  return { file, lines: source.split("\n"), scanned: blankSource(source), findings: [] };
}

/** The balanced argument list of every call whose head matches `pattern`; the pattern must end at the `(`. */
function callRegions(source: string, pattern: RegExp): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  for (const match of source.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        out.push({ start: open + 1, body: source.slice(open + 1, i) });
        break;
      }
    }
  }
  return out;
}

function scanLines(out: Emitter, ruleId: ModernCssReportedId, pattern: RegExp, detail: (hit: string) => string): void {
  for (const match of out.scanned.matchAll(pattern)) emit(out, match.index, ruleId, detail(match[1] ?? match[0]));
}

function scanCalls(out: Emitter, ruleId: ModernCssReportedId, call: RegExp, inner: RegExp, detail: (hit: string) => string): void {
  for (const region of callRegions(out.scanned, call)) {
    const hit = inner.exec(region.body);
    if (hit === null) continue;
    emit(out, region.start + hit.index, ruleId, detail(hit[1] ?? hit[0]));
  }
}

const CLASS_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

function classLiterals(source: string): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  for (const match of source.matchAll(CLASS_LITERAL)) out.push({ index: match.index, text: match[1] ?? match[2] ?? match[3] ?? "" });
  return out;
}

const RAF = /requestAnimationFrame\s*\(/g;

function enclosingTag(source: string, index: number): string {
  const open = source.lastIndexOf("<", index);
  if (open === -1) return "";
  return /^<\s*([A-Za-z][\w.-]*)/.exec(source.slice(open, index))?.[1] ?? "";
}

const DIALOG_ATTR = /(?<![\w-])(role)\s*=\s*["'](?:alert)?dialog["']|(?<![\w-])(aria-modal)(?=[\s=])/g;

function findNativeDialog(out: Emitter): void {
  for (const match of out.scanned.matchAll(DIALOG_ATTR)) {
    const tag = enclosingTag(out.scanned, match.index);
    if (tag.toLowerCase() === "dialog") continue;
    const attr = match[1] ?? match[2] ?? "";
    emit(
      out,
      match.index,
      "forge-ui-platform-native-dialog",
      `\`${attr}\` on a \`<${tag}>\` — open a native \`<dialog>\` with \`showModal()\` instead of re-declaring the role`,
    );
  }
}

const POPOVER_DECLARED = /(?<![\w-])popover(?:target(?:action)?)?\s*=|showPopover\s*\(/;

const FLOATING_SLOT = /data-slot\s*=\s*["'][^"']*(menu|tooltip|dropdown|popover)[^"']*["']/g;

function findNativePopover(out: Emitter): void {
  if (POPOVER_DECLARED.test(out.scanned)) return;
  if (!classLiterals(out.scanned).some((literal) => /(?<![\w-])absolute(?![\w-])/.test(literal.text))) return;
  scanLines(
    out,
    "forge-ui-platform-native-popover",
    FLOATING_SLOT,
    (hit) => `an absolutely-positioned \`${hit}\` with no \`popover\` attribute — declare it through the Popover API`,
  );
}

const CLICK_HANDLER = /addEventListener\(\s*["']click["']|(?<![\w-])onclick\s*=/;

function findNativeDetails(out: Emitter): void {
  if (!CLICK_HANDLER.test(out.scanned)) return;
  scanLines(
    out,
    "forge-ui-platform-native-details",
    /(?<![\w-])aria-expanded(?=[\s=])/g,
    () => "`aria-expanded` toggled from a click handler — express the disclosure with `<details>` and `<summary>`",
  );
}

function findEntryMotion(out: Emitter): void {
  scanCalls(
    out,
    "forge-ui-platform-entry-motion",
    RAF,
    /classList\s*\.\s*(?:add|remove|toggle)\s*\(/,
    () =>
      "a class added inside `requestAnimationFrame` to start an entry transition — declare it with `@starting-style` and `transition-behavior: allow-discrete`",
  );
}

function findParentState(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-parent-state",
    /(?:parentElement|parentNode|closest\([^)\n]*\))[^;\n]*classList\s*\.\s*(?:add|remove|toggle)/g,
    () => "a class set on an ancestor from a descendant's state — select the ancestor with `:has()`",
  );
}

const TABINDEX_SAVE = /setAttribute\(\s*["']tabindex["']\s*,\s*["']-1["']\s*\)|(?:prev|previous|saved|original)[\w]*\s*=\s*[^;\n]*tab[iI]ndex/g;

function findInert(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-inert",
    TABINDEX_SAVE,
    () => "`tabindex` swept and restored to hold focus inside a subtree — mark the rest of the page `inert`",
  );
}

function findThemeDetection(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-theme-detection",
    /matchMedia\(\s*[`"'][^`"']*prefers-color-scheme/g,
    () => "`matchMedia` reads the colour scheme in script — resolve the per-mode value with `light-dark()`",
  );
}

function findSmoothScroll(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-smooth-scroll",
    /behavior\s*:\s*["']smooth["']|scroll(?:To|By)\(\s*[^)\n]*offsetTop\s*-/g,
    () => "a scroll animated from script — declare `scroll-behavior` and clear the header with `scroll-margin`",
  );
}

function findTicker(out: Emitter): void {
  scanCalls(
    out,
    "forge-ui-platform-ticker",
    /setInterval\s*\(/g,
    /style\s*\.\s*(transform|left|top|translate)/,
    (hit) => `\`setInterval\` mutating \`style.${hit}\` — declare the motion as keyframes gated on \`prefers-reduced-motion\``,
  );
}

function findCounters(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-counters",
    /(?:textContent|innerText)\s*=\s*[^;\n]*(?:\b(?:index|idx)\b|\bi\s*\+\s*1\b)/g,
    () => "an index written into text content — number the items with CSS counters",
  );
}

function findCountUp(out: Emitter): void {
  scanCalls(
    out,
    "forge-ui-platform-count-up",
    RAF,
    /(?:textContent|innerText)\s*=\s*[^;\n]*(?:toFixed\(|Math\.round\(|toLocaleString\()/,
    () => "a number stepped per frame — interpolate a registered `@property` and print it with a counter",
  );
}

function findAnimatedBorder(out: Emitter): void {
  scanCalls(
    out,
    "forge-ui-platform-animated-border",
    RAF,
    /setProperty\([^;\n]*deg|conic-gradient/,
    () => "a gradient angle mutated per frame — register the angle with `@property` and animate the `conic-gradient()`",
  );
}

function findMotionPath(out: Emitter): void {
  scanCalls(
    out,
    "forge-ui-platform-motion-path",
    RAF,
    /Math\.(?:sin|cos)\(/,
    () => "coordinates computed per frame along a fixed path — declare the path with `offset-path`",
  );
}

function findRevealMask(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-reveal-mask",
    /style\s*\.\s*(?:clipPath|maskImage|webkitMaskImage)\s*=|setProperty\(\s*["'](?:clip-path|mask|mask-image)["']/g,
    () => "clip or mask geometry computed in script — declare the mask in CSS and drive it with one custom property",
  );
}

// The two observers forge ships load modules and mark a nav link; neither touches a class, and the
// callback body is what separates them from a reveal that a view timeline would replace outright.
const OBSERVER_CTOR = /new\s+[\w$.]*[Oo]bserver[\w$]*\s*\(/g;

function findScrollReveal(out: Emitter): void {
  if (!/IntersectionObserver/.test(out.scanned)) return;
  scanCalls(
    out,
    "forge-ui-platform-scroll-reveal",
    OBSERVER_CTOR,
    /classList\s*\.\s*(?:add|remove|toggle)\s*\(/,
    () => "a class added inside an `IntersectionObserver` callback — drive the reveal with `animation-timeline: view()`",
  );
}

function findCarousel(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-carousel",
    /scrollLeft\s*[+-]?=|\.scrollBy\(|translateX\(\s*[^)\n]*(?:index|current|slide)/g,
    () => "slides stepped from script — page the track with scroll snap and `::scroll-button()`",
  );
}

function findFieldSizing(out: Emitter): void {
  scanLines(
    out,
    "forge-ui-platform-field-sizing",
    /style\s*\.\s*height\s*=[^;\n]*scrollHeight|setProperty\(\s*["']height["'][^;\n]*scrollHeight/g,
    () => "`scrollHeight` written back as a height — let the control grow with `field-sizing: content`",
  );
}

function findAnchorPositioning(out: Emitter): void {
  if (!/getBoundingClientRect/.test(out.scanned)) return;
  scanLines(
    out,
    "forge-ui-platform-anchor-positioning",
    /style\s*\.\s*(top|left|right|bottom)\s*=|setProperty\(\s*["'](top|left|right|bottom)["']/g,
    (hit) => `a measured rectangle written to \`${hit}\` — position against the anchor with \`anchor()\``,
  );
}

const HEADING_SIZE = /(?<![\w-])text-(?:2xl|3xl|4xl|5xl|6xl|7xl)(?![\w-])/;

const PROSE_CLASS = /(?<![\w-])(?:prose|max-w-prose|leading-relaxed)(?![\w-])/;

function findWrapUtilities(out: Emitter): void {
  for (const literal of classLiterals(out.scanned)) {
    const heading = HEADING_SIZE.exec(literal.text);
    if (heading !== null && !/(?<![\w-])text-balance(?![\w-])/.test(literal.text)) {
      emit(
        out,
        literal.index,
        "forge-ui-platform-text-balance",
        `\`${heading[0]}\` heading with no \`text-balance\` — balance the line breaks with \`text-wrap: balance\``,
      );
    }
    const prose = PROSE_CLASS.exec(literal.text);
    if (prose !== null && !/(?<![\w-])text-pretty(?![\w-])/.test(literal.text)) {
      emit(
        out,
        literal.index,
        "forge-ui-platform-text-pretty",
        `\`${prose[0]}\` prose with no \`text-pretty\` — avoid the orphan with \`text-wrap: pretty\``,
      );
    }
  }
}

const MOTION_UTILITY = /(?<![\w-])(transition(?:-[a-z]+)?|animate-[a-z0-9-]+)(?![\w-])/g;

function findUngatedMotion(out: Emitter): void {
  for (const literal of classLiterals(out.scanned)) {
    if (/motion-safe:|motion-reduce:/.test(literal.text)) continue;
    const motion = new RegExp(MOTION_UTILITY.source).exec(literal.text);
    if (motion === null) continue;
    emit(
      out,
      literal.index,
      "forge-ui-reduced-motion",
      `\`${motion[1]}\` with no \`motion-safe:\` or \`motion-reduce:\` variant beside it — gate authored motion on \`prefers-reduced-motion\``,
    );
  }
}

function findFieldSizingAdoption(out: Emitter): void {
  if (/field-sizing/.test(out.scanned)) return;
  scanLines(
    out,
    "forge-ui-platform-field-sizing-adopt",
    /<textarea(?=[\s/>])/g,
    () => "`<textarea>` with no `field-sizing-content` — let the control grow with `field-sizing: content`",
  );
}

function findAccentColor(out: Emitter): void {
  if (/(?<![\w-])accent-/.test(out.scanned)) return;
  if (!/(?<![\w-])appearance-none(?![\w-])/.test(out.scanned)) return;
  scanLines(
    out,
    "forge-ui-platform-accent-color",
    /type\s*=\s*["'](checkbox|radio)["']/g,
    (hit) => `a hand-styled \`<input type="${hit}">\` — tint the native control with \`accent-color\``,
  );
}

function findViewTransition(out: Emitter): void {
  if (/startViewTransition/.test(out.scanned)) return;
  scanLines(
    out,
    "forge-ui-platform-view-transition",
    /location\s*\.\s*(?:href\s*=|assign\(|replace\()/g,
    () => "a full-page swap with no `startViewTransition()` — cross-fade the navigation with a view transition",
  );
}

const WIDTH_QUERY = /[`"']\s*\((?:min|max)-width\s*:/g;

function findScriptedWidthQuery(out: Emitter): void {
  if (/@container|container-type/.test(out.scanned)) return;
  scanLines(
    out,
    "forge-ui-platform-container-query",
    WIDTH_QUERY,
    () => "a width query in script sizes a component against the viewport — measure the container with `@container`",
  );
}

// The wrapper has to open a subtree: a `<span>Left</span>` closed on its own line is a sibling in
// the row, and `display: contents` would dissolve the box its content needs.
const BARE_WRAPPER = /class\s*=\s*[{'"][^\n]*(?<![\w-])(?:grid|flex)(?![\w-])[^\n]*\n[ \t]*(<(?:div|span)>)[ \t]*(?=\n)/g;

function findDisplayContents(out: Emitter): void {
  for (const match of out.scanned.matchAll(BARE_WRAPPER)) {
    const wrapper = match.index + match[0].lastIndexOf(match[1] ?? "");
    emit(
      out,
      wrapper,
      "forge-ui-platform-display-contents",
      "an attribute-free wrapper inside a `display: grid` or `display: flex` parent — let its children join the parent with `display: contents`",
    );
  }
}

function findSourceViolations(source: string, file: string): ModernCssFinding[] {
  const out = emitter(source, file);
  findNativeDialog(out);
  findNativePopover(out);
  findNativeDetails(out);
  findEntryMotion(out);
  findParentState(out);
  findInert(out);
  findThemeDetection(out);
  findSmoothScroll(out);
  findTicker(out);
  findCounters(out);
  findCountUp(out);
  findAnimatedBorder(out);
  findMotionPath(out);
  findRevealMask(out);
  findScrollReveal(out);
  findCarousel(out);
  findFieldSizing(out);
  findAnchorPositioning(out);
  findWrapUtilities(out);
  findUngatedMotion(out);
  findFieldSizingAdoption(out);
  findAccentColor(out);
  findViewTransition(out);
  findScriptedWidthQuery(out);
  findDisplayContents(out);
  return out.findings;
}

function findMissingLayer(out: Emitter): void {
  if (/@layer/.test(out.scanned)) return;
  if (out.scanned.trim() === "") return;
  emit(out, 0, "forge-ui-platform-layer", "the stylesheet declares no `@layer` — order the cascade in named layers");
}

function findViewportMediaQueries(out: Emitter): void {
  if (/@container|container-type/.test(out.scanned)) return;
  const first = /@media[^{]*\((?:min|max)-width/.exec(out.scanned);
  if (first === null) return;
  emit(
    out,
    first.index,
    "forge-ui-platform-container-query",
    "a viewport `@media` query sizes a component against the page — measure the container with `@container`",
  );
}

const GRID_TRACKS = /(?<![\w-])grid-template-(?:columns|rows)\s*:\s*([^;}]+)/;

function findRestatedTracks(out: Emitter): void {
  const blocks = findCssBlocks(out.scanned).flatMap((block) => {
    const tracks = GRID_TRACKS.exec(block.body);
    return tracks === null ? [] : [{ prelude: block.prelude, value: (tracks[1] ?? "").trim(), index: block.start + tracks.index }];
  });

  for (const block of blocks) {
    if (block.value.includes("subgrid")) continue;
    const parent = blocks.find((other) => other !== block && other.value === block.value && block.prelude.startsWith(`${other.prelude} `));
    if (parent === undefined) continue;
    emit(
      out,
      block.index,
      "forge-ui-platform-subgrid",
      `\`${block.value}\` restates the tracks \`${parent.prelude}\` declares — inherit them with \`subgrid\``,
    );
  }
}

const LIST_THRESHOLD = 4;

function findLongSelectorLists(out: Emitter): void {
  for (const block of findCssBlocks(out.scanned)) {
    if (block.prelude.startsWith("@") || /:is\(|:where\(/.test(block.prelude)) continue;
    const selectors = block.prelude.split(",").filter((part) => part.trim() !== "");
    if (selectors.length < LIST_THRESHOLD) continue;
    emit(
      out,
      out.scanned.indexOf(block.prelude.split(",")[0]?.trim() ?? "", 0),
      "forge-ui-platform-selector-list",
      `${selectors.length} selectors in one list — group them with \`:is()\` or \`:where()\``,
    );
  }
}

const FAMILY_THRESHOLD = 5;

const CLASS_FAMILY = /^\.([a-z0-9]+-[a-z0-9]+)-[a-z0-9-]+/;

function findScopeFamilies(out: Emitter): void {
  if (/@scope/.test(out.scanned)) return;
  const families = new Map<string, number>();
  const first = new Map<string, number>();

  for (const block of findCssBlocks(out.scanned)) {
    const family = CLASS_FAMILY.exec(block.prelude)?.[1];
    if (family === undefined) continue;
    families.set(family, (families.get(family) ?? 0) + 1);
    if (!first.has(family)) first.set(family, block.start);
  }

  for (const [family, count] of families) {
    if (count < FAMILY_THRESHOLD) continue;
    emit(out, first.get(family) ?? 0, "forge-ui-platform-scope", `${count} selectors prefixed \`.${family}-\` — bound the family with \`@scope\``);
  }
}

const HEIGHT_TRANSITION = /transition[^;}]*(?:height|all)/;

const FIXED_MAX_HEIGHT = /(?<![\w-])max-height\s*:\s*(\d+(?:\.\d+)?(?:px|rem))/;

function findFixedHeightTransitions(out: Emitter): void {
  if (/interpolate-size/.test(out.scanned)) return;
  for (const block of findCssBlocks(out.scanned)) {
    if (!HEIGHT_TRANSITION.test(block.body)) continue;
    const capped = FIXED_MAX_HEIGHT.exec(block.body);
    if (capped === null) continue;
    emit(
      out,
      block.start + capped.index,
      "forge-ui-platform-interpolate-size",
      `\`max-height: ${capped[1]}\` stands in for an \`auto\` height transition — allow the keyword with \`interpolate-size\``,
    );
  }
}

const DERIVED_SUFFIX = /^(--[a-z0-9-]+)-(hover|active|light|dark|muted|subtle|soft|strong|emphasis|hint)$/;

const COLOR_VALUE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;

// A `color-mix()` with an alpha composites against whatever sits behind it, which is why the 50%
// focus ring was removed (`src/ui/design/reference/09-interaction.md`); ring and border tokens
// carry a WCAG 1.4.11 3:1 floor of their own and are excluded here for the same reason.
const CONTRAST_BEARING = /(?:^|-)(?:ring|border|outline)(?:-|$)/;

function findManualTintPairs(out: Emitter): void {
  const declared = new Map<string, { index: number; value: string }>();
  for (const match of out.scanned.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    const name = match[1] ?? "";
    if (!declared.has(name)) declared.set(name, { index: match.index, value: (match[2] ?? "").trim() });
  }

  for (const [name, declaration] of declared) {
    const derived = DERIVED_SUFFIX.exec(name);
    if (derived === null) continue;
    const base = derived[1] ?? "";
    if (CONTRAST_BEARING.test(base.slice(2)) || CONTRAST_BEARING.test(name.slice(2))) continue;
    const source = declared.get(base);
    if (source === undefined) continue;
    if (!COLOR_VALUE.test(declaration.value) || !COLOR_VALUE.test(source.value)) continue;
    emit(out, declaration.index, "forge-ui-platform-color-mix", `\`${name}\` restates \`${base}\` as a literal — derive it with \`color-mix()\``);
  }
}

function findStyleViolations(source: string, file: string): ModernCssFinding[] {
  const out = emitter(source, file);
  findMissingLayer(out);
  findViewportMediaQueries(out);
  findRestatedTracks(out);
  findLongSelectorLists(out);
  findScopeFamilies(out);
  findFixedHeightTransitions(out);
  findManualTintPairs(out);
  return out.findings;
}

function findPreprocessorNesting(file: string): ModernCssFinding[] {
  const extension = /\.(scss|sass)$/.exec(file)?.[1];
  if (extension === undefined) return [];
  return [
    {
      file,
      line: 1,
      ruleId: "forge-ui-platform-nesting",
      detail: `\`.${extension}\` compiles a nesting the browser now parses — author plain CSS with native nesting`,
    },
  ];
}

/** Every Tier B and Tier C rule over one file, in line order, then by rule id. @public */
export function findModernCssSourceViolations(source: string, file: string): ModernCssFinding[] {
  const found = /\.(?:scss|sass)$/.test(file)
    ? findPreprocessorNesting(file)
    : file.endsWith(".css")
      ? findStyleViolations(source, file)
      : findSourceViolations(source, file);
  return found.sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}
