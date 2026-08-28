import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { contrastRatio, oklchToPaintedHex, parseOklch } from "./color";
import {
  type AcceptedRow,
  checkAccepted,
  checkDarkHoldsOnlySteps,
  MODE_LABEL,
  type Mode,
  mergeThemes,
  type ParsedTheme,
  parseThemeDeclarations,
  stripComments,
} from "./contrast-parse";

/** One side of an audited pair — the token whose resolved colour is measured. */
export interface ContrastSideInput {
  readonly token: string;
}

/** One audited pair — foreground and background tokens judged against a criterion. */
export interface ContrastPairInput {
  readonly token: string;
  readonly criterion: string;
  readonly foreground: ContrastSideInput;
  readonly background: ContrastSideInput;
}

/** A success criterion and the ratio it demands. */
export interface ContrastCriterion {
  readonly floor: number;
  readonly name: string;
}

/** What the contrast check needs to know about the project. @public */
export interface ContrastCheckConfig {
  root: string;
  /** Directory of stylesheets, relative to `root`. */
  cssDir: string;
  /** The token layer, in import order, relative to `root` — a pair may span multiple files, read as one cascade. */
  tokenFiles: readonly string[];
  /** The mapping layer, checked by one rule specifically. */
  mappingFile: string;
  /** The pairs to measure. */
  pairs: readonly ContrastPairInput[];
  /** Each criterion's floor and name, keyed as `pairs[].criterion` names them. */
  criteria: Readonly<Record<string, ContrastCriterion>>;
  /** Absolute path to an upstream palette stylesheet (e.g. Tailwind's `theme.css`); omit when no pair resolves through one. */
  palettePath?: string;
  /** Pairs the criteria do not bind, recorded with what they measure and why they are exempt. */
  accepted?: readonly AcceptedRow[];
}

/** Reads `--color-*` declarations out of an upstream palette stylesheet. @public */
export function parsePalette(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of stripComments(css).matchAll(/(--color-[a-z0-9]+(?:-[a-z0-9]+)*)\s*:\s*([^;}]+)[;}]/g)) {
    const property = match[1];
    const value = match[2];
    if (property !== undefined && value !== undefined) out.set(property, value.trim().replace(/\s+/g, " "));
  }
  return out;
}

/** Why a token could not be reduced to a colour. */
export interface Unresolved {
  token: string;
  at: string;
  reason: string;
}

/** Follows `var(--x)` from a token down to the `#rrggbb` a browser paints. @public */
export function resolveColor(token: string, mode: Mode, theme: ParsedTheme, palette: ReadonlyMap<string, string>): string | Unresolved {
  let current = token;
  // A `var()` loop resolves to nothing in CSS rather than hanging, so this refuses rather than spins.
  for (let hop = 0; hop < 8; hop++) {
    const declared = theme[mode].get(current) ?? theme.light.get(current) ?? palette.get(current);
    if (declared === undefined) {
      return {
        token,
        at: current,
        reason: current === token ? "is declared in no stylesheet" : `resolves through \`${current}\`, which is declared in no stylesheet`,
      };
    }
    const value = typeof declared === "string" ? declared : declared.value;

    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      const [, r = "", g = "", b = ""] = /^#(.)(.)(.)$/.exec(value) ?? [];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }

    const oklch = parseOklch(value);
    if (oklch !== null) return oklchToPaintedHex(oklch.l, oklch.c, oklch.h);

    const indirect = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value);
    if (indirect === null) {
      return { token, at: current, reason: `resolves to \`${value}\`, which is neither a hex literal, an \`oklch()\` nor a single \`var()\`` };
    }
    current = indirect[1] ?? "";
  }
  return { token, at: current, reason: "resolves through more than eight indirections — the chain is cyclic" };
}

/** One pair measured in one mode. */
export interface Measurement {
  token: string;
  mode: Mode;
  criterion: string;
  floor: number;
  foreground: string | Unresolved;
  background: string | Unresolved;
  ratio?: number;
}

/** Measures every pair in both modes. @public */
export function measurePairs(
  pairs: readonly ContrastPairInput[],
  criteria: Readonly<Record<string, ContrastCriterion>>,
  theme: ParsedTheme,
  palette: ReadonlyMap<string, string>,
): Measurement[] {
  const out: Measurement[] = [];
  for (const pair of pairs) {
    for (const mode of ["light", "dark"] as const) {
      const foreground = resolveColor(pair.foreground.token, mode, theme, palette);
      const background = resolveColor(pair.background.token, mode, theme, palette);
      const base: Measurement = {
        token: pair.token,
        mode,
        criterion: pair.criterion,
        floor: criteria[pair.criterion]?.floor ?? Number.POSITIVE_INFINITY,
        foreground,
        background,
      };
      out.push(typeof foreground === "string" && typeof background === "string" ? { ...base, ratio: contrastRatio(foreground, background) } : base);
    }
  }
  return out;
}

// The prevention the one-declaration-site contract exists for: a `.dark` block and a `:root` block
// both weigh 0-1-0 and both match the document element, so a consumer sheet imported after forge's
// beats only one of the two halves and leaks the other mode's values in silently. The rule is about
// declaration sites, not the selector — `theme-base.css` sets `color-scheme` under `.dark`, and a
// property that is not a custom property is not something a scheme could half-supply.
/** Fails any `.dark { … }` rule that declares a custom property, in any stylesheet under `cssDir`. */
function checkNoDarkBlock(root: string, cssDir: string): Finding[] {
  const findings: Finding[] = [];
  const files = readdirSync(resolve(root, cssDir))
    .filter((entry) => entry.endsWith(".css"))
    .sort();

  for (const name of files) {
    const source = stripComments(readFileSync(resolve(root, cssDir, name), "utf-8"));
    for (const match of source.matchAll(/\.dark\b[^;{}()]*\{/g)) {
      const block = blockAt(source, match.index + match[0].length);
      const declared = [...block.matchAll(/(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/g)].map((property) => property[1]);
      if (declared.length === 0) continue;
      findings.push(
        fail(
          `declares ${declared.join(", ")} under \`.dark\` — every step is declared once, in \`:root\`, and one that differs by mode is written with \`light-dark()\`. A second block cannot be supplied safely: it weighs the same 0-1-0 as \`:root\`, so a consumer's scheme replaces one half and silently keeps forge's other one`,
          { file: `${cssDir}/${name}`, line: source.slice(0, match.index).split("\n").length },
        ),
      );
    }
  }
  return findings;
}

/** The body of the rule whose `{` has just been consumed at `start`. */
function blockAt(css: string, start: number): string {
  let depth = 1;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return css.slice(start);
}

/** Measures the audit, then applies the structural rules measurement does not subsume. @public */
export function checkContrast(config: ContrastCheckConfig): CheckResult {
  const { root, cssDir, pairs, criteria } = config;
  const accepted = config.accepted ?? [];
  const findings: Finding[] = [];

  if (pairs.length === 0) return checkResult([fail("no audited pairs — refusing to report a green contrast gate that measured nothing")], "");

  for (const file of config.tokenFiles) {
    if (existsSync(resolve(root, file))) continue;
    return checkResult(
      [fail("a token file is missing — the audit reads the whole layer, so a gap in it is not something to work around", { file })],
      "",
    );
  }

  const sheets = config.tokenFiles.map((file) => ({ file, parsed: parseThemeDeclarations(readFileSync(resolve(root, file), "utf-8")) }));
  const theme = mergeThemes(sheets);
  const palette = config.palettePath === undefined ? new Map<string, string>() : parsePalette(readFileSync(config.palettePath, "utf-8"));

  for (const mode of ["light", "dark"] as const) {
    if (theme[mode].size === 0) {
      findings.push(
        fail(`no ${MODE_LABEL[mode]} values parsed from any \`:root\` block — a scheme declares its per-mode steps with \`light-dark()\``, {
          file: cssDir,
        }),
      );
    }
  }
  findings.push(...checkNoDarkBlock(root, cssDir));
  if (findings.length > 0) return checkResult(findings, "");

  const measurements = measurePairs(pairs, criteria, theme, palette);
  for (const measurement of measurements) {
    for (const [side, resolved] of [
      ["foreground", measurement.foreground],
      ["background", measurement.background],
    ] as const) {
      if (typeof resolved === "string") continue;
      findings.push(fail(`${measurement.token} (${measurement.mode}): ${side} \`${resolved.token}\` ${resolved.reason}`, { file: cssDir }));
    }
    if (measurement.ratio === undefined) continue;
    if (Math.round(measurement.ratio * 100) / 100 >= measurement.floor) continue;
    const fg = typeof measurement.foreground === "string" ? measurement.foreground : "?";
    const bg = typeof measurement.background === "string" ? measurement.background : "?";
    findings.push(
      fail(
        `${measurement.token} (${measurement.mode}) measures ${measurement.ratio.toFixed(2)}:1 against a ${measurement.floor}:1 floor — ${criteria[measurement.criterion]?.name ?? measurement.criterion}. ${fg} on ${bg}`,
        { file: cssDir },
      ),
    );
  }

  findings.push(...checkDarkHoldsOnlySteps(theme, config.mappingFile));
  if (accepted.length > 0) findings.push(...checkAccepted(theme, accepted, config.mappingFile));

  const mapping = sheets.find((sheet) => sheet.file === config.mappingFile);
  if (mapping !== undefined && mapping.parsed.dark.size > 0) {
    findings.push(
      fail(
        `declares ${mapping.parsed.dark.size} propert${mapping.parsed.dark.size === 1 ? "y" : "ies"} under \`.dark\` — the mapping layer is mode-free by construction, and a mode-varying value belongs in a scheme file`,
        { file: config.mappingFile },
      ),
    );
  }

  const audited = new Set([
    ...pairs.flatMap((pair) => [pair.token, pair.foreground.token, pair.background.token]),
    ...accepted.flatMap((row) => [row.token, row.step]),
  ]);
  const schemes = readdirSync(resolve(root, cssDir))
    .filter((name) => name.startsWith("theme-") && name.endsWith(".css") && !config.tokenFiles.includes(`${cssDir}/${name}`))
    .sort();

  for (const name of schemes) {
    const scheme = parseThemeDeclarations(readFileSync(resolve(root, cssDir, name), "utf-8"));
    const overrides: string[] = [];
    for (const mode of ["light", "dark"] as const) {
      for (const token of scheme[mode].keys()) if (audited.has(token)) overrides.push(token);
    }
    // Re-declaring an audited step is expected — that is what a scheme is.
    const tokens = overrides.filter((token) => !token.startsWith("--gray-"));
    if (tokens.length > 0) {
      findings.push(
        fail(`overrides audited tokens beyond the scale (${tokens.join(", ")}) — re-measure against this scheme's values`, {
          file: `${cssDir}/${name}`,
        }),
      );
    }
  }

  return checkResult(
    measurements.length === 0 ? findings : findings,
    `${measurements.length} measurements over ${pairs.length} pairs, ${accepted.length} exemptions, ${schemes.length} schemes.`,
  );
}
