import { type Finding, fail } from "../finding";

/** A colour scheme the theme is audited in. */
export type Mode = "light" | "dark";

/** The selector each mode is written under. */
export const MODE_SELECTOR: Readonly<Record<Mode, string>> = { light: ":root", dark: ".dark" };

/** One `--foo: bar;` declaration, with where it was written. */
export interface Declaration {
  /** The declared value, whitespace-collapsed — e.g. `var(--gray-11)`. */
  value: string;
  /** 1-indexed line the declaration sits on. */
  line: number;
  /** Which stylesheet it came from. Set by `mergeThemes`; absent when a single sheet was parsed. */
  file?: string;
}

/** Every declaration in each mode's block, keyed by property. */
export interface ParsedTheme {
  light: Map<string, Declaration>;
  dark: Map<string, Declaration>;
}

/** One mode's half of a contract row: the value a step must carry, and the measurement against it. */
export interface AcceptedRow {
  /** The custom property the exemption is about. */
  token: string;
  /** The role step it resolves through. */
  step: string;
  /** The value the step is exempted at, per mode. */
  value: Readonly<Record<Mode, string>>;
  /** Worst-case measured ratios. */
  measured: string;
  /** Why no criterion binds. Mandatory and non-empty. */
  reason: string;
}

/** Strips CSS comments, replacing them with same-length whitespace so line numbers stay true. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

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

/** Every custom-property declaration in the `:root` and `.dark` blocks of a stylesheet. */
export function parseThemeDeclarations(css: string): ParsedTheme {
  const source = stripComments(css);
  const parsed: ParsedTheme = { light: new Map(), dark: new Map() };

  // `@theme inline` re-declares these names as `var(--token)` aliases; reading it would overwrite
  // each token's real value with its own name.
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

function finding(file: string, line: number, message: string): Finding {
  return fail(message, { file, line });
}

function at(declared: Declaration, fallback: string): string {
  return declared.file ?? fallback;
}

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

/** Merges declarations from multiple stylesheets, read in import order, as one cascade. */
export function mergeThemes(parts: readonly { file: string; parsed: ParsedTheme }[]): ParsedTheme {
  const merged: ParsedTheme = { light: new Map(), dark: new Map() };
  for (const part of parts) {
    for (const mode of ["light", "dark"] as const) {
      for (const [property, declared] of part.parsed[mode]) merged[mode].set(property, { ...declared, file: part.file });
    }
  }
  return merged;
}

/** What a role step is worth in one mode, following the cascade rather than the file layout. */
export function resolveStep(parsed: ParsedTheme, mode: Mode, step: string): Declaration | undefined {
  // `.dark` follows `:root` and adds to it, so a step declared only in `:root` holds in dark too.
  return parsed[mode].get(step) ?? (mode === "dark" ? parsed.light.get(step) : undefined);
}

/** Whether a custom-property name matches the `--{scale}-{step}` role-step shape. */
export function isRoleStep(property: string): boolean {
  return /^--[a-z]+-(a?\d{1,2}|contrast)$/.test(property);
}

/** Fails every `.dark` declaration that is not itself a role step. */
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

/** Checks the accepted-exemption table against itself and against the parsed theme. */
export function checkAccepted(parsed: ParsedTheme, accepted: readonly AcceptedRow[], file: string): Finding[] {
  const findings: Finding[] = [];

  for (const row of accepted) {
    if (row.reason.trim().length === 0) {
      findings.push(
        finding(file, 1, `\`${row.token}\` is an accepted exemption with an empty reason — an exemption without a stated reason does not hold`),
      );
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
            `\`${row.step}\` is an accepted exemption for \`${row.token}\` but is declared in no \`${selector}\` block — an exemption must name a real step`,
          ),
        );
        continue;
      }
      if (declared.value !== row.value[mode]) {
        findings.push(
          finding(
            at(declared, file),
            declared.line,
            `\`${row.step}\` (${selector}) is \`${declared.value}\` but the exemption records \`${row.value[mode]}\` for \`${row.token}\` — the exemption states what this measures (${row.measured}), so a changed value invalidates it`,
          ),
        );
      }
    }
  }
  return findings;
}
