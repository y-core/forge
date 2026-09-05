import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { checkClassTokens, stringLiterals, unknownTokens } from "./class-tokens";
import { hasTailwind, loadDesignSystem } from "./design-system";

const ROOT = resolve(import.meta.dir, "../../../..");
const STYLESHEET = "src/ui/assets/css/tailwind.css";

/** A throwaway repository root holding exactly the files given. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-class-tokens-check-"));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

/** The oracle a unit test uses: the named tokens produce CSS, the named names are declared utilities. */
function fake(known: readonly string[], declared: readonly string[]): { known: (token: string) => boolean; declared: Set<string> } {
  return { known: (token) => known.includes(token), declared: new Set(declared) };
}

describe("stringLiterals", () => {
  it("reads a quoted literal with the line it opens on", () => {
    expect(stringLiterals('const a = 1;\nconst BASE = "flex gap-2";')).toEqual([{ line: 2, text: "flex gap-2" }]);
  });

  it("reads both single and double quotes", () => {
    expect(stringLiterals(`const a = 'flex'; const b = "gap-2";`)).toEqual([
      { line: 1, text: "flex" },
      { line: 1, text: "gap-2" },
    ]);
  });

  it("cuts a template's interpolation out and keeps the chunks either side", () => {
    expect(stringLiterals("const a = `flex ${cls} gap-2`;")).toEqual([
      { line: 1, text: "flex " },
      { line: 1, text: " gap-2" },
    ]);
  });

  it("reads nothing out of a comment", () => {
    expect(stringLiterals('// const BASE = "flex gap-2";')).toEqual([]);
    expect(stringLiterals('/* const BASE = "flex gap-2"; */')).toEqual([]);
  });

  it("keeps an apostrophe in prose from swallowing the rest of the file", () => {
    expect(stringLiterals(`// don't\nconst BASE = "flex";`)).toEqual([{ line: 2, text: "flex" }]);
  });
});

describe("unknownTokens", () => {
  const oracle = fake(["rounded-sm", "text-(--tone-text)", "flex"], ["focus-ring-outset", "rounded", "text", "flex"]);

  // The dash walk alone reached none of forge's nine `@utility` names: each is `<family>-<word>` and
  // no family is itself declared, so a typo in one was silently dropped while the summary claimed
  // every class string resolved to CSS.
  it("reports a character appended to a forge `@utility`, which no dash prefix could reach", () => {
    const forge = fake(["flex", "rounded-sm"], ["state-invalid", "flex", "rounded"]);
    const source = 'const BASE = "flex rounded-sm state-invalidd";';
    expect(unknownTokens("src/ui/core/input.tsx", source, forge.known, forge.declared)).toEqual([
      {
        level: "fail",
        message: "class token matches no utility the design system produces CSS for",
        file: "src/ui/core/input.tsx",
        line: 1,
        detail: ["`state-invalidd`", "`state-invalid` is a utility this design system declares — `state-invalidd` is not, so it renders nothing"],
      },
    ]);
  });

  it("reports a forge `@utility` with its last character dropped", () => {
    const forge = fake(["flex", "rounded-sm"], ["focus-ring", "flex", "rounded"]);
    const source = 'const BASE = "flex rounded-sm focus-rin";';
    expect(unknownTokens("src/ui/core/input.tsx", source, forge.known, forge.declared).map((finding) => finding.detail?.[1])).toEqual([
      "`focus-ring` is a utility this design system declares — `focus-rin` is not, so it renders nothing",
    ]);
  });

  it("says nothing about a word that merely shares a short opening with a utility", () => {
    const forge = fake(["flex", "rounded-sm"], ["state-invalid", "flex", "rounded"]);
    const source = 'const BASE = "flex rounded-sm sta-x";';
    expect(unknownTokens("src/ui/core/input.tsx", source, forge.known, forge.declared)).toEqual([]);
  });

  it("reports a doubled `@utility` suffix in a module-level const", () => {
    const source = 'const LINK_BASE = "rounded-sm text-(--tone-text) focus-ring-outset-outset";';
    expect(unknownTokens("src/ui/core/link.tsx", source, oracle.known, oracle.declared)).toEqual([
      {
        level: "fail",
        message: "class token matches no utility the design system produces CSS for",
        file: "src/ui/core/link.tsx",
        line: 1,
        detail: [
          "`focus-ring-outset-outset`",
          "`focus-ring-outset` is a utility this design system declares — `focus-ring-outset-outset` is not, so it renders nothing",
        ],
      },
    ]);
  });

  it("reports the same token once per line, however many literals repeat it", () => {
    const source = 'cn("flex focus-ring-outset-outset", "flex focus-ring-outset-outset");';
    expect(unknownTokens("a.tsx", source, oracle.known, oracle.declared)).toHaveLength(1);
  });

  it("reports a token on the line its literal opens on", () => {
    const source = '<div class="flex" />\n<div class="flex focus-ring-outset-outset" />';
    expect(unknownTokens("a.tsx", source, oracle.known, oracle.declared).map((finding) => finding.line)).toEqual([2]);
  });

  it("says nothing about a literal every token of which resolves", () => {
    expect(unknownTokens("a.tsx", 'cn("rounded-sm flex")', oracle.known, oracle.declared)).toEqual([]);
  });

  it("says nothing about a literal with no resolving token at all, which is not a class string", () => {
    expect(unknownTokens("a.tsx", 'turnstile("always")', oracle.known, oracle.declared)).toEqual([]);
    expect(unknownTokens("a.tsx", 'placement("top-start")', oracle.known, fake([], ["top"]).declared)).toEqual([]);
  });

  it("says nothing about prose that happens to carry a utility word", () => {
    const source = 'expect(x, "the closed disclosure has no from-value to transition out of").toBe("0px");';
    expect(unknownTokens("a.tsx", source, fake(["transition"], ["from", "transition"]).known, new Set(["from", "transition"]))).toEqual([]);
  });

  it("says nothing about a dead token whose utility part carries no dash to probe", () => {
    expect(unknownTokens("a.tsx", 'cn("flex sr-onlyy")', fake(["flex"], ["sr", "flex"]).known, new Set(["flex"]))).toEqual([]);
  });

  it("says nothing about a literal holding a bare English word, which is prose rather than a class string", () => {
    expect(unknownTokens("a.tsx", 'label("flex layouts focus-ring-outset-outset")', oracle.known, oracle.declared)).toEqual([]);
  });

  it("still judges a class string that carries a marker class no utility compiles", () => {
    const source = 'cn("group/filter flex focus-ring-outset-outset")';
    expect(unknownTokens("a.tsx", source, oracle.known, oracle.declared).map((finding) => finding.detail?.[0])).toEqual([
      "`focus-ring-outset-outset`",
    ]);
  });
});

describe("unknownTokens — the constructs it must not flag", () => {
  it.skipIf(!hasTailwind())("leaves every real-corpus form the design system does compile alone", async () => {
    const ds = await loadDesignSystem(resolve(ROOT, STYLESHEET));
    const declared = new Set([...ds.utilities.keys("static"), ...ds.utilities.keys("functional")]);
    const literals = [
      "focus-ring-outset",
      "[--tone:var(--color-primary)]",
      "group/filter",
      "has-[:checked]:bg-primary",
      "@md/field-group:[&>[data-slot~=field-content]]:flex-1",
      "[&>*]:[grid-area:1/1]",
      "[scrollbar-color:var(--color-border)_transparent]",
      "-translate-x-1/2",
      "bg-muted/40",
      "text-(--tone-text)",
      "has-[select:disabled]:opacity-50",
      "peer-focus-visible:ring-2",
      "@container/field-group",
    ];
    const parsed = ds.candidatesToAst(literals);
    // `group/filter` is a marker class, so nothing compiles it; the near-miss probe is what excludes it.
    expect(literals.filter((_, i) => (parsed[i]?.length ?? 0) === 0)).toEqual(["group/filter"]);

    const known = new Set(literals.filter((_, i) => (parsed[i]?.length ?? 0) > 0));
    const source = `cn("${literals.join(" ")}");`;
    expect(unknownTokens("a.tsx", source, (token) => known.has(token), declared)).toEqual([]);
  });
});

describe("checkClassTokens", () => {
  it.skipIf(!hasTailwind())("passes over the tree as it stands", async () => {
    const result = await checkClassTokens({ root: ROOT, sources: ["src/ui", "!src/ui/design"], stylesheet: STYLESHEET });
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.skipIf(!hasTailwind())("fails on a token the compiled design system produces no CSS for", async () => {
    const root = fixtureRoot({ "src/ui/core/link.tsx": 'const BASE = "rounded-sm focus-ring-outset-outset";' });
    const result = await checkClassTokens({ root, sources: ["src/ui"], stylesheet: resolve(ROOT, STYLESHEET) });
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => [finding.file, finding.line])).toEqual([["src/ui/core/link.tsx", 1]]);
  });

  it.skipIf(!hasTailwind())("refuses a green verdict when the sources match no file", async () => {
    const root = fixtureRoot({ "src/other/a.ts": "export const a = 1;" });
    const result = await checkClassTokens({ root, sources: ["src/ui"], stylesheet: resolve(ROOT, STYLESHEET) });
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src/ui` matched no source — refusing to report a green class-token gate that scanned nothing",
    ]);
  });

  it.skipIf(!hasTailwind())("scans no spec, whose class strings are fragments of rendered markup", async () => {
    const root = fixtureRoot({ "src/ui/core/link.test.tsx": "expect(html).toBe('<a class=\"rounded-sm gap-4\"></a>');" });
    const result = await checkClassTokens({ root, sources: ["src/ui"], stylesheet: resolve(ROOT, STYLESHEET) });
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src/ui` matched no source — refusing to report a green class-token gate that scanned nothing",
    ]);
  });
});
