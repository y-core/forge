/** contrast-parse.ts — the token-contrast contract `validate-contrast.ts` decides on.
 *
 *  Mirrors the `design-parse.ts` / `validate-design.ts` split: the runner keeps the reading, the
 *  printing and the verdict; the contract and every pure decision live here, where they are
 *  importable and therefore assertable. Strings in, data out — no disk, no repo root, no printing.
 *
 *  ## A second split, across the repository boundary
 *
 *  The **pair definitions** are not here. They are in `src/ui/contracts/contrast-pairs.ts`, because
 *  the theme customiser reports live ratios for a scheme that does not exist yet and has to report
 *  them for the *same* pairs — otherwise it is measuring something, just not the thing this gate
 *  protects. Two lists would be two answers to one question.
 *
 *  What stayed is the measurement: `PINNED` below, joined to each shared pair by `pinnedRow`. The
 *  line between them is not arbitrary. Which pairs are audited, what each is read against and which
 *  criterion binds it are facts about forge's *design*, and they hold for any scheme. What a step is
 *  worth today is a fact about the scheme currently **on disk**, and the customiser's whole premise
 *  is that the scheme is a variable.
 *
 *  `scripts/` sits outside the namespace graph, so importing from `src/` costs nothing here.
 *
 *  ## What this gate proves, and what it does not
 *
 *  It pins the **mapping**, not the pixels. Every colour forge resolves is either a literal in
 *  `theme-neutral.css` or a Tailwind stop `theme-colors.css` names, so nothing upstream can move a
 *  measured ratio without one of those files changing — and the only thing that *can* move one is forge re-pointing a token
 *  or editing a step. Pinning both is therefore the complete check, and it needs no colour arithmetic
 *  at run time.
 *
 *  So a green here means "the mapping every recorded ratio was measured against is still the mapping
 *  on disk". It does **not** re-derive the ratios. Changing a pinned value fails this gate until
 *  someone re-runs the measurement and updates the row — which is the point: the failure is a prompt
 *  to measure, not a thing to silence.
 *
 *  ## The mapping is two hops, and a row pins both
 *
 *  A semantic token does not name a colour. It names a **role step** — the 12-step Radix scale — and
 *  the step names the colour. The two hops live in different files, which is why this gate reads the
 *  token layer as one cascade rather than one sheet:
 *
 *  ```
 *  --muted-foreground: var(--gray-11)      ← theme-base.css   :root, once, for both modes
 *    --gray-11: #646464                    ← theme-neutral.css :root
 *    --gray-11: #b4b4b4                    ← theme-neutral.css .dark
 *  ```
 *
 *  A row therefore names a `step` and pins the step's value per mode. The gain is not bookkeeping.
 *  A step means the same thing in both modes, so the semantic layer has **no** independently
 *  mode-varying decision left in it — and `checkContract` asserts that directly by failing any
 *  audited token that is declared in `.dark` at all. Before this, the two halves of every token were
 *  free to drift apart and only a human reading both blocks would notice.
 *
 *  A step declared only in `:root` is read as holding in both modes, because that is what the
 *  cascade does — `.dark` follows `:root` and adds to it. `--red-contrast` is the live case: it is
 *  `var(--gray-1)`, and step 1 is the page, which is near-white in light and near-black in dark —
 *  exactly the two answers a foreground-on-a-saturated-fill needs. One declaration covers both modes
 *  because the *step* already varies; a `.dark` twin would only restate it.
 *
 *  `--yellow-contrast` is the counter-example and is declared in both blocks, which is worth knowing
 *  because it looks like it should not need to be. Near-white on `yellow-500` measures 1.83, so this
 *  foreground stays near-black in *both* modes — and no single step is near-black in both. It is
 *  therefore the one place `.dark` carries a different **step** (`--gray-12` in light, `--gray-1` in
 *  dark) rather than a different value: the same colour, named from either end of the ramp.
 *
 *  ## Re-deriving the ratios (the manual step)
 *
 *  Tailwind is not a forge dependency — it is the consuming app's — so a row naming a Tailwind stop
 *  cannot be measured from inside this repository. To reproduce a measurement:
 *
 *  1. Resolve both halves of the pair. A gray step is a literal in `theme-neutral.css`; a status hue is
 *     `--color-<hue>-<stop>` from `tailwindcss/theme.css`, which is `oklch(L C H)`.
 *  2. For a hex literal: divide each channel by 255 and apply the sRGB transfer function
 *     (`c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055) ** 2.4`). For an `oklch`: convert to oklab, then
 *     to linear sRGB, and clamp into gamut.
 *  3. Relative luminance `0.2126 R + 0.7152 G + 0.0722 B` on the linear values, then
 *     `(lighter + 0.05) / (darker + 0.05)`.
 *  4. Compare to `floor`.
 *
 *  There is no longer a "worst case across five ramps" step, and it is not merely that the count
 *  changed. All four schemes are built on **one lightness ramp**, differing only in chroma and hue,
 *  so a ratio is a single exact value that holds across every scheme to within **0.05** — the widest
 *  gap at any audited step — `--muted-foreground` in light, 5.17 to 5.22. A row measured against the
 *  default scheme therefore describes
 *  every other scheme too, by construction rather than by coincidence, and no
 *  scheme swap can move a pair across its floor. The theme sweep below still reports every override,
 *  so a scheme that stopped sharing the ramp would be visible rather than assumed.
 *
 *  `against` names the backdrop the ratio was taken on, so a re-run is reproducible rather than
 *  approximate. Tailwind-stop rows were measured against Tailwind 4.3.3.
 *
 *  ## What used to be outside this contract, and no longer is
 *
 *  This gate audits **custom properties only** — it parses `:root` and `.dark` out of the token
 *  layer (`theme-neutral.css`, `theme-colors.css`, `theme-base.css`, read as one cascade) and
 *  compares declarations. That boundary has not moved. What moved is what is on which side of it.
 *
 *  Until the `--status-*` family existed, the status variants on `Alert`, `Toast` and `Badge` and the
 *  two banner strings in `src/http/fragment.ts` were *fixed palette pairs* — `bg-red-50` /
 *  `dark:bg-red-950` and their blue, emerald and yellow siblings, with `Badge`'s four one stop in at
 *  `bg-red-100` / `dark:bg-red-900`. Twenty-eight pairs, not tokens, so nothing here could see them.
 *  Their only audit was a block comment beside each map. This header said so, and drew the
 *  conclusion that they *"can never be gated here"*.
 *
 *  **That conclusion was wrong, and the reason is worth keeping.** It was read off the wrong
 *  constraint. The binding one is not "forge cannot compile CSS" — it is "this gate reads custom
 *  properties", and whether a colour is a custom property is a *choice about the component*, not a
 *  fact about the gate. Once the pairs became `--status-*` declarations they came inside a boundary
 *  that never moved, and the eight foreground rows and four `ACCEPTED` border rows below are them.
 *  A claim that something can never be checked is usually a claim about where a value happens to
 *  live, and that is the most movable thing in the system.
 *
 *  What *is* genuinely outside remains outside: forge has no Tailwind dependency, so nothing in this
 *  repository compiles CSS, and no gate here proves a utility name generates a rule. That is a real
 *  limit and it is why the rows below pin a mapping rather than a pixel.
 */

import { CONTRAST_PAIRS, type ContrastPair, CRITERION, type Criterion } from "../src/ui/contracts/contrast-pairs";
import type { Finding } from "./design-parse";

export { CRITERION, type Criterion };

/** The two blocks a token file may declare. */
export type Mode = "light" | "dark";

/** The selector each mode is written under. */
export const MODE_SELECTOR: Readonly<Record<Mode, string>> = { light: ":root", dark: ".dark" };

/** One `--foo: bar;` declaration, with where it was written. */
export interface Declaration {
  /** The declared value, whitespace-collapsed — e.g. `var(--gray-11)`. */
  value: string;
  /** 1-indexed line the declaration sits on, so a failure is clickable. */
  line: number;
  /** Which stylesheet it came from. Set by `mergeThemes`; absent when a single sheet was parsed. */
  file?: string;
}

/** Every declaration in each mode's block, keyed by property. */
export interface ParsedTheme {
  light: Map<string, Declaration>;
  dark: Map<string, Declaration>;
}

/** One mode's half of a contract row: the value the row's *step* must carry in that mode, and the
 *  measurement taken against it. */
export interface PinnedValue {
  /** The declaration the step must carry in this mode, verbatim. */
  value: string;
  /** The measured ratio for this pair — see the header for the procedure. Exact rather than a
   *  worst case: each scheme declares its own literals, so there is one value, not five. */
  ratio: number;
  /** The backdrop token that produced that worst case. */
  against: string;
  /** The criterion that binds this pair. `floor` is read from `CRITERION`. */
  criterion: Criterion;
}

/** An audited token: the step it resolves through, what that step is worth in each mode, and what
 *  the pair was measured at. */
export interface ContractRow {
  /** The semantic custom property, including its leading `--`. Declared once, in `:root`. */
  token: string;
  /** Why this token is an affordance rather than decoration — printed on failure, so the reader
   *  learns what the row is protecting rather than only that it moved. */
  role: string;
  /** The role step `token` must resolve through — e.g. `--gray-11`. This is the hop that carries the
   *  mode difference, and pinning it is what keeps the semantic layer mode-free. */
  step: string;
  light: PinnedValue;
  dark: PinnedValue;
}

/** What one audited pair was measured at, per mode. Keyed by token, joined to the pair below. */
interface Pinned {
  light: { value: string; ratio: number };
  dark: { value: string; ratio: number };
}

/**
 * The measurements — the half of the audit that describes the **shipped** scheme.
 *
 * This is what stayed behind when the pair definitions moved to
 * `src/ui/contracts/contrast-pairs.ts`, and the split is along exactly that line. Which pairs are
 * audited, what each is read against and which criterion binds it are facts about forge's design,
 * so the customiser and this gate share them. What a step is *worth* today, and what that measured,
 * is a fact about the scheme currently on disk — and the whole premise of a customiser is that the
 * scheme is a variable. Importing these into a generated scheme would be asserting the answer
 * instead of doing the sum.
 *
 * See the header for the procedure that re-derives a ratio when a row legitimately has to move.
 */
const PINNED: Readonly<Record<string, Pinned>> = {
  "--muted-foreground": { light: { value: "#646464", ratio: 5.19 }, dark: { value: "#b4b4b4", ratio: 7.67 } },
  "--input": { light: { value: "#838383", ratio: 3.33 }, dark: { value: "#7b7b7b", ratio: 3.76 } },
  "--track": { light: { value: "#838383", ratio: 3.6 }, dark: { value: "#7b7b7b", ratio: 4.46 } },
  "--ring": { light: { value: "#646464", ratio: 5.19 }, dark: { value: "#b4b4b4", ratio: 7.67 } },
  // The accent solid does not invert, so this is one role named from either end of the grey ramp —
  // near-white in both modes. 5.48 and 4.97 against a 4.5 floor; the margin is why `ACCENT_RAMP`
  // puts step 9 at lightness 0.52 rather than at indigo's own 0.5438, where dark measured 4.49.
  "--primary-foreground": { light: { value: "var(--gray-1)", ratio: 5.48 }, dark: { value: "var(--gray-12)", ratio: 4.97 } },
  "--destructive": { light: { value: "var(--color-red-700)", ratio: 5.63 }, dark: { value: "var(--color-red-300)", ratio: 8.28 } },
  "--destructive-foreground": { light: { value: "var(--gray-1)", ratio: 6.1 }, dark: { value: "var(--gray-1)", ratio: 9.83 } },
  "--warning-foreground": { light: { value: "var(--gray-12)", ratio: 8.51 }, dark: { value: "var(--gray-1)", ratio: 12.04 } },
  "--status-danger-subtle-foreground": {
    light: { value: "var(--color-red-900)", ratio: 9.21 },
    dark: { value: "var(--color-red-200)", ratio: 11.14 },
  },
  "--status-danger-strong-foreground": {
    light: { value: "var(--color-red-800)", ratio: 6.86 },
    dark: { value: "var(--color-red-200)", ratio: 6.94 },
  },
  "--status-warning-subtle-foreground": {
    light: { value: "var(--color-yellow-900)", ratio: 8.39 },
    dark: { value: "var(--color-yellow-200)", ratio: 12.52 },
  },
  "--status-warning-strong-foreground": {
    light: { value: "var(--color-yellow-800)", ratio: 6.4 },
    dark: { value: "var(--color-yellow-200)", ratio: 7.47 },
  },
  "--status-success-subtle-foreground": {
    light: { value: "var(--color-emerald-900)", ratio: 9.19 },
    dark: { value: "var(--color-emerald-200)", ratio: 11.82 },
  },
  "--status-success-strong-foreground": {
    light: { value: "var(--color-emerald-800)", ratio: 6.68 },
    dark: { value: "var(--color-emerald-200)", ratio: 7.56 },
  },
  "--status-info-subtle-foreground": {
    light: { value: "var(--color-blue-900)", ratio: 9.54 },
    dark: { value: "var(--color-blue-200)", ratio: 10.35 },
  },
  "--status-info-strong-foreground": {
    light: { value: "var(--color-blue-800)", ratio: 7.25 },
    dark: { value: "var(--color-blue-200)", ratio: 7.31 },
  },
};

/**
 * One shared pair joined to its measurements.
 *
 * Throws at module load if a pair has no entry in {@link PINNED}. That is deliberate and it is the
 * point of the join: adding a pair to `contrast-pairs.ts` without measuring it would otherwise
 * produce a contract row with an undefined ratio, and `checkContract` compares ratios to floors —
 * so the gate would go green on a pair nobody measured. Failing to load is the loudest available
 * way to say "this needs a measurement".
 */
function pinnedRow(pair: ContrastPair): ContractRow {
  const pinned = PINNED[pair.token];
  if (pinned === undefined) {
    throw new Error(
      `${pair.token} is in CONTRAST_PAIRS but has no measurement in PINNED — measure it (procedure in this file's header) before the gate can decide on it`,
    );
  }
  return {
    token: pair.token,
    role: pair.role,
    step: pair.step,
    light: { ...pinned.light, against: pair.against.light, criterion: pair.criterion },
    dark: { ...pinned.dark, against: pair.against.dark, criterion: pair.criterion },
  };
}

/**
 * The audited tokens: the shared pair list, each row carrying what it currently measures.
 *
 * Membership is decided in `src/ui/contracts/contrast-pairs.ts` — see `CONTRAST_PAIRS` for the
 * affordance-scoping rule that puts a token here rather than in `ACCEPTED`.
 */
export const TOKEN_CONTRACT: readonly ContractRow[] = CONTRAST_PAIRS.map(pinnedRow);

/** A pair WCAG does not bind, recorded with what it actually measures and why it is exempt.
 *
 *  This mirrors how `CLASS_FREE` in `validate-css-sources.ts` works: an opt-out is a *claim*, so it
 *  is written down with its reason and re-checked on every run rather than trusted indefinitely. */
export interface AcceptedRow {
  /** The custom property the exemption is about. */
  token: string;
  /** The role step it resolves through — the same two-hop shape a `ContractRow` pins. */
  step: string;
  /** The value the step is exempted at, per mode — pinned for the same reason a contract row is. */
  value: Readonly<Record<Mode, string>>;
  /** Worst-case measured ratios, so the exemption states its cost rather than hiding it. */
  measured: string;
  /** Why no criterion binds. Mandatory and non-empty — an exemption without one does not hold. */
  reason: string;
}

/**
 * The decorative pairs, deliberately left as they are.
 *
 * `--border` paints `Card`, `Alert`/`Toast` default, `Dialog`, `Popover`, `Menu`, the chrome
 * `Toolbar` flyout, and every `bg-border` separator. None of those identifies a control or reports a
 * state, so 1.4.11 does not bind and a quiet hairline is the correct design. This is the line that
 * keeps the visual change bounded — see `forge-ui-color-scale-adjacent-stops` in
 * `src/ui/design/reference/04-color.md` for the affordance-vs-decoration distinction it rests on.
 */
export const ACCEPTED: readonly AcceptedRow[] = [
  {
    token: "--border",
    step: "--gray-6",
    value: { light: "#d9d9d9", dark: "#3a3a3a" },
    measured: "1.24 against --background / --card / --muted in light; 1.40 in dark",
    reason:
      "decorative separation only — a hairline, a divider, a surface edge. It identifies no control and reports no state, so WCAG 1.4.11 does not bind. It is faint by design and measured so rather than assumed: a hairline that reads as a hairline is what a surface edge should be, and recording the number is what keeps that a choice someone made rather than one nobody checked.",
  },

  // ── The status borders ───────────────────────────────────────────────────────────────────────
  //
  // Four exemptions rather than four contract rows, and the reason is the same distinction
  // `forge-ui-color-scale-adjacent-stops` turns on: **decoration versus affordance**. A status
  // panel's edge is not what makes it a status panel — the fill and the text are, and both are
  // audited above. Nothing here identifies a control or reports a state, so WCAG 1.4.11 does not
  // bind, and each ratio is recorded rather than argued away.
  //
  // These are low by design and low by a wide margin: 1.08–1.33 in light, 1.18–2.12 in dark. That is
  // a tinted edge one shade in from its own fill, which is what the design asks for. Writing the
  // numbers down is what keeps the choice reviewable — if a future change wants a *visible* status
  // border, the exemption fails on the pinned value and the decision gets re-made rather than
  // inherited.
  //
  // One value per mode covers both tiers because `-border` is shared: the same step 6 edges the
  // `-subtle` panel and the `-strong` chip. The measurement therefore names both surfaces.
  {
    token: "--status-danger-border",
    step: "--red-6",
    value: { light: "var(--color-red-200)", dark: "var(--color-red-800)" },
    measured: "1.33 on --status-danger-subtle and 1.19 on --status-danger-strong in light; 1.93 and 1.20 in dark",
    reason:
      "the decorative edge of a failure panel or chip. The fill and the text carry the meaning and are both audited above; the border only bounds them, so it identifies no control and reports no state and WCAG 1.4.11 does not bind.",
  },
  {
    token: "--status-warning-border",
    step: "--yellow-6",
    value: { light: "var(--color-yellow-200)", dark: "var(--color-yellow-800)" },
    measured: "1.12 on --status-warning-subtle and 1.08 on --status-warning-strong in light; 2.12 and 1.26 in dark",
    reason:
      "the decorative edge of a warning panel or chip. Lowest of the four in light, because yellow's -50 and -200 sit close together in luminance — a fainter hairline, not a weaker signal, since the signal is the fill.",
  },
  {
    token: "--status-success-border",
    step: "--emerald-6",
    value: { light: "var(--color-emerald-200)", dark: "var(--color-emerald-800)" },
    measured: "1.21 on --status-success-subtle and 1.13 on --status-success-strong in light; 2.00 and 1.28 in dark",
    reason:
      "the decorative edge of a success panel or chip. Same argument as --status-danger-border: bounding a surface is not identifying a control.",
  },
  {
    token: "--status-info-border",
    step: "--blue-6",
    value: { light: "var(--color-blue-200)", dark: "var(--color-blue-800)" },
    measured: "1.31 on --status-info-subtle and 1.17 on --status-info-strong in light; 1.67 and 1.18 in dark",
    reason:
      "the decorative edge of an informational panel or chip. Same argument as --status-danger-border: bounding a surface is not identifying a control.",
  },
];

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────

/** CSS comments, stripped before parsing so a commented-out declaration is not read as a live one.
 *  Replaced with same-length whitespace, preserving newlines, so line numbers stay true. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * The body of the first top-level block for `selector`, with the offset it starts at.
 *
 * Brace-counted rather than matched to the first `}`: `theme-base.css` also carries `@theme inline`
 * and a nested `@layer components`, and a first-`}` match would be correct only by accident of the
 * blocks this file happens to contain today.
 */
function blockBody(css: string, selector: string): { body: string; offset: number } | undefined {
  const re = new RegExp(`(?:^|\\})\\s*${selector.replace(".", "\\.")}\\s*\\{`, "m");
  const match = re.exec(css);
  if (match === null) return undefined;

  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { body: css.slice(start, i), offset: start };
    }
  }
  return undefined;
}

/**
 * Every custom-property declaration in the `:root` and `.dark` blocks of a stylesheet.
 *
 * Only those two blocks: `@theme inline` re-declares the same names as `--color-*` aliases, and
 * reading it would overwrite each token's real value with `var(--token)` — the mapping this gate
 * exists to pin would then always appear to be its own name.
 *
 * A later declaration of the same property wins, which is what the cascade does.
 */
export function parseThemeDeclarations(css: string): ParsedTheme {
  const source = stripComments(css);
  const parsed: ParsedTheme = { light: new Map(), dark: new Map() };

  for (const mode of ["light", "dark"] as const) {
    const block = blockBody(source, MODE_SELECTOR[mode]);
    if (block === undefined) continue;
    const lineBase = source.slice(0, block.offset).split("\n").length;
    for (const match of block.body.matchAll(/(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:\s*([^;}]+)[;}]?/g)) {
      const property = match[1];
      const value = match[2];
      if (property === undefined || value === undefined) continue;
      parsed[mode].set(property, {
        value: value.trim().replace(/\s+/g, " "),
        line: lineBase + block.body.slice(0, match.index).split("\n").length - 1,
      });
    }
  }
  return parsed;
}

// ── Checking ─────────────────────────────────────────────────────────────────────────────────────

function finding(file: string, line: number, detail: string): Finding {
  return { file, line, ruleId: "forge-ui-contrast-floor", detail };
}

/** Where a declaration was written, falling back to the sheet the caller named. */
function at(declared: Declaration, fallback: string): string {
  return declared.file ?? fallback;
}

/**
 * Several stylesheets read as one cascade.
 *
 * The token layer is split across files by concern — the scheme, the fixed hues, the mapping — and a
 * contract row spans them: `--muted-foreground` is declared in `theme-base.css` while the
 * `--gray-11` it resolves through is declared in `theme-neutral.css`. Merging in import order and
 * stamping each declaration with its origin is what lets one check see the whole system and still
 * point a failure at the right file.
 *
 * Later files win, which is what the cascade does — and what makes `theme-slate.css` a scheme
 * override rather than a conflict.
 */
export function mergeThemes(parts: readonly { file: string; parsed: ParsedTheme }[]): ParsedTheme {
  const merged: ParsedTheme = { light: new Map(), dark: new Map() };
  for (const part of parts) {
    for (const mode of ["light", "dark"] as const) {
      for (const [property, declared] of part.parsed[mode]) merged[mode].set(property, { ...declared, file: part.file });
    }
  }
  return merged;
}

/**
 * What a role step is worth in one mode, following the cascade rather than the file layout.
 *
 * `.dark` comes after `:root` and *adds* to it, so a step declared only in `:root` holds in dark too
 * — `--red-contrast` is deliberately written that way, since the step it aliases already inverts.
 * Falling back is therefore reading the CSS correctly, not being lenient: requiring both blocks would
 * force a duplicate declaration whose only purpose is to satisfy the parser, which is the drift this
 * whole layer exists to remove.
 */
export function resolveStep(parsed: ParsedTheme, mode: Mode, step: string): Declaration | undefined {
  return parsed[mode].get(step) ?? (mode === "dark" ? parsed.light.get(step) : undefined);
}

/**
 * The semantic half of a row: the token is declared once, in `:root`, as `var(--step)`.
 *
 * The `.dark` check is the one that carries the architecture. An audited token appearing there at
 * all means someone re-introduced a mode-specific answer at a layer that is supposed to have none,
 * and the failure names that rather than the value — because the value might well be right today
 * and still be the beginning of the drift.
 */
function checkSemanticHop(parsed: ParsedTheme, row: { token: string; step: string }, file: string): Finding[] {
  const findings: Finding[] = [];
  const expected = `var(${row.step})`;
  const declared = parsed.light.get(row.token);

  if (declared === undefined) {
    findings.push(finding(file, 1, `\`${row.token}\` is not declared in \`:root\` — the contract resolves it through \`${expected}\``));
  } else if (declared.value !== expected) {
    findings.push(
      finding(
        at(declared, file),
        declared.line,
        `\`${row.token}\` is \`${declared.value}\` but the contract resolves it through \`${expected}\` — the ratios below were measured against that step, so re-point the token or move the row to the step it now uses`,
      ),
    );
  }

  const twin = parsed.dark.get(row.token);
  if (twin !== undefined) {
    findings.push(
      finding(
        at(twin, file),
        twin.line,
        `\`${row.token}\` is declared in \`.dark\` — the semantic layer is mode-free, and \`.dark\` carries role steps only. A step means the same thing in both modes, so re-point \`${row.step}\` instead of overriding the token`,
      ),
    );
  }
  return findings;
}

/**
 * Every way the declared theme can disagree with the contract.
 *
 * Five distinct failures, deliberately not collapsed into one:
 *
 * 1. **Semantic hop wrong or missing** — the token does not resolve through the step the row names,
 *    so the ratios below are measurements of a colour it no longer reaches.
 * 2. **Mode-specific twin** — the token is declared in `.dark`. See `checkSemanticHop`.
 * 3. **Step missing** — the step is declared in neither block, so nothing was measured.
 * 4. **Step changed** — it is declared as something other than the pinned value. The recorded ratio
 *    is now a statement about a colour that is no longer there, so the row fails until it is
 *    re-measured. This is the check that does the real work.
 * 5. **Below floor** — the row pins a ratio under its own criterion's floor. This one reads the
 *    contract against itself rather than against disk, so a row cannot be "fixed" by editing the
 *    recorded ratio down to match a failing colour.
 */
export function checkContract(parsed: ParsedTheme, contract: readonly ContractRow[], file: string): Finding[] {
  const findings: Finding[] = [];

  for (const row of contract) {
    findings.push(...checkSemanticHop(parsed, row, file));

    for (const mode of ["light", "dark"] as const) {
      const pinned = row[mode];
      const { floor, name } = CRITERION[pinned.criterion];
      const selector = MODE_SELECTOR[mode];

      if (pinned.ratio < floor) {
        findings.push(
          finding(
            file,
            1,
            `\`${row.token}\` (${selector}) is pinned at a measured ${pinned.ratio.toFixed(2)}:1 against ${pinned.against}, below the ${floor}:1 floor of WCAG ${pinned.criterion} (${name}) — a contract row may not record a failing measurement`,
          ),
        );
      }

      const declared = resolveStep(parsed, mode, row.step);
      if (declared === undefined) {
        findings.push(
          finding(file, 1, `\`${row.step}\` is not declared in \`${selector}\` — the contract pins it to \`${pinned.value}\` for \`${row.token}\``),
        );
        continue;
      }
      if (declared.value !== pinned.value) {
        findings.push(
          finding(
            at(declared, file),
            declared.line,
            `\`${row.step}\` (${selector}) is \`${declared.value}\` but the contract pins \`${pinned.value}\` — that mapping is what ${pinned.ratio.toFixed(2)}:1 against ${pinned.against} was measured against, and WCAG ${pinned.criterion} needs ${floor}:1 here for \`${row.token}\` (${row.role}). Re-measure and update TOKEN_CONTRACT, or restore the value`,
          ),
        );
      }
    }
  }
  return findings;
}

/**
 * A role step's name shape: a namespace and a position on the scale.
 *
 * `--gray-11`, `--red-2`, `--accent-12` — the solid steps — plus `--gray-a3` and its siblings, the
 * **alpha** steps, and `--<hue>-contrast`, which is a functional token rather than a numbered step
 * but belongs to the same layer and varies by mode for the same reason. Everything else is a
 * semantic token, and semantic tokens are mode-free.
 *
 * Matched by *shape* rather than against a list of known names, because a list would have to be
 * edited before a new step could be declared, and the edit is exactly where someone would add a
 * semantic token instead. The shape cannot be satisfied by accident: `--card-foreground` and
 * `--status-danger-subtle` both fail it, and neither has a spelling that would pass.
 */
export function isRoleStep(property: string): boolean {
  return /^--[a-z]+-(a?\d{1,2}|contrast)$/.test(property);
}

/**
 * `.dark` holds role steps and nothing else.
 *
 * `checkSemanticHop` already refuses a `.dark` twin for any token the contract names. This is the
 * same rule with the contract taken out of it, and that is the point: an unaudited token is exactly
 * the one that would come back first, because nothing else is watching it. Without this, the
 * architecture could rot one declaration at a time and every gate would stay green until the day
 * someone added a contract row and discovered the twin.
 *
 * Deliberately not scoped to a known token list — see `isRoleStep`.
 */
export function checkDarkHoldsOnlySteps(parsed: ParsedTheme, file: string): Finding[] {
  const findings: Finding[] = [];
  for (const [property, declared] of parsed.dark) {
    if (isRoleStep(property)) continue;
    findings.push(
      finding(
        at(declared, file),
        declared.line,
        `\`${property}\` is declared in \`.dark\`, which carries role steps only — a step means the same thing in both modes, so the mode difference belongs in the step it resolves through, not here. Declare \`${property}\` once in \`:root\` and re-point its step`,
      ),
    );
  }
  return findings;
}

/**
 * The `ACCEPTED` table checked against itself and against disk.
 *
 * An exemption is a claim about a token, so it has to name a token that exists and say why. A blank
 * reason is the failure mode this guards: it turns a recorded, reviewable decision back into an
 * unexplained allowlist entry, which is the thing `CLASS_FREE` was built to avoid one script over.
 */
export function checkAccepted(parsed: ParsedTheme, accepted: readonly AcceptedRow[], file: string): Finding[] {
  const findings: Finding[] = [];

  for (const row of accepted) {
    if (row.reason.trim().length === 0) {
      findings.push(finding(file, 1, `\`${row.token}\` is in ACCEPTED with an empty reason — an exemption without a stated reason does not hold`));
    }
    findings.push(...checkSemanticHop(parsed, row, file));

    for (const mode of ["light", "dark"] as const) {
      const declared = resolveStep(parsed, mode, row.step);
      const selector = MODE_SELECTOR[mode];
      if (declared === undefined) {
        findings.push(
          finding(
            file,
            1,
            `\`${row.step}\` is in ACCEPTED for \`${row.token}\` but is declared in no \`${selector}\` block — an exemption must name a real step`,
          ),
        );
        continue;
      }
      if (declared.value !== row.value[mode]) {
        findings.push(
          finding(
            at(declared, file),
            declared.line,
            `\`${row.step}\` (${selector}) is \`${declared.value}\` but ACCEPTED records \`${row.value[mode]}\` for \`${row.token}\` — the exemption states what this measures (${row.measured}), so a changed value invalidates it`,
          ),
        );
      }
    }
  }
  return findings;
}
