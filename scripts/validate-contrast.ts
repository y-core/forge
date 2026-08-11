/** validate-contrast.ts — holds `theme-base.css`'s stop mapping to the contrast audit it was
 *  measured under.
 *
 *  Thin by design: every pattern and every pure decision lives in `contrast-parse.ts`, which is where
 *  the contract, the measured ratios, and the procedure for re-deriving them are written down. This
 *  file walks the stylesheets, prints, and returns a verdict.
 *
 *  **What a green here means.** The mapping on disk is still the mapping every recorded ratio was
 *  measured against. It is *not* a re-measurement — Tailwind is the consuming app's dependency, not
 *  forge's, so no colour arithmetic runs here. See `contrast-parse.ts`'s header for why pinning the
 *  mapping is nonetheless the complete check, and for the manual procedure that re-derives the
 *  numbers when a row legitimately has to move.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTED,
  checkAccepted,
  checkContract,
  checkDarkHoldsOnlySteps,
  MODE_SELECTOR,
  mergeThemes,
  parseThemeDeclarations,
  TOKEN_CONTRACT,
} from "./contrast-parse";
import { type Finding, formatFinding } from "./design-parse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_DIR = "src/ui/assets/css";

/** The token layer, in the order `forge.css` imports it.
 *
 * A contract row spans these files — `--muted-foreground` is declared in the mapping while the
 * `--gray-11` it resolves through is declared in the scheme — so the audit reads them as one
 * cascade. Listing them in import order is what makes "later wins" mean the same thing here as in
 * the browser. */
const TOKEN_FILES = ["theme-neutral.css", "theme-colors.css", "theme-base.css"].map((name) => `${CSS_DIR}/${name}`);
/** The mapping file, singled out because one check is about it specifically. */
const MAPPING = `${CSS_DIR}/theme-base.css`;

let failures = 0;

function failFinding(finding: Finding): void {
  console.error(`FAIL ${formatFinding(finding)}`);
  failures++;
}

function fail(file: string, message: string): void {
  console.error(`FAIL ${file}: ${message}`);
  failures++;
}

/** Runs every check and returns the exit code rather than exiting, so a test can import this module,
 *  call it, and read the verdict without the runner dying. Nothing above this line reads a file. */
export function main(): number {
  failures = 0;

  // Empty-set guards, taken before anything is read. A contract with no rows would check nothing and
  // report the same green as a contract that checked everything — the posture `selectSteps` takes
  // when a gate selects no steps, and `validate-design` takes on an empty corpus.
  if (TOKEN_CONTRACT.length === 0) {
    fail("scripts/contrast-parse.ts", "TOKEN_CONTRACT is empty — refusing to report a green contrast gate that checked no token");
    console.error("\n1 problem found.");
    return 1;
  }
  if (ACCEPTED.length === 0) {
    fail(
      "scripts/contrast-parse.ts",
      "ACCEPTED is empty — the decorative exemptions are part of the audit, and an empty table means they stopped being re-checked",
    );
    console.error("\n1 problem found.");
    return 1;
  }

  for (const file of TOKEN_FILES) {
    if (existsSync(resolve(ROOT, file))) continue;
    fail(file, "a token file is missing — the audit reads the whole layer, so a gap in it is not something to work around");
    console.error("\n1 problem found.");
    return 1;
  }

  console.log(`Checking the token layer (${TOKEN_FILES.map((f) => f.split("/").pop()).join(", ")})...`);

  const sheets = TOKEN_FILES.map((file) => ({ file, parsed: parseThemeDeclarations(readFileSync(resolve(ROOT, file), "utf-8")) }));
  const parsed = mergeThemes(sheets);
  for (const mode of ["light", "dark"] as const) {
    if (parsed[mode].size > 0) continue;
    fail(CSS_DIR, `no custom properties parsed from any \`${MODE_SELECTOR[mode]}\` block — the mapping cannot be verified`);
  }

  for (const finding of checkContract(parsed, TOKEN_CONTRACT, MAPPING)) failFinding(finding);
  for (const finding of checkAccepted(parsed, ACCEPTED, MAPPING)) failFinding(finding);

  // Whole-layer, and unscoped to the contract on purpose: the token that comes back first is the one
  // no row is watching. Runs before the summary so a green `ok` list never prints over an
  // architecture failure.
  for (const finding of checkDarkHoldsOnlySteps(parsed, MAPPING)) failFinding(finding);

  // ── The mapping file declares no mode at all ───────────────────────────────────────────────────
  //
  // Stronger than the per-token rule above and stated separately because it is a property of the
  // *file* rather than of any token in it: `theme-base.css` says which step a role reaches for, and
  // that answer cannot depend on the mode. A `.dark` block appearing there at all means someone
  // reached for the old shape, and it would be invisible to every check that only knows about tokens
  // it already audits.
  const mapping = sheets.find((sheet) => sheet.file === MAPPING);
  if (mapping !== undefined && mapping.parsed.dark.size > 0) {
    fail(
      MAPPING,
      `declares ${mapping.parsed.dark.size} propert${mapping.parsed.dark.size === 1 ? "y" : "ies"} under \`.dark\` — the mapping layer is mode-free by construction, and a mode-varying value belongs in a scheme file (${CSS_DIR}/theme-neutral.css) or in ${CSS_DIR}/theme-colors.css`,
    );
  }

  if (failures === 0) {
    for (const row of TOKEN_CONTRACT) {
      console.log(
        `  ok ${row.token} → ${row.step} — ${row.light.value} (${row.light.ratio.toFixed(2)}:1) / ${row.dark.value} (${row.dark.ratio.toFixed(2)}:1)`,
      );
    }
    for (const row of ACCEPTED) console.log(`  ok ${row.token} → ${row.step} — exempt (decorative): ${row.measured}`);
  }

  // ── A theme file that overrides an audited token re-opens the audit ────────────────────────────
  //
  // A scheme file re-declares the twelve gray steps and nothing else. Anything beyond that is a
  // *second* mapping the contract above never measured, and the failure mode is not hypothetical:
  // the deleted `theme-zinc.css` overrode `--warning-foreground` in its `:root`, which — both
  // selectors weighing 0-1-0, and that file importing after `theme-base.css` — beat the base's
  // `.dark` twin in **both** modes and shipped a 2.77:1 pair for as long as the file existed.
  // This check is what makes the next such override visible before it ships.
  //
  // The **steps** are watched alongside the tokens, and they are the more dangerous half. Overriding
  // `--warning-foreground` in a theme file is at least legible as a colour decision; overriding
  // `--gray-11` re-points every token that resolves through step 11 at once, which is exactly what a
  // step is for and exactly why it must not happen quietly.
  console.log("\nChecking scheme files re-declare the scale and nothing else...");

  const audited = new Set([...TOKEN_CONTRACT.flatMap((row) => [row.token, row.step]), ...ACCEPTED.flatMap((row) => [row.token, row.step])]);
  // The token layer itself is excluded: `theme-neutral.css` and `theme-colors.css` *are* the audit's
  // input, so reporting them as overrides of themselves would be noise. What is left is exactly the
  // alternative schemes a consumer chooses between.
  const themes = readdirSync(resolve(ROOT, CSS_DIR))
    .filter((name) => name.startsWith("theme-") && name.endsWith(".css") && !TOKEN_FILES.includes(`${CSS_DIR}/${name}`))
    .sort();

  if (themes.length === 0) {
    fail(CSS_DIR, "no alternative scheme files found — forge ships two beside the default, and an empty set means this check ran on nothing");
  }

  for (const name of themes) {
    const file = `${CSS_DIR}/${name}`;
    const theme = parseThemeDeclarations(readFileSync(resolve(ROOT, CSS_DIR, name), "utf-8"));
    const overrides: string[] = [];
    for (const mode of ["light", "dark"] as const) {
      for (const token of theme[mode].keys()) {
        if (audited.has(token)) overrides.push(`${token} (${MODE_SELECTOR[mode]})`);
      }
    }
    // A scheme re-declaring an audited *step* is expected — that is what a scheme is. What it must
    // not do is re-declare an audited *token*, which would put a mode-varying answer back at the
    // mapping layer by the side door. So the two are reported differently.
    const tokens = overrides.filter((entry) => !entry.startsWith("--gray-"));
    if (tokens.length > 0)
      console.log(`  note ${file} overrides ${tokens.join(", ")} — beyond the scale, so re-audit against this scheme's values`);
    else if (overrides.length > 0) console.log(`  ok ${file} (re-declares the scale: ${overrides.length} audited steps)`);
    else console.log(`  ok ${file} (declares no audited step)`);
  }

  if (failures > 0) {
    console.error(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
    console.error("A pinned value is what its recorded ratio was measured against. Re-derive the ratio");
    console.error("(procedure in scripts/contrast-parse.ts) and update the row, or restore the value.");
    return 1;
  }

  console.log(
    `\nContrast mapping verified (${TOKEN_CONTRACT.length} audited tokens, ${ACCEPTED.length} recorded exemptions, ${themes.length} ramps).`,
  );
  return 0;
}

if (import.meta.main) process.exit(main());
