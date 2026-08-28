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
  | "forge-ui-contrast-floor";

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
  ].sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}
