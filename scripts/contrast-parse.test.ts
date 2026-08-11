import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTED,
  type AcceptedRow,
  type ContractRow,
  CRITERION,
  checkAccepted,
  checkContract,
  checkDarkHoldsOnlySteps,
  isRoleStep,
  MODE_SELECTOR,
  mergeThemes,
  type ParsedTheme,
  parseThemeDeclarations,
  TOKEN_CONTRACT,
} from "./contrast-parse";
import { RULE_CORPUS_PATH } from "./design-parse";

// Every function here takes a string, so every fixture is written inline — no tmpdir, no disk. The
// exceptions are at the end and are *about* the filesystem: the shipped token layer has to satisfy
// the shipped contract, the shipped mapping file has to carry no mode block, and the rule id has to
// route somewhere real.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_DIR = "src/ui/assets/css";
/** The mapping file — the sheet a finding is attributed to when nothing more specific declared the
 *  value, and the one file the mode-free invariant is a property *of*. */
const FILE = `${CSS_DIR}/theme-base.css`;

/**
 * The token layer, in the order `forge.css` imports it — the same list `validate-contrast.ts` walks.
 *
 * A contract row spans these files: `--muted-foreground` is declared in the mapping while the
 * `--gray-11` it resolves through is declared in the scheme, and `--red-9` in the hues. Reading any
 * one of them alone would report every step of the other two as undeclared, so the shipped checks
 * below merge all three.
 */
const TOKEN_FILES = ["theme-neutral.css", "theme-colors.css", "theme-base.css"].map((name) => `${CSS_DIR}/${name}`);

/** The shipped token layer, parsed and merged exactly as the runner does it. */
function shippedTokenLayer(): ParsedTheme {
  return mergeThemes(TOKEN_FILES.map((file) => ({ file, parsed: parseThemeDeclarations(readFileSync(resolve(ROOT, file), "utf-8")) })));
}

/** A minimal two-block stylesheet: a mode-free semantic layer and a role step in `:root`, and the
 *  same step re-declared in `.dark`. That is the shape the token layer has once merged — no single
 *  shipped file has it any more, since the scheme carries the two blocks and the mapping carries
 *  only `:root`. The `--palette-*` values are synthetic, and deliberately name nothing forge ships. */
function sheet(light: string, dark: string): string {
  return `:root {\n${light}\n}\n\n.dark {\n${dark}\n}\n`;
}

/** The default fixture's `:root` half — step on line 2, semantic token on line 3. */
const LIGHT = "  --gray-7: var(--palette-500);\n  --input: var(--gray-7);";
/** …and its `.dark` half, on line 7. */
const DARK = "  --gray-7: var(--palette-400);";

/** One contract row, pinned to whatever the caller wants to prove. */
function row(over: Partial<ContractRow> = {}): ContractRow {
  return {
    token: "--input",
    role: "the sole boundary of every text field",
    step: "--gray-7",
    light: { value: "var(--palette-500)", ratio: 4.34, against: "--background", criterion: "1.4.11" },
    dark: { value: "var(--palette-400)", ratio: 3.94, against: "--muted", criterion: "1.4.11" },
    ...over,
  };
}

/** One accepted row, likewise. */
function accepted(over: Partial<AcceptedRow> = {}): AcceptedRow {
  return {
    token: "--border",
    step: "--gray-6",
    value: { light: "var(--palette-400)", dark: "var(--palette-700)" },
    measured: "2.48 on --card in light; 1.42 on --card in dark",
    reason: "decorative separation only — it identifies no control and reports no state",
    ...over,
  };
}

// ── parseThemeDeclarations() ──────────────────────────────────────────────────────────────────

describe("parseThemeDeclarations() — the two mode blocks", () => {
  it("parses `:root` and `.dark` separately, so the same token carries a different value per mode", () => {
    const parsed = parseThemeDeclarations(sheet("  --input: var(--palette-500);", "  --input: var(--palette-400);"));

    expect(parsed.light.get("--input")).toEqual({ value: "var(--palette-500)", line: 2 });
    expect(parsed.dark.get("--input")).toEqual({ value: "var(--palette-400)", line: 6 });
  });

  it("collapses internal whitespace in a value but reports the line it was written on", () => {
    const parsed = parseThemeDeclarations(sheet("  --ring:      var(--palette-600);", "  --ring: var(--palette-300);"));

    expect(parsed.light.get("--ring")).toEqual({ value: "var(--palette-600)", line: 2 });
  });

  it("ignores a commented-out declaration, and the comment does not shift the lines after it", () => {
    const parsed = parseThemeDeclarations(
      sheet("  /* --input: var(--palette-400); */\n  --input: var(--palette-500);", "  --input: var(--palette-400);"),
    );

    expect(parsed.light.get("--input")).toEqual({ value: "var(--palette-500)", line: 3 });
  });

  it("reads neither `@theme inline` nor a nested block, so a token's value is never its own alias", () => {
    const css = `${sheet("  --input: var(--palette-500);", "  --input: var(--palette-400);")}
@theme inline {
  --color-input: var(--input);
}
@layer components {
  .thing { color: red; }
}
`;
    const parsed = parseThemeDeclarations(css);

    expect(parsed.light.get("--input")).toEqual({ value: "var(--palette-500)", line: 2 });
    expect(parsed.light.get("--color-input")).toBeUndefined();
  });

  it("returns empty maps for a stylesheet that declares neither block", () => {
    const parsed = parseThemeDeclarations(".thing { color: red; }");

    expect([...parsed.light.keys()]).toEqual([]);
    expect([...parsed.dark.keys()]).toEqual([]);
  });
});

// ── mergeThemes() ─────────────────────────────────────────────────────────────────────────────

describe("mergeThemes() — several sheets read as one cascade", () => {
  it("lets a later file win, and stamps each declaration with the file it came from", () => {
    const scheme = parseThemeDeclarations(sheet("  --gray-10: #838383;", "  --gray-10: #7b7b7b;"));
    const override = parseThemeDeclarations(sheet("  --gray-10: #808080;", ""));

    const merged = mergeThemes([
      { file: "theme-neutral.css", parsed: scheme },
      { file: "theme-slate.css", parsed: override },
    ]);

    expect(merged.light.get("--gray-10")).toEqual({ value: "#808080", line: 2, file: "theme-slate.css" });
    // Untouched by the later file, so it keeps the earlier one's stamp — which is what makes a
    // finding point at the file that actually declared the value rather than at the last one read.
    expect(merged.dark.get("--gray-10")).toEqual({ value: "#7b7b7b", line: 6, file: "theme-neutral.css" });
  });

  it("merges each mode independently, so a `:root`-only file adds nothing to `.dark`", () => {
    const scheme = parseThemeDeclarations(sheet("  --gray-1: #f9f9f9;", "  --gray-1: #111111;"));
    const mapping = parseThemeDeclarations(sheet("  --background: var(--gray-1);", ""));

    const merged = mergeThemes([
      { file: "theme-neutral.css", parsed: scheme },
      { file: "theme-base.css", parsed: mapping },
    ]);

    expect([...merged.light.keys()]).toEqual(["--gray-1", "--background"]);
    expect([...merged.dark.keys()]).toEqual(["--gray-1"]);
  });

  it("returns empty maps for no parts at all", () => {
    const merged = mergeThemes([]);

    expect([...merged.light.keys()]).toEqual([]);
    expect([...merged.dark.keys()]).toEqual([]);
  });

  it("resolves a contract row that spans two files, and points the failure at the declaring one", () => {
    // The whole reason the merge exists: the token is in the mapping, the step is in the scheme, and
    // neither file alone can answer the row. The `FILE` argument names the mapping, so a finding
    // attributed to the scheme proves the stamp is what decided it.
    const scheme = parseThemeDeclarations(sheet("  --gray-7: var(--palette-400);", "  --gray-7: var(--palette-400);"));
    const mapping = parseThemeDeclarations(sheet("  --input: var(--gray-7);", ""));
    const parsed = mergeThemes([
      { file: `${CSS_DIR}/theme-neutral.css`, parsed: scheme },
      { file: FILE, parsed: mapping },
    ]);

    expect(checkContract(parsed, [row()], FILE)).toEqual([
      {
        file: `${CSS_DIR}/theme-neutral.css`,
        line: 2,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--gray-7` (:root) is `var(--palette-400)` but the contract pins `var(--palette-500)` — that mapping is what 4.34:1 against --background was measured against, and WCAG 1.4.11 needs 3:1 here for `--input` (the sole boundary of every text field). Re-measure and update TOKEN_CONTRACT, or restore the value",
      },
    ]);
  });
});

// ── checkContract() ───────────────────────────────────────────────────────────────────────────

describe("checkContract() — the mapping against the contract", () => {
  it("reports nothing when the token resolves through its step and both modes match the pinned values", () => {
    const parsed = parseThemeDeclarations(sheet(LIGHT, DARK));

    expect(checkContract(parsed, [row()], FILE)).toEqual([]);
  });

  it("fails a changed step, naming the declared value, the pinned value, the floor and the token it protects", () => {
    const parsed = parseThemeDeclarations(sheet("  --gray-7: var(--palette-400);\n  --input: var(--gray-7);", DARK));

    expect(checkContract(parsed, [row()], FILE)).toEqual([
      {
        file: FILE,
        line: 2,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--gray-7` (:root) is `var(--palette-400)` but the contract pins `var(--palette-500)` — that mapping is what 4.34:1 against --background was measured against, and WCAG 1.4.11 needs 3:1 here for `--input` (the sole boundary of every text field). Re-measure and update TOKEN_CONTRACT, or restore the value",
      },
    ]);
  });

  it("fails a token re-pointed at a different step, because the ratios were measured against the old one", () => {
    const parsed = parseThemeDeclarations(sheet("  --gray-7: var(--palette-500);\n  --input: var(--gray-6);", DARK));

    expect(checkContract(parsed, [row()], FILE)).toEqual([
      {
        file: FILE,
        line: 3,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--input` is `var(--gray-6)` but the contract resolves it through `var(--gray-7)` — the ratios below were measured against that step, so re-point the token or move the row to the step it now uses",
      },
    ]);
  });

  it("fails an audited token that reappears in `.dark`, whatever it is set to there", () => {
    // The architecture check. The value below is the *correct* one for dark, and it still fails: a
    // mode-specific answer at the semantic layer is the beginning of the drift the layer removes,
    // not merely a wrong colour.
    const parsed = parseThemeDeclarations(sheet(LIGHT, `${DARK}\n  --input: var(--palette-400);`));

    expect(checkContract(parsed, [row()], FILE)).toEqual([
      {
        file: FILE,
        line: 8,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--input` is declared in `.dark` — the semantic layer is mode-free, and `.dark` carries role steps only. A step means the same thing in both modes, so re-point `--gray-7` instead of overriding the token",
      },
    ]);
  });

  it("reads a step declared only in `:root` as holding in dark too, because that is what the cascade does", () => {
    // `--yellow-contrast` is the shipped case: near-white on yellow-500 measures 1.83, so the pair
    // darkens the foreground in *both* modes and one declaration says so.
    const parsed = parseThemeDeclarations(sheet("  --gray-7: var(--palette-500);\n  --input: var(--gray-7);", "  --gray-1: var(--palette-900);"));
    const modeFree = row({ dark: { value: "var(--palette-500)", ratio: 3.94, against: "--muted", criterion: "1.4.11" } });

    expect(checkContract(parsed, [modeFree], FILE)).toEqual([]);
  });

  it("fails a token and a step that are declared in neither block, separately", () => {
    const parsed = parseThemeDeclarations(sheet("  --border: var(--palette-400);", "  --border: var(--palette-700);"));

    expect(checkContract(parsed, [row()], FILE)).toEqual([
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail: "`--input` is not declared in `:root` — the contract resolves it through `var(--gray-7)`",
      },
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail: "`--gray-7` is not declared in `:root` — the contract pins it to `var(--palette-500)` for `--input`",
      },
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail: "`--gray-7` is not declared in `.dark` — the contract pins it to `var(--palette-400)` for `--input`",
      },
    ]);
  });

  it("fails a row pinned below its own criterion's floor, even though the stylesheet agrees with it", () => {
    // The stylesheet matches the pin exactly, so only the contract-against-itself check can fire.
    // This is what stops a failing colour being "fixed" by editing the recorded ratio down.
    const parsed = parseThemeDeclarations(sheet("  --gray-7: var(--palette-400);\n  --input: var(--gray-7);", DARK));
    const failing = row({ light: { value: "var(--palette-400)", ratio: 2.36, against: "--background", criterion: "1.4.11" } });

    expect(checkContract(parsed, [failing], FILE)).toEqual([
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--input` (:root) is pinned at a measured 2.36:1 against --background, below the 3:1 floor of WCAG 1.4.11 (Non-text Contrast — UI components) — a contract row may not record a failing measurement",
      },
    ]);
  });

  it("holds a text row to 4.5:1 rather than 3:1 — the criterion decides the floor, not the row", () => {
    const parsed = parseThemeDeclarations(
      sheet("  --gray-11: var(--palette-500);\n  --muted-foreground: var(--gray-11);", "  --gray-11: var(--palette-300);"),
    );
    const text = row({
      token: "--muted-foreground",
      role: "supporting text",
      step: "--gray-11",
      light: { value: "var(--palette-500)", ratio: 4.34, against: "--background", criterion: "1.4.3" },
      dark: { value: "var(--palette-300)", ratio: 6.91, against: "--muted", criterion: "1.4.3" },
    });

    expect(checkContract(parsed, [text], FILE)).toEqual([
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--muted-foreground` (:root) is pinned at a measured 4.34:1 against --background, below the 4.5:1 floor of WCAG 1.4.3 (Contrast (Minimum) — text) — a contract row may not record a failing measurement",
      },
    ]);
  });
});

// ── checkAccepted() ───────────────────────────────────────────────────────────────────────────

describe("checkAccepted() — the decorative exemptions, re-checked", () => {
  const acceptedLight = "  --gray-6: var(--palette-400);\n  --border: var(--gray-6);";
  const acceptedDark = "  --gray-6: var(--palette-700);";

  it("reports nothing when the exemption names a real token resolving through its step at the recorded values", () => {
    const parsed = parseThemeDeclarations(sheet(acceptedLight, acceptedDark));

    expect(checkAccepted(parsed, [accepted()], FILE)).toEqual([]);
  });

  it("fails an exemption whose reason is empty, because an unexplained opt-out is just an allowlist", () => {
    const parsed = parseThemeDeclarations(sheet(acceptedLight, acceptedDark));

    expect(checkAccepted(parsed, [accepted({ reason: "   " })], FILE)).toEqual([
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail: "`--border` is in ACCEPTED with an empty reason — an exemption without a stated reason does not hold",
      },
    ]);
  });

  it("fails an exemption that names a token no block declares", () => {
    const parsed = parseThemeDeclarations(sheet(acceptedLight, acceptedDark));

    expect(checkAccepted(parsed, [accepted({ token: "--nonexistent" })], FILE)).toEqual([
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail: "`--nonexistent` is not declared in `:root` — the contract resolves it through `var(--gray-6)`",
      },
    ]);
  });

  it("fails an exemption that names a step no block declares", () => {
    const parsed = parseThemeDeclarations(sheet("  --border: var(--nonexistent);", ""));

    expect(checkAccepted(parsed, [accepted({ step: "--nonexistent" })], FILE)).toEqual([
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail: "`--nonexistent` is in ACCEPTED for `--border` but is declared in no `:root` block — an exemption must name a real step",
      },
      {
        file: FILE,
        line: 1,
        ruleId: "forge-ui-contrast-floor",
        detail: "`--nonexistent` is in ACCEPTED for `--border` but is declared in no `.dark` block — an exemption must name a real step",
      },
    ]);
  });

  it("fails an exemption whose step moved, because the recorded measurement no longer describes it", () => {
    const parsed = parseThemeDeclarations(sheet("  --gray-6: var(--palette-500);\n  --border: var(--gray-6);", acceptedDark));

    expect(checkAccepted(parsed, [accepted()], FILE)).toEqual([
      {
        file: FILE,
        line: 2,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--gray-6` (:root) is `var(--palette-500)` but ACCEPTED records `var(--palette-400)` for `--border` — the exemption states what this measures (2.48 on --card in light; 1.42 on --card in dark), so a changed value invalidates it",
      },
    ]);
  });
});

// ── checkDarkHoldsOnlySteps() ──────────────────────────────────────────────────────────────────

describe("checkDarkHoldsOnlySteps() — `.dark` carries role steps and nothing else", () => {
  it("accepts numbered steps across every namespace, and the functional `-contrast` token", () => {
    const parsed = parseThemeDeclarations(
      sheet(
        "",
        "  --gray-11: var(--palette-300);\n  --red-2: var(--color-red-950);\n  --focus-8: var(--palette-300);\n  --accent-12: var(--palette-200);\n  --red-contrast: var(--palette-950);",
      ),
    );

    expect(checkDarkHoldsOnlySteps(parsed, FILE)).toEqual([]);
  });

  it("fails a semantic token that reappears in `.dark`, and points at the step to re-point instead", () => {
    const parsed = parseThemeDeclarations(sheet("", "  --gray-11: var(--palette-300);\n  --muted-foreground: var(--palette-300);"));

    expect(checkDarkHoldsOnlySteps(parsed, FILE)).toEqual([
      {
        file: FILE,
        // 7, not 8: `sheet("", …)` leaves the `:root` block one blank line rather than two.
        line: 7,
        ruleId: "forge-ui-contrast-floor",
        detail:
          "`--muted-foreground` is declared in `.dark`, which carries role steps only — a step means the same thing in both modes, so the mode difference belongs in the step it resolves through, not here. Declare `--muted-foreground` once in `:root` and re-point its step",
      },
    ]);
  });

  it("fails a compound-named token no contract row watches — the one that would come back first", () => {
    // The whole reason this check is not scoped to `TOKEN_CONTRACT`. `--card-foreground` has no row,
    // so `checkSemanticHop` would never see it, and a `.dark` twin here would be invisible.
    const parsed = parseThemeDeclarations(sheet("", "  --card-foreground: var(--palette-50);\n  --status-danger-subtle: var(--color-red-950);"));

    expect(checkDarkHoldsOnlySteps(parsed, FILE).map((f) => f.detail.slice(0, 44))).toEqual([
      "`--card-foreground` is declared in `.dark`, ",
      "`--status-danger-subtle` is declared in `.da",
    ]);
  });

  it("ignores `:root`, where a semantic token is exactly what belongs", () => {
    const parsed = parseThemeDeclarations(sheet("  --muted-foreground: var(--gray-11);", "  --gray-11: var(--palette-300);"));

    expect(checkDarkHoldsOnlySteps(parsed, FILE)).toEqual([]);
  });
});

describe("isRoleStep() — the name shape that may vary by mode", () => {
  // A plain loop rather than `it.each`: forge types `bun:test` through a custom stub, which declares
  // `it` as a function and not as the callable-with-`.each` object Bun supplies at run time.
  for (const property of ["--gray-1", "--gray-12", "--red-2", "--accent-12", "--yellow-contrast", "--gray-a3", "--gray-a12", "--black-a6"]) {
    it(`accepts ${property}`, () => {
      expect(isRoleStep(property)).toBe(true);
    });
  }

  for (const property of ["--background", "--muted-foreground", "--card-foreground", "--status-danger-subtle", "--radius"]) {
    it(`rejects ${property}`, () => {
      expect(isRoleStep(property)).toBe(false);
    });
  }
});

// ── The shipped tables ────────────────────────────────────────────────────────────────────────

describe("the shipped contract", () => {
  it("holds every row at or above its criterion's floor", () => {
    const below = TOKEN_CONTRACT.flatMap((contractRow) =>
      (["light", "dark"] as const)
        .filter((mode) => contractRow[mode].ratio < CRITERION[contractRow[mode].criterion].floor)
        .map((mode) => `${contractRow.token} (${MODE_SELECTOR[mode]})`),
    );

    expect(below).toEqual([]);
  });

  it("gives every accepted exemption a non-empty reason", () => {
    expect(ACCEPTED.filter((entry) => entry.reason.trim().length === 0).map((entry) => entry.token)).toEqual([]);
  });

  it("names each token once, so no row silently shadows another", () => {
    const tokens = TOKEN_CONTRACT.map((contractRow) => contractRow.token);

    expect(tokens.length).toBe(new Set(tokens).size);
  });

  it("agrees with the stylesheet forge actually ships", () => {
    // The whole token layer, in `forge.css`'s import order — the scheme, then the hues, then the
    // mapping. Reading the mapping alone would report every step as undeclared, because no step is
    // written there any more.
    const parsed = shippedTokenLayer();

    expect(checkContract(parsed, TOKEN_CONTRACT, FILE)).toEqual([]);
    expect(checkAccepted(parsed, ACCEPTED, FILE)).toEqual([]);
  });

  it("routes every row through a step rather than straight at a ramp stop", () => {
    // A row pinning `--palette-*` directly would type-check and pass, and would quietly re-introduce
    // the one-hop mapping the step layer replaced. The step is what carries the mode difference, so
    // a row that skips it has nowhere to put dark mode.
    const unstepped = [...TOKEN_CONTRACT, ...ACCEPTED].filter((entry) => entry.step.startsWith("--palette-")).map((entry) => entry.token);

    expect(unstepped).toEqual([]);
  });

  it("declares no audited token in `.dark` of the shipped stylesheet", () => {
    // The same invariant `checkSemanticHop` enforces per row, asserted once over the shipped layer so
    // the failure reads as "the architecture moved" rather than as one token's contrast regressing.
    // Merged rather than read off the mapping file: `.dark` is a *scheme* block now, so this has to
    // see what the scheme declares or it would pass by looking at an empty map.
    const parsed = shippedTokenLayer();
    const audited = [...TOKEN_CONTRACT, ...ACCEPTED].map((entry) => entry.token);

    expect(audited.filter((token) => parsed.dark.has(token))).toEqual([]);
  });

  it("gives the shipped mapping file no `.dark` block whatsoever", () => {
    // Stronger than the row above and a property of the *file* rather than of any token in it, which
    // is why `validate-contrast.ts` states it as its own file-level check. `theme-base.css` says
    // which step a role reaches for, and that answer cannot depend on the mode — so a `.dark` block
    // appearing there at all is the old shape coming back, whatever it happens to declare.
    const mapping = parseThemeDeclarations(readFileSync(resolve(ROOT, FILE), "utf-8"));

    expect([...mapping.dark.keys()]).toEqual([]);
  });

  it("keeps the audited steps in the scheme and the hues, where the mode difference belongs", () => {
    // The other half of the file above: a mapping with no `.dark` block is only correct if the steps
    // it resolves through are declared somewhere that *has* one. Asserted over the merged layer's
    // dark block, so a step silently dropped from `theme-neutral.css` fails here rather than being
    // read as "light holds in dark" by `resolveStep`'s cascade fallback.
    //
    // `--red-contrast` is the one legitimate exception and is named rather than filtered out: it is
    // `var(--gray-1)` in both modes, so `theme-colors.css` declares it once and the cascade carries
    // it into dark. A second, identical declaration would only be there to satisfy a parser.
    const parsed = shippedTokenLayer();
    const steps = [...new Set([...TOKEN_CONTRACT, ...ACCEPTED].map((entry) => entry.step))];

    expect(steps.filter((step) => !parsed.dark.has(step))).toEqual(["--red-contrast"]);
  });

  it("routes `forge-ui-contrast-floor` to a corpus file that exists and states it", () => {
    const corpusPath = RULE_CORPUS_PATH["forge-ui-contrast-floor"];

    expect(existsSync(resolve(ROOT, corpusPath))).toBe(true);
    expect(readFileSync(resolve(ROOT, corpusPath), "utf-8")).toContain("<!-- rule:forge-ui-contrast-floor -->");
  });
});
