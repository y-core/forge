import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import { checkExports, isPublished, parseSubpathPatterns } from "./exports";
import type { ExportsCheckConfig } from "./types";

const TYPE_BARREL = 'export type { Thing } from "./thing";\n';

const VALUE_BARREL = 'export { thing } from "./thing";\n';

const THING = "export interface Thing {\n  a: number;\n}\n";

const PUBLIC_ALPHA = "/** A thing. @public */\nexport function alpha(): void {}\n";

/** A throwaway package root holding each `path: contents` pair, directories created as needed. */
function root(tree: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-exports-check-"));
  for (const [path, contents] of Object.entries(tree)) {
    const abs = resolve(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf-8");
  }
  return dir;
}

// The package name resolves to nothing, so every runtime-resolution branch is reached from a test
// that never depends on this repository's own installed layout.
function run(tree: Record<string, string>, extra: Partial<ExportsCheckConfig> = {}): Promise<CheckResult> {
  return checkExports({ root: root(tree), packageName: "@fixture/absent", exports: {}, files: [], ...extra });
}

async function messages(tree: Record<string, string>, extra: Partial<ExportsCheckConfig> = {}): Promise<string[]> {
  return (await run(tree, extra)).findings.map((finding) => finding.message);
}

function only(findings: readonly Finding[], file: string): Finding[] {
  return findings.filter((finding) => finding.file === file);
}

describe("parseSubpathPatterns()", () => {
  it("splits a pattern into its key and target halves", () => {
    const result = parseSubpathPatterns({ "./css/*": "./src/css/*" });

    expect(result.findings).toEqual([]);
    expect(result.patterns.map((pattern) => pattern.specifier)).toEqual(["./css/*"]);
  });

  it("reads the conditional form's import target", () => {
    const result = parseSubpathPatterns({ "./css/*": { import: "./src/css/*", types: "./types/css/*" } });

    expect(result.patterns.map((pattern) => pattern.specifier)).toEqual(["./css/*"]);
  });

  it("refuses a key carrying two stars", () => {
    const result = parseSubpathPatterns({ "./css/*/*": "./src/css/*" });

    expect(result.patterns).toEqual([]);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "./css/*/*: a subpath pattern may contain exactly one `*` in the key and one in the target",
    ]);
  });

  it("refuses a target carrying two stars", () => {
    const result = parseSubpathPatterns({ "./css/*": "./src/*/css/*" });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "./css/*: a subpath pattern may contain exactly one `*` in the key and one in the target",
    ]);
  });

  it("passes over a key with no star and an entry with no import target", () => {
    const result = parseSubpathPatterns({ "./x": "./src/x/mod.ts", "./css/*": {} });

    expect({ patterns: result.patterns, findings: result.findings }).toEqual({ patterns: [], findings: [] });
  });
});

describe("isPublished()", () => {
  it("accepts a path equal to a files entry", () => {
    expect(isPublished("src", ["src"])).toBe(true);
  });

  it("accepts a path inside a files entry, with or without its leading dot-slash", () => {
    expect([isPublished("src/x/mod.ts", ["src"]), isPublished("./src/x/mod.ts", ["src"])]).toEqual([true, true]);
  });

  it("accepts a files entry written with a trailing slash", () => {
    expect(isPublished("src/x/mod.ts", ["src/"])).toBe(true);
  });

  it("rejects a path merely sharing a name prefix with a files entry", () => {
    expect(isPublished("srcery/x.ts", ["src"])).toBe(false);
  });

  it("never publishes on the strength of a negated entry", () => {
    expect(isPublished("src/x/mod.ts", ["!src"])).toBe(false);
  });

  it("rejects a path no entry covers", () => {
    expect(isPublished("dist/index.js", ["src"])).toBe(false);
  });
});

describe("checkExports() — the passing tree", () => {
  it("passes a published, type-only barrel and counts the subpaths it resolved", async () => {
    const result = await run({ "src/x/mod.ts": TYPE_BARREL, "src/x/thing.ts": THING }, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"] });

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 export subpaths resolve, and every barrel, files[] entry and asset is reachable.");
  });

  it("refuses an empty exports map, rather than reporting a green run that verified nothing", async () => {
    const result = await run({});

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      fail("`@fixture/absent` resolved no export subpath — refusing to report a green exports gate that verified nothing"),
    ]);
    expect(result.summary).toBe("");
  });

  it("keeps the explanation when a map resolves nothing but reported why", async () => {
    const result = await run({}, { exports: { ".": {} } });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([".: no import path in package.json"]);
  });
});

describe("checkExports() — one entry against the source tree", () => {
  it("reports an entry with no import path", async () => {
    expect(await messages({}, { exports: { "./x": {} } })).toEqual(["./x: no import path in package.json"]);
  });

  it("reports a barrel the map names and the tree does not have", async () => {
    expect(await messages({}, { exports: { "./x": "./src/x/mod.ts" } })).toEqual(["./x: barrel file not found at ./src/x/mod.ts"]);
  });

  it("reports a barrel that exists but ships to nobody", async () => {
    const tree = { "src/x/mod.ts": TYPE_BARREL, "src/x/thing.ts": THING, "dist/index.js": "\n" };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["dist"] })).toEqual([
      "./x: ./src/x/mod.ts is not covered by package.json files",
    ]);
  });

  it("reports a banned star re-export instead of importing the barrel", async () => {
    const tree = { "src/x/mod.ts": 'export * from "./thing";\n', "src/x/thing.ts": THING };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"] })).toEqual([
      "./x: contains a banned star re-export (`export *`, `export * as ns`, or `export type *`) — use explicit named exports",
    ]);
  });

  it("reports a barrel exporting neither a value nor a type", async () => {
    const tree = { "src/x/mod.ts": "const internal = 1;\n", "src/x/thing.ts": THING };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"] })).toEqual(["./x: no value exports found in barrel"]);
  });

  it("reports the failure when a value-exporting barrel cannot be imported as a consumer would", async () => {
    const tree = { "src/x/mod.ts": VALUE_BARREL, "src/x/thing.ts": "export const thing = 1;\n" };

    const [message = ""] = await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"] });
    expect(message.startsWith("./x: import failed — ")).toBe(true);
  });

  it("imports no browser-only barrel, whose module scope touches DOM globals", async () => {
    const tree = { "src/x/mod.ts": VALUE_BARREL, "src/x/thing.ts": "export const thing = 1;\n" };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"], browserOnly: ["./x"] })).toEqual([]);
  });

  it("accepts a side-effect-only barrel exporting nothing at all", async () => {
    const tree = { "src/x/mod.ts": "globalThis.registered = true;\n" };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"], sideEffectOnly: ["./x"] })).toEqual([]);
  });

  it("reports a non-module target that ships but does not resolve for a consumer", async () => {
    const [message = ""] = await messages(
      { "src/css/theme.css": ":root {}\n" },
      { exports: { "./theme.css": "./src/css/theme.css" }, files: ["src"] },
    );

    expect(message.startsWith("./theme.css: published but unresolvable as @fixture/absent/theme.css — ")).toBe(true);
  });
});

describe("checkExports() — the browser-only convention and the escapes it holds", () => {
  const tree = { "src/x/client/mod.ts": VALUE_BARREL, "src/x/client/thing.ts": "export const thing = 1;\n" };

  it("imports no subpath under a `client` segment, with no entry configured", async () => {
    expect(await messages(tree, { exports: { "./x/client": "./src/x/client/mod.ts" }, files: ["src"] })).toEqual([]);
  });

  it("reports an explicit entry the convention already derives — a redundant escape is a drift surface", async () => {
    expect(await messages(tree, { exports: { "./x/client": "./src/x/client/mod.ts" }, files: ["src"], browserOnly: ["./x/client"] })).toEqual([
      "browserOnly: ./x/client sits under a `client` segment, which is browser-only already — delete the entry",
    ]);
  });

  it("reports a `browserOnly` entry naming a subpath the map does not have", async () => {
    expect(await messages(tree, { exports: { "./x/client": "./src/x/client/mod.ts" }, files: ["src"], browserOnly: ["./gone"] })).toEqual([
      "browserOnly: ./gone is not a subpath of the exports map — delete the entry",
    ]);
  });

  it("reports a `sideEffectOnly` entry naming a subpath the map does not have", async () => {
    expect(await messages(tree, { exports: { "./x/client": "./src/x/client/mod.ts" }, files: ["src"], sideEffectOnly: ["./gone"] })).toEqual([
      "sideEffectOnly: ./gone is not a subpath of the exports map — delete the entry",
    ]);
  });

  it("reports a `sealedInternal` entry naming a barrel that is not there", async () => {
    expect(
      await messages(tree, { exports: { "./x/client": "./src/x/client/mod.ts" }, files: ["src"], sealedInternal: ["src/gone/mod.ts"] }),
    ).toEqual(["sealedInternal: src/gone/mod.ts is not a barrel this check walks — delete the entry"]);
  });

  it("reports a `sealedInternal` entry naming a barrel the map publishes", async () => {
    expect(
      await messages(tree, { exports: { "./x/client": "./src/x/client/mod.ts" }, files: ["src"], sealedInternal: ["src/x/client/mod.ts"] }),
    ).toEqual(["sealedInternal: src/x/client/mod.ts is a published exports target — delete the entry"]);
  });
});

describe("checkExports() — @public symbols against their barrel", () => {
  it("reports every public symbol the barrel does not name, sorted", async () => {
    const tree = {
      "src/x/mod.ts": TYPE_BARREL,
      "src/x/thing.ts": `${THING}${PUBLIC_ALPHA}`,
      "src/x/nested/other.ts": "/** Another. @public */\nexport const beta = 2;\n",
    };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"] })).toEqual([
      "./x: @public symbols missing from barrel: alpha, beta",
    ]);
  });

  it("accepts the same tree once the barrel names them", async () => {
    const tree = {
      "src/x/mod.ts": 'export { alpha } from "./thing";\nexport { beta } from "./nested/other";\n',
      "src/x/thing.ts": PUBLIC_ALPHA,
      "src/x/nested/other.ts": "/** Another. @public */\nexport const beta = 2;\n",
    };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"], browserOnly: ["./x"] })).toEqual([]);
  });

  it("stops at a nested directory that is a registered barrel of its own", async () => {
    const tree = {
      "src/x/mod.ts": TYPE_BARREL,
      "src/x/thing.ts": THING,
      "src/x/y/mod.ts": TYPE_BARREL,
      "src/x/y/thing.ts": `${THING}${PUBLIC_ALPHA}`,
    };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts", "./x/y": "./src/x/y/mod.ts" }, files: ["src"] })).toEqual([
      "./x/y: @public symbols missing from barrel: alpha",
    ]);
  });
});

describe("checkExports() — barrels, files[] and assets the map never names", () => {
  it("reports a barrel that is neither an exports target nor sealed internal", async () => {
    const tree = { "src/x/mod.ts": TYPE_BARREL, "src/x/thing.ts": THING, "src/y/mod.ts": TYPE_BARREL, "src/y/thing.ts": THING };

    expect(await run(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"] }).then((result) => result.findings)).toEqual([
      { level: "fail", message: "barrel is not a package.json exports target and not on the sealed-internal allowlist", file: "src/y/mod.ts" },
    ]);
  });

  it("accepts that barrel once the allowlist names it", async () => {
    const tree = { "src/x/mod.ts": TYPE_BARREL, "src/x/thing.ts": THING, "src/y/mod.ts": TYPE_BARREL, "src/y/thing.ts": THING };

    expect(await messages(tree, { exports: { "./x": "./src/x/mod.ts" }, files: ["src"], sealedInternal: ["src/y/mod.ts"] })).toEqual([]);
  });

  it("reports a files entry that is not on disk, and passes over a negated one", async () => {
    expect(await messages({ "src/x/thing.ts": THING }, { files: ["src", "!src/**/*.test.ts", "dist"] })).toEqual([
      "files[]: dist does not exist on disk",
    ]);
  });

  it("reports an asset directory that is not on disk", async () => {
    expect(await messages({}, { assetDirs: [{ dir: "src/fonts", extension: ".woff2" }] })).toEqual(["assetDirs: src/fonts does not exist on disk"]);
  });

  it("reports an asset no key and no pattern reaches", async () => {
    const result = await run({ "src/css/theme.css": ":root {}\n" }, { assetDirs: [{ dir: "src/css", extension: ".css" }] });

    expect(result.findings).toEqual([
      { level: "fail", message: "no exports key or pattern covers it — consumers cannot import it", file: "src/css/theme.css" },
    ]);
  });

  it("reports an asset the map covers but the resolver cannot reach", async () => {
    const result = await run(
      { "src/css/theme.css": ":root {}\n" },
      { exports: { "./theme.css": "./src/css/theme.css" }, files: ["src"], assetDirs: [{ dir: "src/css", extension: ".css" }] },
    );

    const [finding] = only(result.findings, "src/css/theme.css");
    expect(finding?.message.startsWith("covered by the exports map but unresolvable as @fixture/absent/theme.css — ")).toBe(true);
  });
});

describe("checkExports() — a subpath pattern against the files it expands to", () => {
  it("reports a pattern matching nothing on disk rather than passing it as covered", async () => {
    expect(await messages({ "src/x/thing.ts": THING }, { exports: { "./css/*": "./src/css/*" }, files: ["src"] })).toEqual([
      "./css/*: pattern matches no file on disk — nothing is reachable under it",
    ]);
  });

  it("reports a pattern that swallows a module, which needs a key of its own", async () => {
    expect(await messages({ "src/css/a.ts": "export const a = 1;\n" }, { exports: { "./css/*": "./src/css/*" }, files: ["src"] })).toEqual([
      "./css/*: expands to the module src/css/a.ts — patterns are for assets; give a module its own key",
    ]);
  });

  it("reports a matched asset the files list does not ship", async () => {
    const tree = { "src/css/a.css": ":root {}\n", "dist/index.js": "\n" };

    expect(await messages(tree, { exports: { "./css/*": "./src/css/*" }, files: ["dist"] })).toEqual([
      "./css/*: src/css/a.css is not covered by package.json files",
    ]);
  });

  it("reports a matched asset that ships but does not resolve under the specifier it expands to", async () => {
    const [message = ""] = await messages({ "src/css/a.css": ":root {}\n" }, { exports: { "./css/*": "./src/css/*" }, files: ["src"] });

    expect(message.startsWith("./css/*: src/css/a.css is published but unresolvable as @fixture/absent/css/a.css — ")).toBe(true);
  });
});
