import { blankComments } from "./modern-css-parse";

/** A rule the design corpus states and this tooling enforces. */
export type RuleId =
  | "forge-ui-color-token-only"
  | "forge-ui-color-theme-no-raw-utility"
  | "forge-ui-no-inline-style"
  | "forge-ui-spacing-scale-only"
  | "forge-ui-viewport-units"
  | "forge-ui-no-nested-card"
  | "forge-ui-interaction-focus-visible"
  | "forge-ui-catalog-wrong-raw-input"
  | "forge-ui-contrast-floor"
  | "forge-ui-a11y-label-association"
  | "forge-ui-a11y-live-politeness"
  | "forge-ui-a11y-no-aria-readonly-on-button"
  | "forge-ui-a11y-one-live-region"
  | "forge-ui-a11y-aria-beside-data"
  | "forge-ui-a11y-heading-size-by-class"
  | "forge-ui-reduced-motion"
  | "forge-ui-focus-ring";

/** The corpus file that justifies each rule this tooling enforces. */
export const RULE_CORPUS_PATH: Readonly<Record<RuleId, string>> = {
  "forge-ui-color-token-only": "src/ui/design/floor.md",
  "forge-ui-color-theme-no-raw-utility": "src/ui/design/reference/04-color.md",
  "forge-ui-no-inline-style": "src/ui/design/floor.md",
  "forge-ui-spacing-scale-only": "src/ui/design/floor.md",
  "forge-ui-viewport-units": "src/ui/design/floor.md",
  "forge-ui-no-nested-card": "src/ui/design/floor.md",
  "forge-ui-interaction-focus-visible": "src/ui/design/reference/09-interaction.md",
  "forge-ui-catalog-wrong-raw-input": "src/ui/design/catalog.md",
  "forge-ui-contrast-floor": "src/ui/design/floor.md",
  "forge-ui-a11y-label-association": "src/ui/design/floor.md",
  "forge-ui-a11y-live-politeness": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-no-aria-readonly-on-button": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-one-live-region": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-aria-beside-data": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-heading-size-by-class": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-reduced-motion": "src/ui/design/floor.md",
  "forge-ui-focus-ring": "src/ui/design/floor.md",
};

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

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;

const COLOR_LITERAL_GLOBAL = new RegExp(COLOR_LITERAL.source, "g");

const CLASS_POSITION = /\bclass(?:Name)?\s*[=:]|\bcn\(|\basClass\(/;

function quotedStrings(line: string): string[] {
  const out: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/** One class-shaped string literal and the line it starts on. */
export interface ClassLiteral {
  /** 1-indexed line the literal's opening quote sits on. */
  line: number;
  /** The literal's contents, quotes stripped. */
  text: string;
}

const CLASS_POSITION_GLOBAL = /\bclass(?:Name)?\s*[=:]\s*|\bcn\(|\basClass\(|\bcva\(/g;

const QUOTED = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;

const ANCHORED_QUOTED = /^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/;

function closingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return i;
  }
  return source.length - 1;
}

/** Every string literal in a class position: a `class`/`className` attribute or an argument to `cn`/`asClass`/`cva`. */
export function findClassLiterals(source: string): ClassLiteral[] {
  const scanned = blankComments(source);
  const lineOf = (index: number): number => scanned.slice(0, index).split("\n").length;
  const found: ClassLiteral[] = [];

  for (const match of scanned.matchAll(CLASS_POSITION_GLOBAL)) {
    const after = match.index + match[0].length;
    if (match[0].endsWith("(")) {
      // A call takes everything up to its own closing paren, which is what reaches a wrapped
      // argument list and a `cva` variant map.
      const span = scanned.slice(after, closingParen(scanned, after - 1));
      let end = -1;
      for (const quoted of span.matchAll(QUOTED)) {
        const text = quoted[1] ?? quoted[2] ?? quoted[3] ?? "";
        const previous = found.at(-1);
        // `"a " + "b"` is one class string wrapped for line length, so the pair is judged joined:
        // a conflict spanning the `+` is as dead as one inside a single literal.
        if (previous !== undefined && end !== -1 && /^\s*\+\s*$/.test(span.slice(end, quoted.index))) {
          found[found.length - 1] = { line: previous.line, text: previous.text + text };
        } else {
          found.push({ line: lineOf(after + quoted.index), text });
        }
        end = quoted.index + quoted[0].length;
      }
      continue;
    }
    // An attribute takes only the literal assigned to it; `class={cn(…)}` is reached by the `cn(`
    // match instead.
    const quoted = ANCHORED_QUOTED.exec(scanned.slice(after));
    if (quoted !== null) found.push({ line: lineOf(after), text: quoted[1] ?? quoted[2] ?? quoted[3] ?? "" });
  }
  return found;
}

/** A `/* design-allow: <rule> — <reason> *​/` comment on `line` or the one above it. The reason is
 *  mandatory — a bare marker with no text after the em dash does not suppress. */
export function isSuppressed(lines: readonly string[], line: number, ruleId: RuleId): boolean {
  // `\S` alone is satisfied by the `*` of the closing `*/`, which would let a reasonless marker
  // suppress; the lookahead excludes it so the mandatory reason cannot be bypassed.
  const marker = new RegExp(`/\\*\\s*design-allow:\\s*${ruleId}\\s+—\\s+(?!\\*/)\\S`);
  return [lines[line - 1], lines[line - 2]].some((candidate) => candidate !== undefined && marker.test(candidate));
}

/** Colour literals inside a class string. */
export function findColorLiterals(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(lines, i + 1, "forge-ui-color-token-only")) continue;

    const hits = new Set<string>();
    for (const match of line.matchAll(/[a-z][a-z0-9-]*-\[([^\]]*)\]/g)) {
      const value = match[1] ?? "";
      const literal = value.match(COLOR_LITERAL);
      if (literal) hits.add(literal[0]);
    }
    if (CLASS_POSITION.test(line)) {
      for (const text of quotedStrings(line)) {
        for (const match of text.matchAll(COLOR_LITERAL_GLOBAL)) hits.add(match[0]);
      }
    }

    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-color-token-only",
        detail: `raw colour literal \`${hit}\` in a class string — resolve the colour through a semantic token`,
      });
    }
  }
  return findings;
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

const SCALE_UTILITIES = [
  "text",
  "p",
  "px",
  "py",
  "pt",
  "pr",
  "pb",
  "pl",
  "ps",
  "pe",
  "m",
  "mx",
  "my",
  "mt",
  "mr",
  "mb",
  "ml",
  "ms",
  "me",
  "gap",
  "gap-x",
  "gap-y",
  "size",
  "w",
  "h",
  "min-w",
  "min-h",
  "max-w",
  "max-h",
  "bg",
];

const ARBITRARY_VALUE = new RegExp(`(?<![\\w-])(${SCALE_UTILITIES.join("|")})-\\[([^\\]]+)\\]`, "g");

const SCALE_COMPARABLE = /^\d+(?:\.\d+)?(?:px|rem)$/;

/** Arbitrary Tailwind values on scale-bearing utilities. */
export function findArbitraryValues(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(lines, i + 1, "forge-ui-spacing-scale-only")) continue;

    const hits = new Set<string>();
    for (const match of line.matchAll(ARBITRARY_VALUE)) {
      const utility = match[1] ?? "";
      const value = match[2] ?? "";
      if (!SCALE_COMPARABLE.test(value) && !COLOR_LITERAL.test(value)) continue;
      hits.add(`${utility}-[${value}]`);
    }

    for (const hit of hits) {
      findings.push({ file, line: i + 1, ruleId: "forge-ui-spacing-scale-only", detail: `arbitrary value \`${hit}\` where a scale value exists` });
    }
  }
  return findings;
}

/** `h-screen` / `w-screen`, which `100vh` makes wrong on mobile — `min-h-dvh` is the replacement. */
export function findViewportUnits(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSuppressed(lines, i + 1, "forge-ui-viewport-units")) continue;

    const hits = new Set<string>();
    for (const match of line.matchAll(/(?<![\w-])[hw]-screen(?![\w-])/g)) hits.add(match[0]);

    for (const hit of hits) {
      findings.push({
        file,
        line: i + 1,
        ruleId: "forge-ui-viewport-units",
        detail: `\`${hit}\` measures the layout viewport — use \`min-h-dvh\``,
      });
    }
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

const HEADING_CLASS = /(?<![\w-])class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)')/;

const TEXT_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/;

/** An `<h1>`–`<h6>` whose size comes from the tag, which is what turns a size choice into a skip. */
export function findTagSizedHeadings(source: string, file: string): DesignFinding[] {
  const scanned = blankComments(source);
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (const open of scanned.matchAll(/<h([1-6])(?=[\s/>])/g)) {
    const openingTag = scanned.slice(open.index, endOfOpeningTag(scanned, open.index));
    // Only a quoted class is judgeable; an expression-valued one resolves at render time.
    const written = HEADING_CLASS.exec(openingTag);
    if (written === null) continue;
    if (TEXT_SIZE.test(written[1] ?? written[2] ?? "")) continue;

    const line = source.slice(0, open.index).split("\n").length;
    if (isSuppressed(lines, line, "forge-ui-a11y-heading-size-by-class")) continue;

    findings.push({
      file,
      line,
      ruleId: "forge-ui-a11y-heading-size-by-class",
      detail: `\`<h${open[1]}>\` takes its size from the tag — set the size with a \`text-*\` class and the level from the section's position`,
    });
  }
  return findings;
}

/** An `animate-*` utility with no `motion-safe:` or `motion-reduce:` in its variant chain. */
export function findUnguardedAnimations(source: string, file: string): DesignFinding[] {
  const lines = source.split("\n");
  const findings: DesignFinding[] = [];

  for (const literal of findClassLiterals(source)) {
    if (isSuppressed(lines, literal.line, "forge-ui-reduced-motion")) continue;

    const hits = new Set<string>();
    for (const token of literal.text.split(/\s+/)) {
      const cut = token.lastIndexOf(":");
      if (!token.slice(cut + 1).startsWith("animate-")) continue;
      const variants = token.slice(0, cut + 1).split(":");
      if (variants.includes("motion-safe") || variants.includes("motion-reduce")) continue;
      hits.add(token);
    }

    for (const hit of hits) {
      findings.push({
        file,
        line: literal.line,
        ruleId: "forge-ui-reduced-motion",
        detail: `\`${hit}\` runs whatever the reader has asked for — author it inside \`motion-safe:\` and give \`motion-reduce:\` the settled state`,
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
  const scanned = blankComments(source);
  const lineOf = (index: number): number => scanned.slice(0, index).split("\n").length;
  const found: ClassExpression[] = [];

  for (const match of scanned.matchAll(CLASS_POSITION_GLOBAL)) {
    const after = match.index + match[0].length;
    if (match[0].endsWith("(")) {
      const span = scanned.slice(after, closingParen(scanned, after - 1));
      const parts: string[] = [];
      let line = -1;
      for (const quoted of span.matchAll(QUOTED)) {
        if (line === -1) line = lineOf(after + quoted.index);
        parts.push(quoted[1] ?? quoted[2] ?? quoted[3] ?? "");
      }
      if (line !== -1) found.push({ line, text: parts.join(" ") });
      continue;
    }
    const quoted = ANCHORED_QUOTED.exec(scanned.slice(after));
    if (quoted !== null) found.push({ line: lineOf(after), text: quoted[1] ?? quoted[2] ?? quoted[3] ?? "" });
  }
  return found;
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

/** Every source check over one `.tsx` file, in rule order, then by line. */
export function findSourceViolations(source: string, file: string): DesignFinding[] {
  return [
    ...findColorLiterals(source, file),
    ...findRawThemeUtilities(source, file),
    ...findInlineStyles(source, file),
    ...findArbitraryValues(source, file),
    ...findViewportUnits(source, file),
    ...findNestedCards(source, file),
    ...findBareFocus(source, file),
    ...findRawControls(source, file),
    ...findUnassociatedLabels(source, file),
    ...findLivePoliteness(source, file),
    ...findAriaReadonlyButtons(source, file),
    ...findExtraLiveRegions(source, file),
    ...findHandWrittenStateAttrs(source, file),
    ...findTagSizedHeadings(source, file),
    ...findUnguardedAnimations(source, file),
    ...findRemovedFocusRings(source, file),
  ].sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}
