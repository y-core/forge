/** design-parse.ts — the matchers `validate-design.ts` decides on.
 *
 *  Mirrors the `validate-docs.ts` / `docs-parse.ts` and `validate-exports.ts` / `barrel-parse.ts`
 *  split: the runner keeps the walking, the reading, the printing and the verdict; every pattern
 *  and every pure decision lives here, where it is importable and therefore assertable.
 *
 *  Strings in, data out: no disk, no `package.json`, no repo root. Each scanner takes the source
 *  text plus the label to report it under, and returns findings — never a boolean, and never a
 *  path it would have to read itself.
 */

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

/**
 * The corpus file that justifies each rule this tooling enforces — the third element of every
 * failure line, so a reader is routed to the paragraph rather than left to search for it.
 *
 * `validate-design.ts` asserts that every path here is a file in the corpus and that every id here
 * is defined by some corpus file. Both assertions matter in the same way the corpus checks do: a
 * message pointing at a page that was renamed or never written is the tooling telling its own lie.
 *
 * Each id routes to the file whose marker declares it, which is why most land on the floor and three
 * do not: the focus-variant rule is declared by the interaction reference, the raw-control rule by
 * the catalog's wrong-tool table, and the raw-palette-utility rule by the colour reference. Those
 * three are Tier-2 **Defaults**, not Floor rules, and that is not an inconsistency — membership in
 * this table tracks what is cheap to check statically, never what tier a rule occupies. A gated
 * Default stays rebuttable through `isSuppressed` below, whose
 * mandatory written reason is what "rebuttable" amounts to at a call site. The reasoning is
 * `.decisions/UI_DESIGN_GUIDANCE.md` §4a's, and is not repeated here.
 *
 * `forge-ui-contrast-floor` is enforced by `validate-contrast.ts` rather than by a scanner here: it
 * is a property of the *stylesheet's* stop mapping, not of any `.tsx` line. It is in this table
 * because the table is what routes a reader from a printed rule id to the paragraph that states it,
 * and that obligation is the same wherever the check happens to run.
 */
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
export interface Finding {
  /** Repo-relative path of the file the violation sits in. */
  file: string;
  /** 1-indexed line, so the message is clickable. */
  line: number;
  /** The rule the line violates. */
  ruleId: RuleId;
  /** What specifically is wrong, phrased to stand alone after the rule id. */
  detail: string;
}

/** Renders a finding as the `<file>:<line>: <rule> — <detail> (<corpus path>)` body of a `FAIL` line. */
export function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.line}: ${finding.ruleId} — ${finding.detail} (${RULE_CORPUS_PATH[finding.ruleId]})`;
}

// ── Rule ids ─────────────────────────────────────────────────────────────────────────────────────

/** A `<!-- rule:… -->` marker: the id as written, and where it was written. */
export interface RuleMarker {
  /** 1-indexed line the marker sits on. */
  line: number;
  /** The id exactly as written, including a malformed one — the grammar check needs to see it. */
  id: string;
}

/** The grammar every rule id must satisfy: the `forge-ui-` prefix, kebab-case, no trailing punctuation. */
const RULE_ID_GRAMMAR = /^forge-ui-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `id` satisfies the rule-id grammar. */
export function isValidRuleId(id: string): boolean {
  return RULE_ID_GRAMMAR.test(id);
}

/**
 * Every `<!-- rule:… -->` marker in a corpus document.
 *
 * The capture is deliberately loose — anything up to the closing comment — so a malformed id is
 * *reported* rather than silently unmatched. A strict capture here would make a typo invisible,
 * which is the failure mode the grammar check exists to catch.
 */
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

/**
 * Every rule id *cited* in prose — a backticked bare id, the form `preflight.md` uses for its
 * checklist rows.
 *
 * Backticks are what separate a citation from a definition: a marker is an HTML comment and never
 * appears in code span, so the two forms cannot be confused for one another.
 */
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

// ── Barrel imports ───────────────────────────────────────────────────────────────────────────────

/** An `import { … } from "@y-core/forge/<subpath>"` the corpus writes. */
export interface BarrelImport {
  /** 1-indexed line the `import` keyword sits on. */
  line: number;
  /** The exports-map key form of the barrel — e.g. `./ui/core`. */
  subpath: string;
  /** The names the statement asks the barrel for, `type` markers stripped and `as` aliases resolved
   *  back to the exported name (the left side is what the barrel must actually export). */
  symbols: string[];
}

/**
 * Every named-import statement in `source` that pulls from `packageName`.
 *
 * Fences are **not** stripped, unlike everywhere in `validate-docs`: the corpus's import statements
 * live *only* inside fenced code blocks, so stripping them would leave this check reading nothing
 * and passing vacuously. The trade-off `validate-docs` makes — a sample must not be held to the
 * rules — is inverted here on purpose, because a sample that names a symbol the barrel does not
 * export is precisely the lie this corpus must not tell.
 *
 * Matched across the whole source rather than line by line so a multi-line brace group is one
 * citation; the reported line is the statement's first.
 */
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

// ── CSS custom properties ────────────────────────────────────────────────────────────────────────

/** A `--foo` custom property the corpus names, and where. */
export interface CustomPropertyCitation {
  /** 1-indexed line the token sits on. */
  line: number;
  /** The property including its leading `--`. For a family, the prefix without the trailing `-*`. */
  property: string;
  /** True when the corpus named a *family* (`--palette-*`) rather than one property. */
  family: boolean;
}

/**
 * Every well-formed `--foo` token in a corpus document, plus every `--foo-*` family citation.
 *
 * "Well-formed" is what keeps the range notation the corpus legitimately writes from failing:
 * `--palette-50…950` yields the citation `--palette-50` and stops at the ellipsis, which is a real
 * property, rather than a `--palette-50…950` that could never be declared anywhere. The lookbehind
 * stops a match starting inside a run of hyphens (a markdown rule, an em-dash-ish `--`), and the
 * lookahead stops one ending mid-identifier.
 *
 * The family form is matched *first* and separately, and that ordering is the whole point. The
 * corpus has to be able to name a family — the seven `--palette-*` stops — for the same reason
 * `package.json` `exports` carries subpath patterns: enumerating the members in prose creates a
 * second copy of a list that already exists in the stylesheets, and a second copy is
 * indistinguishable from an amendment the first time the two disagree. Matched by the bare-token
 * pattern instead, `--palette-*` truncates to `--palette`, which is declared nowhere and fails —
 * so the corpus would be pushed into exactly the enumeration the family form exists to avoid.
 *
 * A family is resolved by *prefix* against the declared set, so it is still a real assertion: a
 * `--nonexistent-*` fails, and a `--palette-*` that stopped being declared would fail with it.
 */
export function findCustomPropertyCitations(source: string): CustomPropertyCitation[] {
  const found: CustomPropertyCitation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Families first; each match is then blanked so the bare-token pass below cannot re-report its
    // prefix as a missing property. Same length, so no column shifts — line numbers stay true.
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

/**
 * Every custom property *declared* by a stylesheet — the left side of a `--foo: …` declaration.
 *
 * Declarations are collected across the whole `css/` directory rather than from `theme-base.css`
 * alone, because the `--palette-50` … `--palette-950` ramp is declared by each per-theme file and
 * only *consumed* by the base. Restricted to the base, every ramp stop the corpus names would fail.
 */
export function parseDeclaredCustomProperties(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

// ── Source checks ────────────────────────────────────────────────────────────────────────────────

// `data-slot` ordering and `@source` coverage are deliberately absent: `scripts/validate-jsx.ts` and
// `scripts/validate-css-sources.ts` own those checks, and a second implementation of either would be
// two places to change when the rule moves. Their absence here is the single-home rule, not a gap.

/** A colour written as a literal rather than resolved through a token. */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;

/** The same, globally, for enumerating every hit on a line. */
const COLOR_LITERAL_GLOBAL = new RegExp(COLOR_LITERAL.source, "g");

/** Positions that make a quoted string on the same line a class list rather than arbitrary data. */
const CLASS_POSITION = /\bclass(?:Name)?\s*[=:]|\bcn\(|\basClass\(/;

/** Every quoted string literal on a line, contents only. */
function quotedStrings(line: string): string[] {
  const out: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/**
 * A `/* design-allow: <rule> — <reason> *​/` comment on `line` or the one above it.
 *
 * An escape hatch in the source, not an allowlist in the checker, and that placement is the whole
 * point: the exception is read by whoever reads the class it excuses, carries its reason with it,
 * and disappears when the line does. A hidden allowlist here would outlive the code it excused and
 * be invisible to the person changing it.
 *
 * The reason is mandatory — a bare marker with no text after the em dash does not suppress.
 */
export function isSuppressed(lines: readonly string[], line: number, ruleId: RuleId): boolean {
  // `\S` alone is satisfied by the `*` of the closing `*/`, which would let a reasonless marker
  // suppress — the one thing the mandatory reason exists to prevent. The lookahead excludes it.
  const marker = new RegExp(`/\\*\\s*design-allow:\\s*${ruleId}\\s+—\\s+(?!\\*/)\\S`);
  return [lines[line - 1], lines[line - 2]].some((candidate) => candidate !== undefined && marker.test(candidate));
}

/**
 * Colour literals inside a class string.
 *
 * Bounded two ways, because a hex in an `alt` string or a viewBox is not a design violation. A
 * literal counts when it sits inside a utility's arbitrary-value bracket (`bg-[#fff]` — unambiguous
 * wherever it appears), or when it sits in a quoted string on a line that is syntactically in class
 * position (`class=`, `className=`, `cn(`, `asClass(`).
 *
 * Tailwind *palette utilities* — `bg-red-50`, `border-blue-200`, used deliberately by `alert.tsx`,
 * `badge.tsx` and `toast.tsx` — carry no literal and so are structurally out of reach of both forms.
 * `findRawThemeUtilities` below is what covers them; the two rules divide the colour surface between
 * them rather than overlapping.
 */
export function findColorLiterals(source: string, file: string): Finding[] {
  const lines = source.split("\n");
  const findings: Finding[] = [];

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

/**
 * Tailwind's built-in palette names. An exhaustive list rather than a shape, because the shape
 * `<word>-<number>` is also what `gap-2`, `text-xs` and `z-50` are — only the hue name separates a
 * colour from a size. A palette forge does not ship (`brand-*`, an app's own scale) is deliberately
 * absent: an undefined utility is a class that never compiles, which is a different defect from one
 * that compiles and then survives the theme switch, and this rule states the second.
 */
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

/** The utilities that take a colour. `shadow` and `ring` are here because a coloured shadow or ring
 *  survives the switch exactly as a background does. */
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

/** `<variants>` `<utility>`-`<hue>`-`<stop>`, with the variant chain and the utility+hue captured so
 *  a bare use can be matched against its own `dark:` counterpart rather than against any dark class. */
const PALETTE_UTILITY = new RegExp(
  `(?<![\\w-])((?:[a-z][a-z0-9-]*:)*)(${COLOR_UTILITIES.join("|")})-(${PALETTE_HUES.join("|")})-(?:50|[1-9]00|950)(?![\\w-])`,
  "g",
);

/**
 * A raw Tailwind palette utility with no `dark:` counterpart beside it.
 *
 * This is the rule `findColorLiterals` structurally cannot reach — its own header says so. A palette
 * utility carries no literal, so neither the arbitrary-value bracket nor the quoted-string pass can
 * see one, and the Floor's "permitted **only** paired with its own `dark:` counterpart" therefore had
 * no matcher behind it. The defect it lets through is not a subtle one: `bg-yellow-100` stays pale
 * yellow when the page goes dark, so the chip becomes a bright island on a `--palette-900` surface.
 *
 * **Pairing is scoped to the line**, and position is deliberately *not* consulted — the same trade
 * `findBareFocus` makes, for the same two reasons. A status variant map (`alert.tsx`, `badge.tsx`,
 * `toast.tsx`) is an object literal whose values carry no `class=` or `cn(` token of their own, so a
 * class-position gate would be blind to exactly the place fixed status hues are written; and a class
 * string is one line at this repo's 148-column width, so the line is the string. The price is that a
 * pair split across two lines reports falsely — `isSuppressed` with a written reason is the answer,
 * and the split is worth rethinking anyway.
 *
 * The counterpart must match on **utility and hue**, not merely be some `dark:` class on the line:
 * `bg-red-100` is answered by `dark:bg-red-900` and not by a `dark:text-red-200` that happens to sit
 * beside it. Anything else would let one dark class excuse a whole map.
 */
export function findRawThemeUtilities(source: string, file: string): Finding[] {
  const lines = source.split("\n");
  const findings: Finding[] = [];

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

/** Inline `style=` attributes, which the SSR renderer drops — so the mistake is caught at source
 *  rather than discovered as a silently missing style in the browser.
 *
 *  The lookbehind excludes `data-style=` and any other hyphenated attribute ending in `style`. */
export function findInlineStyles(source: string, file: string): Finding[] {
  const lines = source.split("\n");
  const findings: Finding[] = [];

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

/**
 * Utilities that carry a numeric scale, so an arbitrary value on one of them has a scale value to
 * be measured against.
 *
 * This is an allowlist rather than a denylist, and that is what keeps Tailwind's **variant**
 * brackets out by construction: `data-[popup-open]`, `has-[select:disabled]`, `group-[…]`,
 * `peer-[…]`, `supports-[…]`, `aria-[…]`, `min-[…]`/`max-[…]` breakpoints and `@[…]` container
 * queries all name a *selector*, not a value, and none of their heads is a scale-bearing utility.
 * A denylist would have to enumerate them and would fail on the next variant Tailwind adds.
 *
 * The constraint utilities `min-w`, `max-w`, `min-h` and `max-h` are absent deliberately: they take
 * a bound rather than a step, and their real uses here (`max-h-[60vh]`, `min-w-[10rem]`) have no
 * scale equivalent to be redirected to.
 */
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

/**
 * The lookbehind is what stops `max-h-[60vh]` matching on its `h`, while still allowing a variant
 * prefix (`md:p-[7px]`, `[&_svg]:size-[18px]`) whose separator is `:` rather than `-`.
 */
const ARBITRARY_VALUE = new RegExp(`(?<![\\w-])(${SCALE_UTILITIES.join("|")})-\\[([^\\]]+)\\]`, "g");

/** A value a scale step could have expressed: an absolute length, or a colour literal. Viewport and
 *  percentage units are excluded because no scale step is written in them. */
const SCALE_COMPARABLE = /^\d+(?:\.\d+)?(?:px|rem)$/;

/** Arbitrary Tailwind values on scale-bearing utilities — see `SCALE_UTILITIES` for what the
 *  matcher deliberately cannot see, and `isSuppressed` for how a genuinely deliberate one opts out. */
export function findArbitraryValues(source: string, file: string): Finding[] {
  const lines = source.split("\n");
  const findings: Finding[] = [];

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

/**
 * `h-screen` / `w-screen`, which `100vh` makes wrong on mobile — `min-h-dvh` is the replacement.
 *
 * The lookbehind rejects `max-h-screen` and `min-h-screen` (`toast.tsx` uses the former to cap a
 * viewport-tall stack, which is exactly what the utility is for) while still matching a variant
 * prefix such as `md:h-screen`, whose separator is `:`.
 */
export function findViewportUnits(source: string, file: string): Finding[] {
  const lines = source.split("\n");
  const findings: Finding[] = [];

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

/**
 * A `<Card>` opened inside a `<Card.Content>` — a nesting that reads as a hierarchy the surface has
 * no way to express, so the inner card's border and padding compound instead of nesting.
 *
 * A shallow text match over the TSX, deliberately not an AST. What it **can** see: a literal
 * `<Card>` or `<Card …>` between a literal `<Card.Content` and the next literal `</Card.Content>`
 * in the same file. What it **cannot** see: a card rendered by a component invoked in between, a
 * `Card` reached through an alias or a variable, an unclosed or overlapping `Card.Content`, and a
 * nesting split across two files. Those are the cases a reviewer catches; this catches the one that
 * is written out in full, which is how it is nearly always written.
 */
export function findNestedCards(source: string, file: string): Finding[] {
  const findings: Finding[] = [];
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

/**
 * A bare `focus:` variant, which fires on a pointer press too — so the ring flashes on every click
 * and trains the reader to ignore it.
 *
 * The anchor is `focus:` with its colon, so `focus-visible:` and `focus-within:` are excluded by
 * construction: both carry `focus-`, and neither can produce the two characters `focus` followed by
 * `:`. No negative lookahead is needed and adding one would only suggest otherwise.
 *
 * Prose is excluded by **token shape** rather than by position. `focus:` is an ordinary thing to
 * write in an English sentence — `ui/client/tooltip.ts` says "keyboard focus: a tooltip …" — but a
 * sentence puts a space after the colon and a Tailwind variant never does, so requiring a utility
 * character immediately after it separates the two without asking where on the line they sit.
 *
 * Position is deliberately *not* consulted, unlike `findColorLiterals`. A class list written on a
 * continuation line of a multi-line `cn(` call carries no `class=` or `cn(` token of its own, and
 * that is exactly how the ring classes on a wrapped component are written — a class-position gate
 * would be blind to them, which for a focus indicator means blind to the accessibility defect.
 *
 * The price of dropping that gate is a `focus:` inside a string that is not a class list but looks
 * like a utility, which this **will** report. What it still cannot see is a variant assembled from a
 * variable or a template hole, where no line ever holds the two tokens adjacently.
 */
export function findBareFocus(source: string, file: string): Finding[] {
  const lines = source.split("\n");
  const findings: Finding[] = [];

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

/**
 * A raw `<select>`, `<input>`, `<textarea>` or `<button>` written by the showcase, where the whole
 * point is to demonstrate the components rather than to re-hand-roll them.
 *
 * The scope check lives **in the finder, not at the call site**, because it is part of what the rule
 * means rather than a detail of where this happens to run: `ui/core` renders exactly these elements
 * — that is what a primitive is — so a raw control is a violation only in the corpus's worked
 * example. A caller-side filter would put half the rule somewhere a reader of the rule never looks.
 *
 * Capitalisation is what separates a raw element from a component: `<Select` and `<Input` are
 * different strings from `<select` and `<input`, and the `(?=[\s/>])` boundary keeps `<inputmode`
 * or `<selection>` out. Matched over the whole source rather than line by line, because a formatted
 * JSX open tag puts its attributes on the following lines and the boundary character is then the
 * newline itself — a line-scoped scan would miss every control written the way this codebase writes
 * them. What it **cannot** see is an element produced by a helper or by a string template, which is
 * the same shallow-text limit `findNestedCards` accepts.
 */
export function findRawControls(source: string, file: string): Finding[] {
  if (!file.startsWith("src/ui/show/")) return [];

  const lines = source.split("\n");
  const findings: Finding[] = [];
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
export function findSourceViolations(source: string, file: string): Finding[] {
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
