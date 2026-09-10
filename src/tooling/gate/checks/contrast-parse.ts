import { fail } from "../finding";
import type { Finding } from "../types";
import { blankComments, lineAt } from "./source-scan";
import type { AcceptedRow, Declaration, Mode, ParsedTheme } from "./types";

/** How a mode is named in a finding, both modes now being declared in one `:root` block. */
export const MODE_LABEL: Readonly<Record<Mode, string>> = { light: "light", dark: "dark" };

/** Every top-level block matching `selector`, in source order — the cascade paints them all. */
function blockBodies(css: string, selector: string): { body: string; offset: number }[] {
  const re = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^$()[\]{}|\\]/g, "\\$&")}\\s*\\{`, "gm");
  const out: { body: string; offset: number }[] = [];

  for (const match of css.matchAll(re)) {
    const start = match.index + match[0].length;
    let depth = 1;
    for (let i = start; i < css.length; i++) {
      const ch = css[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          out.push({ body: css.slice(start, i), offset: start });
          break;
        }
      }
    }
  }
  return out;
}

// Depth-aware on the top-level comma alone: an argument is routinely `var(--x)` and may be
// `rgba(0, 0, 0, 0.4)`, whose own commas must not split the value.
/** The two branches of a `light-dark(a, b)` value, or `undefined` when the value is not one. */
export function splitLightDark(value: string): readonly [string, string] | undefined {
  const trimmed = value.trim();
  if (!/^light-dark\s*\(/i.test(trimmed) || !trimmed.endsWith(")")) return undefined;

  const inner = trimmed.slice(trimmed.indexOf("(") + 1, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
  }
  return undefined;
}

// The two maps are derived from one block rather than from two: a `light-dark()` value splits into
// them, and a mode-free value lands in `light` alone, which `resolveStep` already falls back to.
/** Every custom-property declaration in the `:root` block of a stylesheet, split per mode. */
export function parseThemeDeclarations(css: string): ParsedTheme {
  const source = blankComments(css);
  const parsed: ParsedTheme = { light: new Map(), dark: new Map() };

  // Only `:root`, and every `:root`: `@theme inline` re-declares these names as `var(--token)`
  // aliases, and a later block overwrites an earlier one, which is what the cascade paints.
  for (const block of blockBodies(source, ":root")) {
    const lineBase = lineAt(source, block.offset);
    for (const match of block.body.matchAll(/(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:\s*([^;}]+)[;}]?/g)) {
      const property = match[1];
      const raw = match[2];
      if (property === undefined || raw === undefined) continue;
      const value = raw.trim().replace(/\s+/g, " ");
      const line = lineBase + lineAt(block.body, match.index) - 1;
      const branches = splitLightDark(value);
      parsed.light.set(property, { value: branches?.[0] ?? value, line });
      if (branches !== undefined) parsed.dark.set(property, { value: branches[1], line });
      else parsed.dark.delete(property);
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
        `\`${row.token}\` is written with \`light-dark()\` — the semantic layer is mode-free, and only a role step may differ by mode. A step means the same thing in both modes, so re-point \`${row.step}\` instead of giving the token two values`,
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
  // Only a per-mode step lands in `dark`, so a step written as one value holds in dark too.
  return parsed[mode].get(step) ?? (mode === "dark" ? parsed.light.get(step) : undefined);
}

/** Whether a custom-property name matches the `--{scale}-{step}` role-step shape. */
export function isRoleStep(property: string): boolean {
  return /^--[a-z]+-(a?\d{1,2}|contrast)$/.test(property);
}

/** Fails every per-mode declaration that is not itself a role step. */
export function checkDarkHoldsOnlySteps(parsed: ParsedTheme, file: string): Finding[] {
  const findings: Finding[] = [];
  for (const [property, declared] of parsed.dark) {
    if (isRoleStep(property)) continue;
    findings.push(
      finding(
        at(declared, file),
        declared.line,
        `\`${property}\` is written with \`light-dark()\`, and only a role step may differ by mode — a step means the same thing in both modes, so the mode difference belongs in the step it resolves through, not here. Give \`${property}\` one value and re-point its step`,
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
      const label = MODE_LABEL[mode];
      if (declared === undefined) {
        findings.push(
          finding(
            file,
            1,
            `\`${row.step}\` is an accepted exemption for \`${row.token}\` but is declared nowhere — an exemption must name a real step`,
          ),
        );
        continue;
      }
      if (declared.value !== row.value[mode]) {
        findings.push(
          finding(
            at(declared, file),
            declared.line,
            `\`${row.step}\` (${label}) is \`${declared.value}\` but the exemption records \`${row.value[mode]}\` for \`${row.token}\` — the exemption states what this measures (${row.measured}), so a changed value invalidates it`,
          ),
        );
      }
    }
  }
  return findings;
}
