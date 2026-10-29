import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fail } from "../../../src/tooling/gate/finding";
import { lintKeyOf } from "../../../src/tooling/lint/design-rules";
import plugin from "../../../src/tooling/lint/plugin";
import { checkDesign } from "./design";

const roots: string[] = [];
afterAll(() => {
  for (const tempRoot of roots) rmSync(tempRoot, { recursive: true, force: true });
});

/** Every rule the plugin registers, turned on — so nothing but the parse itself can fail the config. */
function oxlintConfig(trailing: string): string {
  const rules = Object.keys(plugin.rules)
    .map((key) => `    "forge/${key}": "error"${trailing}`)
    .join("\n");
  return `{\n  "rules": {\n${rules.replace(/,$/, "")}\n  }\n}\n`;
}

function scopedConfig(scoped: string, override: boolean): string {
  const rules = Object.fromEntries(
    Object.keys(plugin.rules)
      .filter((key) => key !== scoped)
      .map((key) => [`forge/${key}`, "error"]),
  );
  const overrides = override ? [{ files: ["**/*.tsx"], rules: { [`forge/${scoped}`]: "error" } }] : [];
  return JSON.stringify({ rules, overrides });
}

const SCOPED = lintKeyOf("forge-ui-no-inline-style");

/** A throwaway root carrying only the oxlint config the check reads. */
function root(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-design-check-"));
  roots.push(dir);
  mkdirSync(join(dir, "design"), { recursive: true });
  mkdirSync(join(dir, "css"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  // The corpus may not be empty, or the check refuses before it ever reads the config.
  writeFileSync(join(dir, "design", "floor.md"), "# Floor\n\nOne rule, stated in prose.\n", "utf-8");
  // Nor may the source walk: the check refuses an empty `src` too, and would then report no config
  // finding at all, making every case below pass without reading a config.
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

  it("counts a rule enabled only inside an `overrides` block as enabled", () => {
    expect(configFindings(scopedConfig(SCOPED, true)).filter((message) => message.includes("is not enabled"))).toEqual([]);
  });

  it("reports the same rule as not enabled when no block turns it on", () => {
    expect(configFindings(scopedConfig(SCOPED, false))).toContain(
      `\`forge/${SCOPED}\` is not enabled — a registered rule that no config turns on reports nothing`,
    );
  });
});

describe("checkDesign() — the two vacuity refusals", () => {
  /** The same throwaway root, minus whichever half the case is about. */
  function tree(options: { corpus: boolean; sources: boolean }): string {
    const dir = mkdtempSync(join(tmpdir(), "forge-design-vacuity-"));
    roots.push(dir);
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

describe("checkDesign() — rule markers", () => {
  it("fails a marker split across lines, which the line-by-line reader would drop from the defined set", () => {
    const dir = root(oxlintConfig(","));
    writeFileSync(join(dir, "design", "floor.md"), "# Floor\n\nProse. <!--\nrule:forge-ui-focus-ring --> Override never.\n", "utf-8");
    const result = checkDesign({ root: dir, packageName: "@y-core/forge", exports: {}, designDir: "design", cssDir: "css", sourceDir: "src" });

    expect(result.ok).toBe(false);
    expect(result.findings.filter((finding) => finding.file?.endsWith("floor.md")).map(({ message, line }) => ({ message, line }))).toEqual([
      {
        message:
          "rule marker `forge-ui-focus-ring` is split across lines — keep `<!-- rule:… -->` on one line, or the id drops out of the defined set",
        line: 3,
      },
    ]);
  });
});

describe("checkDesign() — tsx fences compile against the exports", () => {
  const forgeFile = (path: string): string => fileURLToPath(new URL(`../../../src/${path}`, import.meta.url));
  const fenceExports = { "./ui/core": forgeFile("ui/core/mod.ts"), "./render/jsx/jsx-runtime": forgeFile("render/jsx/jsx-runtime.ts") };
  const consumerTsconfig = fileURLToPath(new URL("../../../tests/fixtures/workers-consumer/tsconfig.json", import.meta.url));
  const fence = (lang: string, ...body: string[]): string => ["```" + lang, ...body, "```"].join("\n");

  /** The findings blamed on a markdown file, from a corpus and root files written as given. */
  function fenceFindings(
    files: Record<string, string>,
    fencedDocs: readonly string[] = [],
  ): { file: string | undefined; line: number | undefined; message: string }[] {
    const dir = root(oxlintConfig(","));
    for (const [path, source] of Object.entries(files)) writeFileSync(join(dir, path), source, "utf-8");
    const result = checkDesign({
      root: dir,
      packageName: "@y-core/forge",
      exports: fenceExports,
      designDir: "design",
      cssDir: "css",
      sourceDir: "src",
      fencedDocs,
      tsconfig: consumerTsconfig,
    });
    return result.findings.filter(({ file }) => file?.endsWith(".md")).map(({ file, line, message }) => ({ file, line, message }));
  }

  it("fails an unknown prop at the markdown line of its tag", () => {
    const source = [
      "# Dialogs",
      "",
      fence("tsx", 'import { Dialog } from "@y-core/forge/ui/core";', "", "<Dialog modal label='x'>", "  Body", "</Dialog>;"),
    ].join("\n");
    const findings = fenceFindings({ "design/dialogs.md": source });

    expect(findings.map(({ file, line }) => ({ file, line }))).toEqual([{ file: "design/dialogs.md", line: 6 }]);
    expect(findings[0]?.message).toContain("Property 'modal' does not exist");
    expect(findings[0]?.message).toEndWith("(TS2322)");
  });

  it("fails a prop value outside the prop's type", () => {
    const source = fence("tsx", 'import { Badge } from "@y-core/forge/ui/core";', "<Badge tone='default'>New</Badge>;");
    const findings = fenceFindings({ "design/badges.md": source });

    expect(findings.map(({ file, line }) => ({ file, line }))).toEqual([{ file: "design/badges.md", line: 3 }]);
    expect(findings[0]?.message).toContain(`'"default"'`);
    expect(findings[0]?.message).toEndWith("(TS2322)");
  });

  it("fails an unknown compound member once, though its closing tag repeats the diagnostic", () => {
    const source = fence("tsx", 'import { Card } from "@y-core/forge/ui/core";', "<Card.Subtitle>t</Card.Subtitle>;");
    const findings = fenceFindings({ "design/cards.md": source });

    expect(findings.map(({ file, line }) => ({ file, line }))).toEqual([{ file: "design/cards.md", line: 3 }]);
    expect(findings[0]?.message).toContain("Property 'Subtitle'");
    expect(findings[0]?.message).toEndWith("(TS2339)");
  });

  it("names the subpath that exports a forge name the fence uses without importing", () => {
    const source = ["# Icons", "", fence("tsx", "<Icon symbol='x' />;")].join("\n");

    expect(fenceFindings({ "design/icons.md": source })).toEqual([
      { file: "design/icons.md", line: 4, message: "`Icon` is not imported — `@y-core/forge/ui/core` exports it" },
    ]);
  });

  it("passes names forge does not export as app context, declared by the check rather than the fence", () => {
    const source = fence("tsx", 'import { Badge } from "@y-core/forge/ui/core";', "<Badge tone={tone}>{label}</Badge>;");

    expect(fenceFindings({ "design/context.md": source })).toEqual([]);
  });

  it("contains a parse failure to its own fence, so the next fence's type error is still reported", () => {
    const broken = fence("tsx", 'import { Badge } from "@y-core/forge/ui/core";', "<Badge>One</Badge>", "<Badge>Two</Badge>;");
    const typed = fence("tsx", 'import { Badge } from "@y-core/forge/ui/core";', "<Badge tone='default'>New</Badge>;");
    const findings = fenceFindings({ "design/mixed.md": [broken, "", typed].join("\n") });

    expect(findings.map(({ line, message }) => ({ line, kind: /\(TS(\d+)\)$/.exec(message)?.[1] }))).toEqual([
      { line: 3, kind: "2657" },
      { line: 9, kind: "2322" },
    ]);
  });

  it("fails an unclosed brace at its fence's last line, though tsc raises it past the body, and still reports the next fence", () => {
    const truncated = fence("tsx", "function f() {", "  const x = 1;");
    const typed = fence("tsx", 'import { Badge } from "@y-core/forge/ui/core";', '<Badge tone="default">New</Badge>;');
    const findings = fenceFindings({ "design/truncated.md": [truncated, "", typed].join("\n") });

    expect(findings.map(({ line, message }) => ({ line, kind: /\(TS(\d+)\)$/.exec(message)?.[1] }))).toEqual([
      { line: 3, kind: "1005" },
      { line: 8, kind: "2322" },
    ]);
  });

  it("blames the true markdown line for a fence indented inside a list item", () => {
    const source = [
      "- Step one:",
      "",
      "  ```tsx",
      '  import { Badge } from "@y-core/forge/ui/core";',
      "",
      "  <Badge tone='default'>New</Badge>;",
      "  ```",
    ].join("\n");
    const findings = fenceFindings({ "design/list.md": source });

    expect(findings.map(({ file, line }) => ({ file, line }))).toEqual([{ file: "design/list.md", line: 6 }]);
  });

  it("compiles a listed `fencedDocs` file and blames it, but not the same fence in an unlisted one", () => {
    const source = fence("tsx", 'import { Badge } from "@y-core/forge/ui/core";', "<Badge tone='default'>New</Badge>;");
    const findings = fenceFindings({ "README.md": source, "OTHER.md": source }, ["README.md"]);

    expect(findings.map(({ file, line }) => ({ file, line }))).toEqual([{ file: "README.md", line: 3 }]);
  });

  it("reports a `fencedDocs` entry naming a file that does not exist", () => {
    expect(fenceFindings({}, ["MISSING.md"])).toEqual([
      { file: "MISSING.md", line: undefined, message: "is listed in `fencedDocs` but does not exist" },
    ]);
  });

  it("leaves a non-tsx fence uncompiled, however invalid", () => {
    const source = [fence("ts", "const count: number = 'one'"), "", fence("html", "<Badge tone='default'>")].join("\n");

    expect(fenceFindings({ "design/other.md": source })).toEqual([]);
  });

  it("passes a fence that imports what it uses and compiles clean", () => {
    const source = fence("tsx", 'import { Badge } from "@y-core/forge/ui/core";', "<Badge tone='neutral'>x</Badge>;");

    expect(fenceFindings({ "design/clean.md": source })).toEqual([]);
  });
});
