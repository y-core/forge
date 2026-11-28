import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { checkBundleShadows, shadowCandidates, validateBundleShadows } from "./bundle-shadow";
import { packedConsumer } from "./packed-consumer.fixture";

const ROOT = resolve(import.meta.dir, "../../../..");

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-bundle-shadow-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const messages = (root: string) => checkBundleShadows({ root, sources: ["src"] }).findings.map((finding) => `${finding.file}:${finding.line}`);

describe("shadowCandidates()", () => {
  it("names each `.mjs`, `.js` and `.cjs`, and the `index` of each, that an extensionless specifier could load, in Bun's order", () => {
    expect(shadowCandidates("src/security/url.ts", "../validation/mod")).toEqual([
      "src/validation/mod.mjs",
      "src/validation/mod.js",
      "src/validation/mod.cjs",
      "src/validation/mod/index.mjs",
      "src/validation/mod/index.js",
      "src/validation/mod/index.cjs",
    ]);
  });

  it("names nothing for a specifier that carries its extension", () => {
    expect(shadowCandidates("src/a.ts", "./b.ts")).toEqual([]);
    expect(shadowCandidates("src/a.ts", "./b.mjs")).toEqual([]);
  });

  it("resolves a parent-relative specifier against the importing file's directory", () => {
    expect(shadowCandidates("src/tooling/gate/checks/x.ts", "../../../validation/mod")[0]).toBe("src/validation/mod.mjs");
  });

  it("names nothing for a specifier carrying `.js`, `.cjs`, `.tsx` or `.json`", () => {
    expect(["./b.js", "./b.cjs", "./b.tsx", "./b.json"].map((specifier) => shadowCandidates("src/a.ts", specifier))).toEqual([[], [], [], []]);
  });

  it("treats a dotted stem such as `url.dev` as extensionless", () => {
    expect(shadowCandidates("src/a.ts", "./url.dev")[0]).toBe("src/url.dev.mjs");
  });
});

describe("checkBundleShadows()", () => {
  it("refuses an extensionless import whose `.mjs` sibling Bun would load instead of the `.ts`", () => {
    const root = tree({
      "src/validation/mod.ts": "export const v = 1;\n",
      "src/validation/mod.mjs": "export const v = 1;\n",
      "src/security/url.ts": 'import { v } from "../validation/mod";\nexport const w = v;\n',
    });

    expect(messages(root)).toEqual(["src/security/url.ts:1"]);
  });

  it("refuses a dynamic, re-exported or side-effect import the same way", () => {
    const root = tree({
      "src/a.ts": "export const a = 1;\n",
      "src/a.mjs": "export const a = 1;\n",
      "src/b.ts": 'export { a } from "./a";\nimport "./a";\nexport const c = () => import("./a");\n',
    });

    expect(messages(root)).toEqual(["src/b.ts:1", "src/b.ts:2", "src/b.ts:3"]);
  });

  it("passes a `.node.mjs` bundle, which no extensionless specifier reaches", () => {
    const root = tree({
      "src/validation/mod.ts": "export const v = 1;\n",
      "src/validation/mod.node.mjs": "export const v = 1;\n",
      "src/security/url.ts": 'import { v } from "../validation/mod";\nexport const w = v;\n',
    });

    expect(checkBundleShadows({ root, sources: ["src"] }).ok).toBe(true);
  });

  it("ignores an import written inside a comment", () => {
    const root = tree({ "src/a.mjs": "", "src/b.ts": '// import { a } from "./a";\nexport const b = 1;\n' });

    expect(validateBundleShadows(root, "src/b.ts", '// import { a } from "./a";\n')).toEqual([]);
  });

  it("refuses to pass a source list that names nothing", () => {
    const root = tree({ "src/readme.md": "" });

    expect(checkBundleShadows({ root, sources: ["src"] }).ok).toBe(false);
    expect(checkBundleShadows({ root, sources: ["missing"] }).ok).toBe(false);
  });

  it("passes this repository's tree", () => {
    expect(checkBundleShadows({ root: ROOT, sources: ["src"] }).findings).toEqual([]);
  });

  it("scans a `.tsx` module as it does a `.ts` one", () => {
    const root = tree({ "src/a.ts": "", "src/a.mjs": "", "src/page.tsx": 'import { a } from "./a";\nexport const Page = () => <p>{a}</p>;\n' });

    expect(messages(root)).toEqual(["src/page.tsx:1"]);
  });

  it("names the importing file, its line, the specifier and the bundle it reaches", () => {
    const root = tree({ "src/validation/mod.mjs": "", "src/security/url.ts": '\nimport { v } from "../validation/mod";\n' });
    const [finding, ...rest] = checkBundleShadows({ root, sources: ["src"] }).findings;

    expect(rest).toEqual([]);
    expect([finding?.level, finding?.file, finding?.line]).toEqual(["fail", "src/security/url.ts", 2]);
    expect([finding?.message.includes("`../validation/mod`"), finding?.message.includes("`src/validation/mod.mjs`")]).toEqual([true, true]);
  });

  it("refuses an import of a directory whose `index.mjs` Bun loads ahead of its `index.ts`", () => {
    const root = tree({ "src/dir/index.ts": "", "src/dir/index.mjs": "", "src/b.ts": 'import "./dir";\n' });
    const findings = checkBundleShadows({ root, sources: ["src"] }).findings;

    expect(findings.map((finding) => [finding.file, finding.line, finding.message.includes("`src/dir/index.mjs`")])).toEqual([
      ["src/b.ts", 1, true],
    ]);
  });

  for (const sibling of ["src/a.js", "src/a.cjs", "src/a/index.js", "src/a/index.cjs"]) {
    it(`refuses an extensionless import that reaches \`${sibling}\`, which Bun also loads ahead of the \`.ts\``, () => {
      const root = tree({ "src/a.ts": "", [sibling]: "", "src/b.ts": 'import "./a";\n' });
      const findings = checkBundleShadows({ root, sources: ["src"] }).findings;

      expect(findings.map((finding) => [finding.file, finding.message.includes(`\`${sibling}\``)])).toEqual([["src/b.ts", true]]);
    });
  }

  it("names the renamed file with the extension it already has", () => {
    const root = tree({ "src/a.cjs": "", "src/b.ts": 'import "./a";\n' });
    const [finding] = checkBundleShadows({ root, sources: ["src"] }).findings;

    expect(finding?.detail?.at(-1)).toContain("`a.node.cjs`");
  });

  it("passes a template literal with a substitution, which Bun cannot resolve statically", () => {
    const root = tree({ "src/a.mjs": "" });

    expect(validateBundleShadows(root, "src/b.ts", "await import(`./${name}`);\n")).toEqual([]);
  });

  it("passes a `.mjs` that no import reaches", () => {
    const root = tree({ "src/orphan.mjs": "", "src/orphan.ts": "", "src/b.ts": 'import "./other";\n', "src/other.ts": "" });

    expect(checkBundleShadows({ root, sources: ["src"] })).toMatchObject({ ok: true, findings: [] });
  });

  it("skips a file under a `!` exclusion, and still scans the rest", () => {
    const root = tree({ "src/a.mjs": "", "src/gen/b.ts": 'import "../a";\n', "src/c.ts": 'import "./a";\n' });

    expect(checkBundleShadows({ root, sources: ["src", "!src/gen"] }).findings.map((finding) => finding.file)).toEqual(["src/c.ts"]);
  });

  it("names the missing `sources` entry it refuses", () => {
    const root = tree({ "src/a.ts": "" });
    const result = checkBundleShadows({ root, sources: ["src", "missing"] });

    expect([result.ok, result.findings.length, result.findings[0]?.message.includes("`missing`")]).toEqual([false, 1, true]);
  });
});

describe("validateBundleShadows() — the import shapes it reads", () => {
  const root = tree({ "src/a.ts": "export const a = 1;\nexport type A = number;\n", "src/a.mjs": "export const a = 1;\n" });
  const lines = (source: string) => validateBundleShadows(root, "src/b.ts", source).map((finding) => finding.line);

  const refused: { name: string; source: string; expected: number[] }[] = [
    { name: "a single-quoted specifier", source: "import { a } from './a';\n", expected: [1] },
    { name: "a star re-export", source: 'export * from "./a";\n', expected: [1] },
    { name: "a namespaced star re-export", source: 'export * as ns from "./a";\n', expected: [1] },
    { name: "a default import", source: 'import a from "./a";\n', expected: [1] },
    { name: "a namespace import", source: 'import * as ns from "./a";\n', expected: [1] },
    { name: "an import with no space before its specifier", source: 'import{a}from"./a";\n', expected: [1] },
    { name: "a dynamic import padded inside its parentheses", source: 'const m = await import( "./a" );\n', expected: [1] },
    { name: "a multi-line import, on the line holding its specifier", source: 'import {\n  a,\n} from "./a";\n', expected: [3] },
    { name: "a real import beneath a block comment naming the same path", source: '/* import "./a"; */\nimport "./a";\n', expected: [2] },
    { name: "each of several imports of the same bundle", source: 'import "./a";\nexport { a } from "./a";\n', expected: [1, 2] },
    { name: "a template literal with no substitution, which Bun resolves as a static specifier", source: "await import(`./a`);\n", expected: [1] },
  ];

  for (const { name, source, expected } of refused) {
    it(`refuses ${name}`, () => {
      expect(lines(source)).toEqual(expected);
    });
  }

  it("refuses a type-only import or re-export too, although Bun erases it and never loads the bundle", () => {
    expect(lines('import type { A } from "./a";\nexport type { A } from "./a";\n')).toEqual([1, 2]);
  });

  const passed: { name: string; source: string }[] = [
    { name: "a specifier carrying `.js`", source: 'import { a } from "./a.js";\n' },
    { name: "a specifier carrying `.ts`", source: 'import { a } from "./a.ts";\n' },
    { name: "a parent-relative specifier carrying `.js`", source: 'import { v } from "../src/a.js";\n' },
    { name: "a package specifier whose name matches the bundle's stem", source: 'import { a } from "a";\n' },
    { name: "a scoped package subpath", source: 'import { v } from "@y-core/forge/validation";\n' },
    { name: "an import in a line comment", source: '// import "./a";\n' },
    { name: "an import in a block comment spanning lines", source: '/*\nimport { a } from "./a";\n*/\n' },
    { name: "an import of a relative path with no bundle beside it", source: 'import "./b";\n' },
  ];

  for (const { name, source } of passed) {
    it(`passes ${name}`, () => {
      expect(lines(source)).toEqual([]);
    });
  }
});

const CONFIG_SPEC = `
import { createConfig, env } from "@y-core/forge/config";
import { BaseUrlConfigSchema } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";

const config = createConfig({ site: { url: env("SITE_ORIGIN") } }, v.object({ site: v.object({ url: BaseUrlConfigSchema }) }));
try {
  config.get({ SITE_ORIGIN: "http://example.com" });
} catch (error) {
  console.log(JSON.stringify((error as Error).message));
}
`;

describe("forge packed as `dev:forge` installs it, under bun", () => {
  it("keeps safeCheck's message through createConfig, so no internal import loads a bundle in place of its source", () => {
    const root = packedConsumer();
    roots.push(root);
    writeFileSync(join(root, "spec.ts"), CONFIG_SPEC);
    const run = spawnSync("bun", ["spec.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });

    expect({ status: run.status, stderr: run.status === 0 ? "" : run.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(run.stdout.trim())).toBe(
      "Invalid environment: site.url: must use https: (http://localhost and http://127.0.0.1 are allowed for local development)",
    );
  });
});
