import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fail } from "../../../src/tooling/gate/finding";
import type { Finding } from "../../../src/tooling/gate/types";
import { checkDesign, checkDocFences } from "./design";

const roots: string[] = [];
afterAll(() => {
  for (const tempRoot of roots) rmSync(tempRoot, { recursive: true, force: true });
});

/** A throwaway root holding a one-file corpus and a one-file source walk. */
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-design-check-"));
  roots.push(dir);
  mkdirSync(join(dir, "design"), { recursive: true });
  mkdirSync(join(dir, "css"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  // The corpus may not be empty, or the check refuses before it reads anything else.
  writeFileSync(join(dir, "design", "floor.md"), "# Floor\n\nOne rule, stated in prose.\n", "utf-8");
  // Nor may the source walk, which the check refuses as well.
  writeFileSync(join(dir, "src", "ok.tsx"), "export const Ok = () => null;\n", "utf-8");
  return dir;
}

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
    const dir = root();
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

  it("fails a corpus fence importing a module of the app's own, which the corpus never passes as context", () => {
    const source = fence("tsx", 'import { AppIcon } from "./icons";', "<AppIcon />;");

    expect(fenceFindings({ "design/local.md": source }).map(({ line }) => line)).toEqual([2]);
  });

  it("compiles a corpus fence flagged `nocheck`, because the corpus has no opt-out marker", () => {
    const source = fence("tsx nocheck", 'import { Badge } from "@y-core/forge/ui/core";', "<Badge tone='default'>New</Badge>;");

    expect(fenceFindings({ "design/marked.md": source }).map(({ line }) => line)).toEqual([3]);
  });
});

describe("checkDesign() — a Floor rule sits in the Floor document", () => {
  const statements = new Map([
    ["forge-ui-floor-rule", "Give every image an `alt`."],
    ["forge-ui-default-rule", "Default: pad a card with `p-6` — unless the card is dense."],
  ]);

  function floorFindings(files: Record<string, string>): readonly Finding[] {
    const dir = root();
    mkdirSync(join(dir, "design", "reference"), { recursive: true });
    for (const [path, source] of Object.entries(files)) writeFileSync(join(dir, path), source, "utf-8");
    return checkDesign({
      root: dir,
      packageName: "@y-core/forge",
      exports: {},
      designDir: "design",
      cssDir: "css",
      sourceDir: "src",
      floor: { file: "floor.md", statements },
    }).findings;
  }

  it("fails a marker outside the Floor document whose statement does not open `Default:`", () => {
    const findings = floorFindings({ "design/reference/media.md": "# Media\n\n<!-- rule:forge-ui-floor-rule --> Why it matters.\n" });

    expect(findings).toEqual([
      fail(
        "rule marker `forge-ui-floor-rule` is a Floor rule outside `design/floor.md` — move it into the Floor's Verify or Refuse half and cite its id here, or open its statement `Default:` with an `unless …` clause",
        { file: "design/reference/media.md", line: 3 },
      ),
    ]);
  });

  it("passes the same marker in the Floor document, and a Default marker anywhere", () => {
    const findings = floorFindings({
      "design/floor.md": "# Floor\n\n<!-- rule:forge-ui-floor-rule --> Why it matters.\n",
      "design/reference/cards.md": "# Cards\n\n<!-- rule:forge-ui-default-rule --> Why it reads.\n",
    });

    expect(findings).toEqual([]);
  });
});

describe("checkDocFences() — README `ts` fences compile against the exports", () => {
  const forgeFile = (path: string): string => fileURLToPath(new URL(`../../../src/${path}`, import.meta.url));
  const consumerTsconfig = fileURLToPath(new URL("../../../tests/fixtures/workers-consumer/tsconfig.json", import.meta.url));
  const fence = (info: string, ...body: string[]): string => ["```" + info, ...body, "```"].join("\n");

  const readme = [
    "# App",
    "",
    fence(
      "ts",
      'import { applyMiddlewareChain } from "@y-core/forge/app";',
      "",
      "applyMiddlewareChain(app, { securityHeaders: {}, csrf: { ring, subject } });",
    ),
    "",
    fence("ts nocheck", "const count: number = 'one';"),
    "",
    fence(
      "ts",
      'import { applyMiddlewareChain } from "@y-core/forge/app";',
      "",
      'applyMiddlewareChain(app, { securityHeaders: {}, csrf: [{ paths: ["*"], ring }] });',
    ),
    "",
    fence("ts", 'import { csrfProtection } from "@y-core/forge/form";'),
    "",
    fence("tsx", "<NotCompiled />;"),
    "",
    fence("ts", 'import { banner } from "./relax.strict";', 'await Bun.write("banner.txt", banner);'),
    "",
    fence("ts", 'import { nothing } from "@y-core/forge/nope";'),
  ].join("\n");

  const dir = root();
  writeFileSync(join(dir, "README.md"), readme, "utf-8");
  const result = checkDocFences({
    root: dir,
    packageName: "@y-core/forge",
    exports: { "./app": forgeFile("app/mod.ts"), "./form": forgeFile("form/mod.ts") },
    fencedDocs: ["README.md"],
    tsconfig: consumerTsconfig,
  });
  const failures = result.findings.map(({ file, line, message }) => ({ file, line, message }));

  it("passes a fence written against the one-object `csrf` policy", () => {
    expect(failures.filter(({ line }) => line !== undefined && line < 8)).toEqual([]);
  });

  it("skips a fence flagged `nocheck` and counts it", () => {
    expect(failures.some(({ line }) => line === 10)).toBe(false);
    expect(result.summary).toContain("1 marked `nocheck` were skipped");
  });

  it("fails a fence passing `csrf` an array of policies, at the call", () => {
    expect(failures.filter(({ line }) => line === 16).map(({ message }) => message)).toEqual([
      expect.stringMatching(/^`ts` fence does not compile: .*\(TS2\d{3}\)$/),
    ]);
  });

  it("fails a fence importing the removed `csrfProtection`", () => {
    expect(failures.filter(({ line }) => line === 20).map(({ message }) => message)).toEqual([
      expect.stringMatching(/^`ts` fence does not compile: Module '"@y-core\/forge\/form"' has no exported member 'csrfProtection'\. \(TS2305\)$/),
    ]);
  });

  it("leaves a `tsx` fence uncompiled under the default languages", () => {
    expect(failures.some(({ line }) => line === 24)).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("passes an import of the app's own module and a runtime global as app context", () => {
    expect(failures.filter(({ line }) => line === 28 || line === 29)).toEqual([]);
  });

  it("still fails an import of a subpath the package does not export", () => {
    expect(failures.filter(({ line }) => line === 33).map(({ message }) => message)).toEqual([
      expect.stringMatching(/^`ts` fence does not compile: Cannot find module '@y-core\/forge\/nope'/),
    ]);
  });

  it("imports an untyped subpath as `any`, so a fence of a node-only subpath compiles, and still fails one the package does not export", () => {
    const nodeDir = root();
    const nodeReadme = [
      fence("ts", 'import { openTestD1 } from "@y-core/forge/testing/d1";', "", "const db = await openTestD1({ migrations: [] });"),
      "",
      fence("ts", 'import { openTestD1 } from "@y-core/forge/testing/nope";'),
    ].join("\n");
    writeFileSync(join(nodeDir, "README.md"), nodeReadme, "utf-8");
    const nodeResult = checkDocFences({
      root: nodeDir,
      packageName: "@y-core/forge",
      exports: { "./testing/d1": forgeFile("testing/d1/mod.ts") },
      fencedDocs: ["README.md"],
      tsconfig: consumerTsconfig,
      untypedSubpaths: ["./testing/d1"],
    });

    expect(nodeResult.findings.map(({ line, message }) => ({ line, message }))).toEqual([
      { line: 8, message: expect.stringMatching(/^`ts` fence does not compile: Cannot find module '@y-core\/forge\/testing\/nope'/) },
    ]);
  });

  it("reports scanning nothing when `fencedDocs` names no markdown", () => {
    expect(checkDocFences({ root: dir, packageName: "@y-core/forge", exports: {}, fencedDocs: [] }).ok).toBe(false);
  });
});
