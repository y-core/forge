import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fail } from "../../../src/tooling/gate/finding";
import plugin from "../../../src/tooling/lint/plugin";
import { checkDesign } from "./design";

/** Every rule the plugin registers, turned on — so nothing but the parse itself can fail the config. */
function oxlintConfig(trailing: string): string {
  const rules = Object.keys(plugin.rules)
    .map((key) => `    "forge/${key}": "error"${trailing}`)
    .join("\n");
  return `{\n  "rules": {\n${rules.replace(/,$/, "")}\n  }\n}\n`;
}

/** A throwaway root carrying only the oxlint config the check reads. */
function root(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-design-check-"));
  mkdirSync(join(dir, "design"), { recursive: true });
  mkdirSync(join(dir, "css"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  // The corpus may not be empty, or the check refuses before it ever reads the config.
  writeFileSync(join(dir, "design", "floor.md"), "# Floor\n\nOne rule, stated in prose.\n", "utf-8");
  // Nor may the source walk: the corpus registers rules and these are what they are enforced
  // against, so the check refuses an empty `src` for the same reason — and would then report no
  // config finding at all, making all three cases below pass without reading a config.
  writeFileSync(join(dir, "src", "ok.tsx"), "export const Ok = () => null;\n", "utf-8");
  writeFileSync(join(dir, ".oxlintrc.json"), config, "utf-8");
  return dir;
}

/** Only the findings the oxlint config itself is blamed for. */
function configFindings(source: string): string[] {
  const result = checkDesign({
    root: root(source),
    packageName: "@y-core/forge",
    exports: {},
    designDir: "design",
    cssDir: "css",
    sourceDir: "src",
  });
  return result.findings.filter((finding) => finding.file === ".oxlintrc.json").map((finding) => finding.message);
}

describe("checkDesign() — reading the oxlint config", () => {
  it("resolves the enabled rules from a config with no comments", () => {
    expect(configFindings(oxlintConfig(","))).toEqual([]);
  });

  it("resolves them from a config carrying a trailing `//` comment, which is JSONC and not JSON", () => {
    expect(configFindings(oxlintConfig(", // the rule this repo cares about"))).toEqual([]);
  });

  it("reports a config that is genuinely unparseable rather than guessing at its rules", () => {
    expect(configFindings("{ not json")).toEqual(["could not be read, so no plugin rule could be held against it"]);
  });
});

describe("checkDesign() — the two vacuity refusals", () => {
  /** The same throwaway root, minus whichever half the case is about. */
  function tree(options: { corpus: boolean; sources: boolean }): string {
    const dir = mkdtempSync(join(tmpdir(), "forge-design-vacuity-"));
    mkdirSync(join(dir, "design"), { recursive: true });
    mkdirSync(join(dir, "css"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    if (options.corpus) writeFileSync(join(dir, "design", "floor.md"), "# Floor\n", "utf-8");
    if (options.sources) writeFileSync(join(dir, "src", "ok.tsx"), "export const Ok = () => null;\n", "utf-8");
    writeFileSync(join(dir, ".oxlintrc.json"), oxlintConfig(","), "utf-8");
    return dir;
  }

  const check = (dir: string) =>
    checkDesign({ root: dir, packageName: "@y-core/forge", exports: {}, designDir: "design", cssDir: "css", sourceDir: "src" });

  it("refuses an empty corpus, which is the half that registers the rules", () => {
    const result = check(tree({ corpus: false, sources: true }));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`design` matched no markdown — refusing to report a green design gate that scanned nothing")]);
  });

  it("refuses an empty source walk, which is the half the rules are enforced against", () => {
    const result = check(tree({ corpus: true, sources: false }));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src` matched no `.tsx` source — refusing to report a green design gate that scanned nothing")]);
  });
});

describe("checkDesign() — the plugin rules that state no corpus rule", () => {
  /** Every finding blaming the plugin for a rule no register routes to. */
  function unroutedRules(): string[] {
    const result = checkDesign({
      root: root(oxlintConfig(",")),
      packageName: "@y-core/forge",
      exports: {},
      designDir: "design",
      cssDir: "css",
      sourceDir: "src",
    });
    return result.findings.filter((finding) => finding.file === "lint.ts").map((finding) => finding.message);
  }

  it("routes every registered rule, so the two contract rules are exempt by name rather than by accident", () => {
    expect(unroutedRules()).toEqual([]);
  });
});
