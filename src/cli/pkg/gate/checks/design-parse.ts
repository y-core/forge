import { RULE_CORPUS_PATH, type RuleId } from "./design-rules";
import { blankComments } from "./modern-css-parse";
import { balancedSpan, blankSourceComments } from "./source-scan";

/** One violated rule at one place, with enough in it to print the whole failure line. */
export interface DesignFinding {
  /** Repo-relative path of the file the violation sits in. */
  file: string;
  /** 1-indexed line. */
  line: number;
  ruleId: RuleId;
  detail: string;
}

/** Renders a finding as the `<file>:<line>: <rule> — <detail> (<corpus path>)` body of a `FAIL` line. */
export function formatDesignFinding(finding: DesignFinding): string {
  return `${finding.file}:${finding.line}: ${finding.ruleId} — ${finding.detail} (${RULE_CORPUS_PATH[finding.ruleId]})`;
}

/** A `<!-- rule:… -->` marker: the id as written, and where it was written. */
export interface RuleMarker {
  /** 1-indexed line the marker sits on. */
  line: number;
  /** The id exactly as written, including a malformed one. */
  id: string;
}

const RULE_ID_GRAMMAR = /^forge-ui-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `id` satisfies the rule-id grammar. */
export function isValidRuleId(id: string): boolean {
  return RULE_ID_GRAMMAR.test(id);
}

/** Every `<!-- rule:… -->` marker in a corpus document. */
export function findRuleMarkers(source: string): RuleMarker[] {
  const found: RuleMarker[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const match of line.matchAll(/<!--\s*rule:\s*([^\s>]*?)\s*-->/g)) {
      found.push({ line: i + 1, id: match[1] ?? "" });
    }
  }
  return found;
}

/** Every rule id cited in prose — a backticked bare id. */
export function findRuleCitations(source: string): RuleMarker[] {
  const found: RuleMarker[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const match of line.matchAll(/`(forge-ui-[A-Za-z0-9-]+)`/g)) {
      found.push({ line: i + 1, id: match[1] ?? "" });
    }
  }
  return found;
}

/** An `import { … } from "@y-core/forge/<subpath>"` the corpus writes. */
export interface BarrelImport {
  /** 1-indexed line the `import` keyword sits on. */
  line: number;
  /** The exports-map key form of the barrel — e.g. `./ui/core`. */
  subpath: string;
  /** The names the statement asks the barrel for, `type` markers stripped and `as` aliases resolved
   *  back to the exported name. */
  symbols: string[];
}

/** Every named-import statement in `source` that pulls from `packageName`. */
export function findBarrelImports(source: string, packageName: string): BarrelImport[] {
  const re = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["'](${packageName.replace("/", "\\/")}\\/[^"']+)["']`, "gs");
  const found: BarrelImport[] = [];

  for (const match of source.matchAll(re)) {
    const body = match[1];
    const specifier = match[2];
    if (body === undefined || specifier === undefined) continue;

    const symbols = body
      .split(",")
      .map((part) => {
        let trimmed = part.trim();
        if (trimmed.startsWith("type ")) trimmed = trimmed.slice(5).trim();
        const asIdx = trimmed.indexOf(" as ");
        return asIdx >= 0 ? trimmed.slice(0, asIdx).trim() : trimmed;
      })
      .filter((name) => name.length > 0);
    if (symbols.length === 0) continue;

    found.push({ line: source.slice(0, match.index).split("\n").length, subpath: `.${specifier.slice(packageName.length)}`, symbols });
  }
  return found;
}

/** A `--foo` custom property the corpus names, and where. */
export interface CustomPropertyCitation {
  /** 1-indexed line the token sits on. */
  line: number;
  /** The property including its leading `--`. For a family, the prefix without the trailing `-*`. */
  property: string;
  /** True when the corpus named a *family* (`--palette-*`) rather than one property. */
  family: boolean;
}

/** Every well-formed `--foo` token in a corpus document, plus every `--foo-*` family citation. */
export function findCustomPropertyCitations(source: string): CustomPropertyCitation[] {
  const found: CustomPropertyCitation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const remainder = line.replace(/(?<![\w-])(--[a-z0-9]+(?:-[a-z0-9]+)*)-\*/g, (match, prefix: string) => {
      found.push({ line: i + 1, property: prefix, family: true });
      return " ".repeat(match.length);
    });
    for (const match of remainder.matchAll(/(?<![\w-])--[a-z0-9]+(?:-[a-z0-9]+)*(?![\w])/g)) {
      found.push({ line: i + 1, property: match[0], family: false });
    }
  }
  return found;
}

/** Every custom property declared by a stylesheet — the left side of a `--foo: …` declaration. */
export function parseDeclaredCustomProperties(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

/** One class-shaped string literal and the line it starts on. */
export interface ClassLiteral {
  /** 1-indexed line the literal's opening quote sits on. */
  line: number;
  /** The literal's contents, quotes stripped. */
  text: string;
}

const CLASS_POSITION_GLOBAL = /\bclass(?:Name)?\s*[=:]\s*|\bcn\(|\basClass\(|\bcva\(/g;

const ANCHORED_QUOTED = /^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/;

/** Every literal one class position contributes, and the source ranges reading it consumed. */
interface ClassGroup {
  literals: ClassLiteral[];
  /** Half-open ranges an enclosing span already read, with each `${…}` interior left out of them. */
  consumed: [number, number][];
  /** Positions the span was abandoned at because a literal inside it never closes. */
  skipped: SkippedClassPosition[];
}

/** Reads every string and template literal in `[start, end)` as class text, one literal per quoted
 *  string and one per interpolation-delimited template chunk — the unit the formatter sorts. */
function harvestSpan(scanned: string, start: number, end: number, lineOf: (index: number) => number): ClassGroup {
  const literals: ClassLiteral[] = [];
  const consumed: [number, number][] = [];
  const skipped: SkippedClassPosition[] = [];
  let cursor = start;
  let mergeable = false;
  let lastEnd = -1;

  const emit = (from: number, to: number): void => {
    const text = scanned.slice(from, to);
    if (text.trim() === "") {
      mergeable = false;
      lastEnd = to;
      return;
    }
    const previous = literals.at(-1);
    // `"a " + "b"` is one class string wrapped for line length, so the pair is judged joined:
    // a conflict spanning the `+` is as dead as one inside a single literal.
    if (previous !== undefined && mergeable && /^\s*\+\s*$/.test(scanned.slice(lastEnd + 1, from - 1))) {
      literals[literals.length - 1] = { line: previous.line, text: previous.text + text };
    } else {
      literals.push({ line: lineOf(from), text });
    }
    mergeable = true;
    lastEnd = to;
  };

  const abandon = (at: number): void => {
    const lineEnd = scanned.indexOf("\n", at);
    skipped.push({ line: lineOf(at), text: scanned.slice(at, lineEnd === -1 || lineEnd > end ? end : lineEnd) });
  };

  for (let i = start; i < end; i++) {
    const char = scanned[i];
    if (char !== "'" && char !== '"' && char !== "`") continue;

    if (char !== "`") {
      let close = i + 1;
      for (; close < end; close++) {
        if (scanned[close] === "\\") close++;
        else if (scanned[close] === char) break;
      }
      if (close >= end) {
        abandon(i);
        break;
      }
      emit(i + 1, close);
      i = close;
      continue;
    }

    let chunk = i + 1;
    let j = chunk;
    for (; j < end; j++) {
      if (scanned[j] === "\\") {
        j++;
        continue;
      }
      if (scanned[j] === "`") break;
      if (scanned[j] !== "$" || scanned[j + 1] !== "{") continue;
      const close = balancedSpan(scanned, j + 1);
      if (close === -1) break;
      emit(chunk, j);
      consumed.push([cursor, j + 2]);
      cursor = close;
      j = close;
      chunk = close + 1;
    }
    if (j >= end) {
      abandon(i);
      break;
    }
    emit(chunk, j);
    i = j;
  }

  consumed.push([cursor, end]);
  return { literals, consumed, skipped };
}

/** A class position the scan dropped because its span never closes. */
export interface SkippedClassPosition {
  /** 1-indexed line the position starts on. */
  line: number;
  /** The position as written: up to its opening bracket, or the line the unclosed literal opens on. */
  text: string;
}

/** Every class position in `source`, split into the ones read and the ones dropped unread. */
interface ClassScan {
  groups: ClassGroup[];
  skipped: SkippedClassPosition[];
}

/** Every class position in `source` with the literals it contributes, `//`-commented ones excluded. */
function scanClassGroups(source: string): ClassScan {
  const scanned = blankSourceComments(source);
  const lineOf = (index: number): number => scanned.slice(0, index).split("\n").length;
  const groups: ClassGroup[] = [];
  const skipped: SkippedClassPosition[] = [];
  const consumed: [number, number][] = [];

  for (const match of scanned.matchAll(CLASS_POSITION_GLOBAL)) {
    if (consumed.some(([from, to]) => match.index >= from && match.index < to)) continue;
    const after = match.index + match[0].length;

    // A call takes everything up to its own closing paren, which is what reaches a wrapped argument
    // list and a `cva` variant map; an expression container takes its balanced brace. An unbalanced
    // span is skipped rather than guessed at — a phantom literal is worse than a missed one.
    const open = match[0].endsWith("(") ? after - 1 : scanned[after] === "{" ? after : -1;
    if (open !== -1) {
      const close = balancedSpan(scanned, open);
      if (close === -1) {
        skipped.push({ line: lineOf(match.index), text: scanned.slice(match.index, open + 1) });
        continue;
      }
      const group = harvestSpan(scanned, open + 1, close, lineOf);
      consumed.push(...group.consumed);
      skipped.push(...group.skipped);
      groups.push(group);
      continue;
    }

    const quoted = ANCHORED_QUOTED.exec(scanned.slice(after));
    if (quoted !== null)
      groups.push({ literals: [{ line: lineOf(after), text: quoted[1] ?? quoted[2] ?? quoted[3] ?? "" }], consumed: [], skipped: [] });
  }
  return { groups, skipped };
}

/** Every string literal in a class position: a `class`/`className` attribute — quoted or in an
 *  expression container — or an argument to `cn`/`asClass`/`cva`. */
export function findClassLiterals(source: string): ClassLiteral[] {
  return scanClassGroups(source).groups.flatMap((group) => group.literals);
}

/** Every class position dropped unread, so a span the scan cannot close is reportable rather than silent. */
export function findSkippedClassPositions(source: string): SkippedClassPosition[] {
  return scanClassGroups(source).skipped;
}

/** A `/* design-allow: <rule> — <reason> *​/` comment on `line` or the one above it. The reason is
 *  mandatory — a bare marker with no text after the em dash does not suppress. */
export function isSuppressed(lines: readonly string[], line: number, ruleId: RuleId): boolean {
  // `\S` alone is satisfied by the `*` of the closing `*/`, which would let a reasonless marker
  // suppress; the lookahead excludes it so the mandatory reason cannot be bypassed.
  const marker = new RegExp(`/\\*\\s*design-allow:\\s*${ruleId}\\s+—\\s+(?!\\*/)\\S`);
  return [lines[line - 1], lines[line - 2]].some((candidate) => candidate !== undefined && marker.test(candidate));
}

const PALETTE_HUES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
];

const COLOR_UTILITIES = [
  "bg",
  "text",
  "border",
  "ring",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "divide",
  "outline",
  "decoration",
  "accent",
  "caret",
  "placeholder",
  "shadow",
];

const PALETTE_UTILITY = new RegExp(
  `(?<![\\w-])((?:[a-z][a-z0-9-]*:)*)(${COLOR_UTILITIES.join("|")})-(${PALETTE_HUES.join("|")})-(?:50|[1-9]00|950)(?![\\w-])`,
  "g",
);

/** A raw Tailwind palette utility with no `dark:` counterpart beside it. */
export function findRawThemeUtilities(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(lines, i + 1, "forge-ui-color-theme-no-raw-utility")) continue;

    const paired = new Set<string>();
    const bare = new Map<string, string>();

    for (const match of line.matchAll(PALETTE_UTILITY)) {
      const variants = match[1] ?? "";
      const family = `${match[2]}-${match[3]}`;
      if (variants.split(":").includes("dark")) paired.add(family);
      else if (!bare.has(family)) bare.set(family, match[0]);
    }

    for (const [family, written] of bare) {
      if (paired.has(family)) continue;
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-color-theme-no-raw-utility",
        detail: `\`${written}\` has no \`dark:${family}-*\` counterpart beside it — a raw palette utility survives the theme switch`,
      });
    }
  }
  return findings;
}

/** Inline `style=` attributes, which the SSR renderer drops. */
export function findInlineStyles(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(lines, i + 1, "forge-ui-no-inline-style")) continue;
    if (!/(?<![\w-])style\s*=/.test(line)) continue;
    findings.push({
      file,
      line: i + 1,
      ruleId: "forge-ui-no-inline-style",
      detail: "`style=` attribute — the renderer drops it; express the rule as a class",
    });
  }
  return findings;
}

/** A `<Card>` opened inside a `<Card.Content>` — a nesting the surface has no way to express. */
export function findNestedCards(source: string, file: string): DesignFinding[] {
  const findings: DesignFinding[] = [];
  const openTag = /<Card\.Content(?=[\s/>])/g;

  for (const open of source.matchAll(openTag)) {
    const bodyStart = open.index + open[0].length;
    const closeIdx = source.indexOf("</Card.Content>", bodyStart);
    const body = closeIdx === -1 ? source.slice(bodyStart) : source.slice(bodyStart, closeIdx);

    const nested = body.match(/<Card(?=[\s/>])/);
    if (!nested) continue;

    const line = source.slice(0, bodyStart + (nested.index ?? 0)).split("\n").length;
    const lines = source.split("\n");
    if (isSuppressed(lines, line, "forge-ui-no-nested-card")) continue;

    findings.push({
      file,
      line,
      ruleId: "forge-ui-no-nested-card",
      detail: "`<Card>` nested inside `<Card.Content>` — the borders compound rather than nest",
    });
  }
  return findings;
}

/** A bare `focus:` variant, which fires on a pointer press too. */
export function findBareFocus(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(lines, i + 1, "forge-ui-interaction-focus-visible")) continue;

    const hits = new Set<string>();
    for (const match of line.matchAll(/(?<![\w-])focus:(?=[a-z[])[a-z0-9#%[\]/.-]+/g)) hits.add(match[0]);

    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-interaction-focus-visible",
        detail: `\`${hit}\` styles every focus including pointer focus — use \`focus-visible:\``,
      });
    }
  }
  return findings;
}

/** A raw `<select>`, `<input>`, `<textarea>` or `<button>` written by the showcase. */
export function findRawControls(source: string, file: string): DesignFinding[] {
  if (!file.startsWith("src/ui/show/")) return [];

  const lines = source.split("\n");
  const findings: DesignFinding[] = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(/<(select|input|textarea|button)(?=[\s/>])/g)) {
    const tag = match[1] ?? "";
    const line = source.slice(0, match.index).split("\n").length;
    if (seen.has(`${line}:${tag}`)) continue;
    seen.add(`${line}:${tag}`);
    if (isSuppressed(lines, line, "forge-ui-catalog-wrong-raw-input")) continue;

    findings.push({
      file,
      line,
      ruleId: "forge-ui-catalog-wrong-raw-input",
      detail: `raw \`<${tag}>\` in the showcase — render the \`ui/core\` component the corpus points at`,
    });
  }
  return findings;
}

const LABEL_CONTROLS = /<(?:input|select|textarea|button|meter|progress|Input|Select|Textarea|Switch|Slider|NumberField|Toggle)(?=[\s/>])/;

/** The index just past the `>` closing the tag opened at `start`, ignoring `>` inside braces or quotes. */
function endOfOpeningTag(source: string, start: number): number {
  let depth = 0;
  let quote = "";

  for (let i = start; i < source.length; i++) {
    const char = source[i] ?? "";
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return i + 1;
  }
  return source.length;
}

/** A `<label>` that neither carries `for` nor wraps its control — styled text that focuses nothing. */
export function findUnassociatedLabels(source: string, file: string): DesignFinding[] {
  const scanned = blankComments(source);
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (const open of scanned.matchAll(/<label(?=[\s/>])/g)) {
    const tagEnd = endOfOpeningTag(scanned, open.index);
    const openingTag = scanned.slice(open.index, tagEnd);
    if (/(?<![\w-])for[=\s]/.test(openingTag)) continue;

    // A self-closing label has no children, so wrapping cannot be what associates it.
    const selfClosing = openingTag.trimEnd().endsWith("/>");
    const closeIdx = scanned.indexOf("</label>", tagEnd);
    const body = selfClosing ? "" : closeIdx === -1 ? scanned.slice(tagEnd) : scanned.slice(tagEnd, closeIdx);
    if (LABEL_CONTROLS.test(body)) continue;

    const line = source.slice(0, open.index).split("\n").length;
    if (isSuppressed(lines, line, "forge-ui-a11y-label-association")) continue;

    findings.push({
      file,
      line,
      ruleId: "forge-ui-a11y-label-association",
      detail: "`<label>` with neither a `for` nor a wrapped control — it labels nothing",
    });
  }
  return findings;
}

/** An `aria-live` that is not `polite`, or an `assertive` that has not stated why it interrupts. */
export function findLivePoliteness(source: string, file: string): DesignFinding[] {
  const lines = blankComments(source).split("\n");
  const raw = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(raw, i + 1, "forge-ui-a11y-live-politeness")) continue;

    const hits = new Set<string>();
    // Only quoted literals are judgeable; a `{expr}` value is resolved at render time.
    for (const match of line.matchAll(/aria-live=(['"])([^'"]*)\1/g)) {
      const value = match[2] ?? "";
      if (value !== "polite") hits.add(value);
    }

    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-a11y-live-politeness",
        detail:
          hit === "assertive"
            ? '`aria-live="assertive"` interrupts the reader — state why in a `design-allow`, or use `polite`'
            : `\`aria-live="${hit}"\` is neither \`polite\` nor \`assertive\``,
      });
    }
  }
  return findings;
}

const ROLE_BUTTON = /(?<![\w-])role=(['"])button\1/;

const ARIA_READONLY = /(?<![\w-])aria-readonly(?![\w-])/;

/** `aria-readonly` on a `<button>` or a `role="button"` element, which supports no such state. */
export function findAriaReadonlyButtons(source: string, file: string): DesignFinding[] {
  const scanned = blankComments(source);
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (const open of scanned.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    const tag = open[1] ?? "";
    const openingTag = scanned.slice(open.index, endOfOpeningTag(scanned, open.index));
    if (tag !== "button" && tag !== "Button" && !ROLE_BUTTON.test(openingTag)) continue;
    if (!ARIA_READONLY.test(openingTag)) continue;

    const line = source.slice(0, open.index).split("\n").length;
    if (isSuppressed(lines, line, "forge-ui-a11y-no-aria-readonly-on-button")) continue;

    findings.push({
      file,
      line,
      ruleId: "forge-ui-a11y-no-aria-readonly-on-button",
      detail: `\`aria-readonly\` on \`<${tag}>\` — the button role does not support it; carry the state on the control the button acts on`,
    });
  }
  return findings;
}

/** A live region opened outside `Toast.Container`, which is already the page's one announcer. */
export function findExtraLiveRegions(source: string, file: string): DesignFinding[] {
  // `toast.tsx` is where the one region lives, so it cannot be a second one.
  if (file === "src/ui/core/toast.tsx") return [];

  const lines = blankComments(source).split("\n");
  const raw = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(raw, i + 1, "forge-ui-a11y-one-live-region")) continue;

    const hits = new Set<string>();
    for (const match of line.matchAll(/aria-live=(['"])([^'"]*)\1/g)) {
      const value = match[2] ?? "";
      if (value !== "off") hits.add(value);
    }

    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-a11y-one-live-region",
        detail: `\`aria-live="${hit}"\` opens a second live region — route the announcement into \`Toast.Container\` or \`FlashContainer\``,
      });
    }
  }
  return findings;
}

const STATE_ATTR = /(?<![\w-])data-(pressed|checked|selected|disabled|invalid)(?![\w:\]-])/g;

/** A `data-*` state attribute written by hand rather than emitted through `stateAttrs`. */
export function findHandWrittenStateAttrs(source: string, file: string): DesignFinding[] {
  // A Tailwind variant always ends in `:` and an arbitrary selector in `]`, so the negative
  // lookahead in `STATE_ATTR` is what leaves a class string alone.
  const lines = blankComments(source).split("\n");
  const raw = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(raw, i + 1, "forge-ui-a11y-aria-beside-data")) continue;

    const hits = new Set<string>();
    for (const match of line.matchAll(STATE_ATTR)) hits.add(match[1] ?? "");

    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-a11y-aria-beside-data",
        detail: `hand-written \`data-${hit}\` — emit it through \`stateAttrs\`, beside its \`aria-${hit}\` counterpart`,
      });
    }
  }
  return findings;
}

/** One whole class expression: every literal a single class position contributes, joined. */
interface ClassExpression {
  /** 1-indexed line the expression's first literal sits on. */
  line: number;
  /** Every literal in the expression, joined with a space. */
  text: string;
}

/** Every class position in `source` as one string — a `cn()` call's arguments joined rather than
 *  read one at a time, since forge splits a single class list across several of them. */
function classExpressions(source: string): ClassExpression[] {
  return scanClassGroups(source).groups.flatMap((group) => {
    const first = group.literals[0];
    return first === undefined ? [] : [{ line: first.line, text: group.literals.map((literal) => literal.text).join(" ") }];
  });
}

const OUTLINE_SUPPRESSOR = /(?<![\w-])(outline-none|outline-hidden)(?![\w-])/;

const FOCUS_VISIBLE_RING = /focus-visible[^\s]*:ring/;

const POINTER_TARGET = /(?<![\w-])cursor-pointer(?![\w-])/;

/** `outline-none` on a pointer target with no `focus-visible:` ring put back in its place. */
export function findRemovedFocusRings(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (const expression of classExpressions(source)) {
    // `cursor-pointer` is what separates a focus target from a surface: `menu.tsx`'s popup panel
    // suppresses its outline and owes no ring, because nothing focuses it.
    if (!POINTER_TARGET.test(expression.text)) continue;
    const suppressor = OUTLINE_SUPPRESSOR.exec(expression.text);
    if (suppressor === null) continue;
    if (FOCUS_VISIBLE_RING.test(expression.text)) continue;
    if (isSuppressed(lines, expression.line, "forge-ui-focus-ring")) continue;

    findings.push({
      file,
      line: expression.line,
      ruleId: "forge-ui-focus-ring",
      detail: `\`${suppressor[1]}\` on a pointer target with no \`focus-visible:ring-*\` beside it — the affordance is removed, not replaced`,
    });
  }
  return findings;
}

/** The detector behind each rule this file enforces, keyed by the id it reports under. */
const SOURCE_DETECTORS: Readonly<Partial<Record<RuleId, (source: string, file: string) => DesignFinding[]>>> = {
  "forge-ui-color-theme-no-raw-utility": findRawThemeUtilities,
  "forge-ui-no-inline-style": findInlineStyles,
  "forge-ui-no-nested-card": findNestedCards,
  "forge-ui-interaction-focus-visible": findBareFocus,
  "forge-ui-catalog-wrong-raw-input": findRawControls,
  "forge-ui-a11y-label-association": findUnassociatedLabels,
  "forge-ui-a11y-live-politeness": findLivePoliteness,
  "forge-ui-a11y-no-aria-readonly-on-button": findAriaReadonlyButtons,
  "forge-ui-a11y-one-live-region": findExtraLiveRegions,
  "forge-ui-a11y-aria-beside-data": findHandWrittenStateAttrs,
  "forge-ui-focus-ring": findRemovedFocusRings,
};

// Derived, never hand-listed: this is what `checkDesign` holds a `RULE_ENFORCER: "gate"` row
// against, so deleting a detector fails `validate-design` by name rather than silently.
/** Every rule id this file's detectors report under. */
export const SOURCE_DETECTOR_IDS: readonly RuleId[] = Object.keys(SOURCE_DETECTORS) as RuleId[];

/** Every source check over one `.tsx` file, in rule order, then by line. */
export function findSourceViolations(source: string, file: string): DesignFinding[] {
  return Object.values(SOURCE_DETECTORS)
    .flatMap((detect) => detect(source, file))
    .sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}
