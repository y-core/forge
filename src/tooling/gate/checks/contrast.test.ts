import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { fail } from "../finding";
import { checkContrast, resolveColor } from "./contrast";
import type { AcceptedRow, ContrastCheckConfig, ContrastPairInput, ParsedTheme } from "./types";

const CRITERIA = { "aa-text": { floor: 4.5, name: "WCAG 2.2 AA text" } };

const PAIRS = [{ token: "body text", criterion: "aa-text", foreground: { token: "--ink" }, background: { token: "--surface" } }];

/** What a fixture may add beyond the one token file: the rules past the floor each need one. */
interface FixtureOptions {
  /** Appended to `theme.css`, after the `:root` block. */
  extra?: string;
  /** Written as `mapping.css` and read as the mapping layer, which is where its own rule looks. */
  mapping?: string;
  /** Written into the stylesheet directory by name; a `theme-*.css` is picked up as a scheme. */
  files?: Readonly<Record<string, string>>;
  accepted?: readonly AcceptedRow[];
  tokenFiles?: readonly string[];
  pairs?: readonly ContrastPairInput[];
}

/** A stylesheet directory holding one token file, for the check to read. */
function fixture(light: string, options: FixtureOptions = {}): ContrastCheckConfig {
  const css = [
    ":root {",
    "  --gray-1: light-dark(#ffffff, #000000);",
    `  --gray-12: light-dark(${light}, #ffffff);`,
    "  --ink: var(--gray-12);",
    "  --surface: var(--gray-1);",
    "}",
    options.extra ?? "",
  ].join("\n");
  const dir = mkdtempSync(resolve(tmpdir(), "forge-contrast-"));
  writeFileSync(resolve(dir, "theme.css"), css, "utf-8");
  if (options.mapping !== undefined) writeFileSync(resolve(dir, "mapping.css"), options.mapping, "utf-8");
  for (const [name, source] of Object.entries(options.files ?? {})) writeFileSync(resolve(dir, name), source, "utf-8");

  return {
    root: dir,
    cssDir: ".",
    tokenFiles: options.tokenFiles ?? (options.mapping === undefined ? ["theme.css"] : ["theme.css", "mapping.css"]),
    mappingFile: "mapping.css",
    pairs: options.pairs ?? PAIRS,
    criteria: CRITERIA,
    ...(options.accepted === undefined ? {} : { accepted: options.accepted }),
  };
}

describe("checkContrast() — the floor", () => {
  it("fails a pair below the floor that rounds up to it, which the customiser also fails", () => {
    // 4.4994:1 — `toFixed(2)` prints it as 4.50, so the message reads as a near-miss and the
    // verdict must still be red. Rounding before the comparison is what made the two disagree.
    const result = checkContrast(fixture("#158a00"));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toBe("body text (light) measures 4.50:1 against a 4.5:1 floor — WCAG 2.2 AA text. #158a00 on #ffffff");
  });

  it("passes a pair exactly on the floor", () => {
    const result = checkContrast(fixture("#767676"));

    expect(result.findings).toEqual([]);
  });
});

describe("checkContrast() — the `.dark` declaration-site rule", () => {
  it("fails a `.dark` block that declares a custom property", () => {
    const result = checkContrast(fixture("#000000", { extra: ".dark {\n  --ink: #ffffff;\n}" }));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message.startsWith("declares --ink under `.dark`")).toBe(true);
  });

  it("leaves a class merely prefixed `dark` alone — `.dark-overlay` is not a mode block", () => {
    const result = checkContrast(fixture("#000000", { extra: ".dark-overlay {\n  --scrim: #00000080;\n}" }));

    expect(result.findings).toEqual([]);
  });
});

describe("checkContrast() — the vacuity refusal", () => {
  it("refuses an empty pair list, which is a configuration that measures nothing", () => {
    const result = checkContrast({ ...fixture("#158a00"), pairs: [] });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("no audited pairs — refusing to report a green contrast gate that measured nothing")]);
    expect(result.summary).toBe("");
  });

  it("measures two rows per pair, so the count is only ever zero when the pair list is", () => {
    const result = checkContrast(fixture("#158a00"));

    expect(result.summary).toBe("2 measurements over 1 pairs, 0 exemptions, 0 schemes.");
  });
});

describe("checkContrast() — the missing-token-file refusal", () => {
  it("refuses a configured token file that is not on disk, rather than auditing the rest", () => {
    const result = checkContrast(fixture("#767676", { tokenFiles: ["theme.css", "gone.css"] }));

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect({ file: result.findings[0]?.file, message: result.findings[0]?.message }).toEqual({
      file: "gone.css",
      message: "a token file is missing — the audit reads the whole layer, so a gap in it is not something to work around",
    });
  });
});

describe("checkContrast() — the unresolved-colour finding", () => {
  const ghost = [{ token: "ghost text", criterion: "aa-text", foreground: { token: "--ghost" }, background: { token: "--surface" } }];

  it("reports a pair whose token no stylesheet declares, in both modes", () => {
    const result = checkContrast(fixture("#767676", { pairs: ghost }));

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "ghost text (light): foreground `--ghost` is declared in no stylesheet",
      "ghost text (dark): foreground `--ghost` is declared in no stylesheet",
    ]);
  });
});

describe("resolveColor", () => {
  const theme = (light: Record<string, string>): ParsedTheme => ({
    light: new Map(Object.entries(light).map(([property, value]) => [property, { value, line: 1, file: "theme.css" }])),
    dark: new Map(),
  });

  it("refuses a token declared in no stylesheet, naming the token itself", () => {
    expect(resolveColor("--ink", "light", theme({}), new Map())).toEqual({ token: "--ink", at: "--ink", reason: "is declared in no stylesheet" });
  });

  it("refuses a chain that reaches a hop no stylesheet declares, naming the hop", () => {
    expect(resolveColor("--ink", "light", theme({ "--ink": "var(--gray-12)" }), new Map())).toEqual({
      token: "--ink",
      at: "--gray-12",
      reason: "resolves through `--gray-12`, which is declared in no stylesheet",
    });
  });

  it("refuses a value that is no colour a browser could paint", () => {
    expect(resolveColor("--ink", "light", theme({ "--ink": "inherit" }), new Map())).toEqual({
      token: "--ink",
      at: "--ink",
      reason: "resolves to `inherit`, which is neither a hex literal, an `oklch()` nor a single `var()`",
    });
  });

  it("refuses a cycle at the hop cap rather than following it forever", () => {
    const cyclic = theme({ "--a": "var(--b)", "--b": "var(--a)" });

    expect(resolveColor("--a", "light", cyclic, new Map())).toEqual({
      token: "--a",
      at: "--a",
      reason: "resolves through more than eight indirections — the chain is cyclic",
    });
  });

  it("paints a three-digit hex, an `oklch()` and a palette entry the theme does not hold", () => {
    const palette = new Map([["--color-red-500", "#ff0000"]]);

    expect(resolveColor("--a", "light", theme({ "--a": "#FFF" }), new Map())).toBe("#ffffff");
    expect(resolveColor("--a", "light", theme({ "--a": "oklch(0% 0 0)" }), new Map())).toBe("#000000");
    expect(resolveColor("--a", "light", theme({ "--a": "var(--color-red-500)" }), palette)).toBe("#ff0000");
  });
});

describe("checkContrast() — the accepted-exemption table", () => {
  const row: AcceptedRow = {
    token: "--border",
    step: "--gray-6",
    value: { light: "#cccccc", dark: "#333333" },
    measured: "1.24 against --surface",
    reason: "decorative separation only",
  };

  it("reports an exemption naming a step no stylesheet declares", () => {
    const result = checkContrast(fixture("#767676", { extra: ":root { --border: var(--gray-6); }", accepted: [row] }));

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`--gray-6` is an accepted exemption for `--border` but is declared nowhere — an exemption must name a real step",
      "`--gray-6` is an accepted exemption for `--border` but is declared nowhere — an exemption must name a real step",
    ]);
  });

  it("reports an exemption whose recorded value no longer matches the step", () => {
    const declared = ":root { --gray-6: light-dark(#dddddd, #333333); --border: var(--gray-6); }";
    const result = checkContrast(fixture("#767676", { extra: declared, accepted: [row] }));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toStartWith("`--gray-6` (light) is `#dddddd` but the exemption records `#cccccc`");
  });

  it("passes an exemption that still states what the stylesheet says", () => {
    const declared = ":root { --gray-6: light-dark(#cccccc, #333333); --border: var(--gray-6); }";

    expect(checkContrast(fixture("#767676", { extra: declared, accepted: [row] })).findings).toEqual([]);
  });
});

describe("checkContrast() — the mapping layer is mode-free", () => {
  it("reports a mapping file declaring a per-mode value, even one shaped as a role step", () => {
    const result = checkContrast(fixture("#767676", { mapping: ":root { --brand-6: light-dark(#111111, #eeeeee); }" }));

    expect(result.findings).toHaveLength(1);
    expect({ file: result.findings[0]?.file, message: result.findings[0]?.message }).toEqual({
      file: "mapping.css",
      message:
        "declares 1 property under `.dark` — the mapping layer is mode-free by construction, and a mode-varying value belongs in a scheme file",
    });
  });

  it("passes a mapping file whose properties have one value each", () => {
    expect(checkContrast(fixture("#767676", { mapping: ":root { --brand-6: #111111; }" })).findings).toEqual([]);
  });
});

describe("checkContrast() — a scheme may not override an audited token", () => {
  it("reports a scheme re-declaring an audited semantic token", () => {
    const result = checkContrast(fixture("#767676", { files: { "theme-brand.css": ":root { --ink: #222222; }" } }));

    expect(result.findings).toHaveLength(1);
    expect({ file: result.findings[0]?.file, message: result.findings[0]?.message }).toEqual({
      file: "./theme-brand.css",
      message: "overrides audited tokens beyond the scale (--ink) — re-measure against this scheme's values",
    });
  });

  // Re-declaring the grey scale is what a scheme is for, so only a token beyond it is reported.
  it("passes a scheme re-declaring only the grey scale the audit resolves through", () => {
    const result = checkContrast(fixture("#767676", { files: { "theme-brand.css": ":root { --gray-12: #222222; }" } }));

    expect(result.findings).toEqual([]);
  });
});
