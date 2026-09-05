import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { fail } from "../finding";
import { checkContrast, type ContrastCheckConfig } from "./contrast";

const CRITERIA = { "aa-text": { floor: 4.5, name: "WCAG 2.2 AA text" } };

const PAIRS = [{ token: "body text", criterion: "aa-text", foreground: { token: "--ink" }, background: { token: "--surface" } }];

/** A stylesheet directory holding one token file, for the check to read. `light` is the foreground
 *  the light mode resolves to; the dark mode is always white on black, well clear of every floor. */
function fixture(light: string, extra = ""): ContrastCheckConfig {
  const css = [
    ":root {",
    "  --gray-1: light-dark(#ffffff, #000000);",
    `  --gray-12: light-dark(${light}, #ffffff);`,
    "  --ink: var(--gray-12);",
    "  --surface: var(--gray-1);",
    "}",
    extra,
  ].join("\n");
  const dir = mkdtempSync(resolve(tmpdir(), "forge-contrast-"));
  writeFileSync(resolve(dir, "theme.css"), css, "utf-8");
  return { root: dir, cssDir: ".", tokenFiles: ["theme.css"], mappingFile: "mapping.css", pairs: PAIRS, criteria: CRITERIA };
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
    const result = checkContrast(fixture("#000000", ".dark {\n  --ink: #ffffff;\n}"));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message.startsWith("declares --ink under `.dark`")).toBe(true);
  });

  it("leaves a class merely prefixed `dark` alone — `.dark-overlay` is not a mode block", () => {
    const result = checkContrast(fixture("#000000", ".dark-overlay {\n  --scrim: #00000080;\n}"));

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
