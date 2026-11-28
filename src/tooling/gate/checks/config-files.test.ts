import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DB_LAYOUT } from "../../../storage/db/migrations";
import type { CheckResult } from "../types";
import { checkConfigFiles, OXLINT_BASE, TSCONFIG_BASE } from "./config-files";
import { gateFixtureRoot } from "./gate.fixture";
import type { ConfigFileCheckConfig } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function check(files: Record<string, string>, options: Omit<ConfigFileCheckConfig, "root"> = {}): CheckResult {
  const root = gateFixtureRoot(files, "forge-config-files-");
  roots.push(root);
  return checkConfigFiles({ root, ...options });
}

function findingsOf(source: string): [string | undefined, number | undefined, string][] {
  return check({ "config/x.config.ts": source }).findings.map((finding) => [finding.file, finding.line, finding.message]);
}

const NOT_A_DEFINE_CALL = "default export is not a call to an imported `define*` helper";

const statement = (token: string): string =>
  `top-level \`${token}\` statement — a config module holds only imports, \`const\` declarations and its default export`;

const PASSING = 'import { defineX } from "x";\n\nexport default defineX({});\n';

describe("checkConfigFiles() — a conforming module", () => {
  it("passes imports, constants and one default export calling an imported define helper", () => {
    expect(check({ "config/x.config.ts": 'import { defineX } from "x";\n\nconst A = 1;\n\nexport default defineX({ a: A });\n' })).toEqual({
      ok: true,
      findings: [],
      summary: "1 config module(s)",
    });
  });

  it("passes multi-line constants, indented continuations, a multi-line template literal and comments naming an export", () => {
    const source = [
      "/** The table. */",
      "",
      "import {",
      "  defineX,",
      "  type Shape,",
      '} from "x";',
      "",
      "// export const LOOKS_LIKE_AN_EXPORT = 1;",
      "const ROWS: Shape[] = [",
      "  { a: 1 },",
      "  { a: 2 },",
      "];",
      "",
      "const LONG =",
      '  "continued";',
      "",
      "const BANNER = `",
      "export const INSIDE_A_TEMPLATE = 1;",
      "let notAStatement;",
      "`;",
      "",
      "/*",
      "export const IN_A_BLOCK_COMMENT = 1;",
      "*/",
      "export default defineX({",
      "  rows: ROWS,",
      "  long: LONG,",
      "  banner: BANNER,",
      "});",
      "",
    ].join("\n");

    expect(findingsOf(source)).toEqual([]);
  });

  for (const { source, form } of [
    { form: "a helper bound by an aliased named import", source: 'import { make as defineX } from "x";\n\nexport default defineX({});\n' },
    { form: "a helper bound by a default import", source: 'import defineX from "x";\n\nexport default defineX({});\n' },
    {
      form: "a helper bound by a default import beside named ones",
      source: 'import defineX, { other } from "x";\n\nexport default defineX({ other });\n',
    },
    {
      form: "a side-effect import beside the helper's own",
      source: 'import "x/register";\nimport { defineX } from "x";\n\nexport default defineX({});\n',
    },
    { form: "a call split across lines", source: 'import { defineX } from "x";\n\nexport default defineX(\n  {},\n);\n' },
    { form: "a call with no trailing semicolon", source: 'import { defineX } from "x";\n\nexport default defineX({})\n' },
  ]) {
    it(`accepts ${form}`, () => {
      expect(findingsOf(source)).toEqual([]);
    });
  }
});

describe("checkConfigFiles() — exports beside the default", () => {
  for (const { form, line } of [
    { form: "export const A = 1;", line: "export const A = 1;" },
    { form: "export { A };", line: "export { A };" },
    { form: "export type T = string;", line: "export type T = string;" },
    { form: "export function f() {\n  return 1;\n}", line: "export function f() {" },
  ]) {
    it(`fails \`${line}\`, naming the file, the line and the statement's first line`, () => {
      expect(findingsOf(`import { defineX } from "x";\n\nconst A = 1;\n${form}\n\nexport default defineX({ a: A });\n`)).toEqual([
        ["config/x.config.ts", 4, `exports \`${line}\` — a config module's only export is its default`],
      ]);
    });
  }
});

describe("checkConfigFiles() — the default export", () => {
  it("fails a module with no default export, naming the file and no line", () => {
    expect(findingsOf('import { defineX } from "x";\n\nconst A = defineX({});\n')).toEqual([
      ["config/x.config.ts", undefined, "has no default export"],
    ]);
  });

  for (const { source, form } of [
    { form: "an object literal", source: "export default { a: 1 };\n" },
    { form: "an object literal under `satisfies`", source: 'import type { T } from "x";\n\nexport default { a: 1 } satisfies T;\n' },
    { form: "a bare identifier", source: 'import { defineX } from "x";\n\nconst A = defineX({});\n\nexport default A;\n' },
    { form: "a call to a local define helper", source: "const defineX = <T>(x: T): T => x;\n\nexport default defineX({});\n" },
    { form: "a call to an imported helper not named define*", source: 'import { createX } from "x";\n\nexport default createX({});\n' },
    { form: "a call to a lower-case define", source: 'import { define } from "x";\n\nexport default define({});\n' },
    { form: "a call to a helper imported as a type only", source: 'import type { defineX } from "x";\n\nexport default defineX({});\n' },
    { form: "a call to a helper with an inline type specifier", source: 'import { type defineX } from "x";\n\nexport default defineX({});\n' },
    { form: "a define helper imported under another name", source: 'import { defineX as make } from "x";\n\nexport default make({});\n' },
    { form: "a member read off the call", source: 'import { defineX } from "x";\n\nexport default defineX({}).tiers;\n' },
    { form: "a member read on a continuation line", source: 'import { defineX } from "x";\n\nexport default defineX({})\n  .tiers;\n' },
  ]) {
    it(`fails ${form}, at the default's line`, () => {
      const line = source.split("\n").findIndex((text) => text.startsWith("export default")) + 1;

      expect(findingsOf(source)).toEqual([["config/x.config.ts", line, NOT_A_DEFINE_CALL]]);
    });
  }
});

describe("checkConfigFiles() — code that runs", () => {
  it("fails `import.meta.main` anywhere, at its line", () => {
    expect(findingsOf('import { defineX } from "x";\n\nconst DIRECT = import.meta.main;\n\nexport default defineX({ direct: DIRECT });\n')).toEqual(
      [["config/x.config.ts", 3, "runs code when executed directly (`import.meta.main`) — a config module only declares"]],
    );
  });

  it("fails an `import.meta.main` guard twice over, for the guard and for the statement holding it", () => {
    expect(findingsOf('import { defineX } from "x";\n\nif (import.meta.main) {\n  run();\n}\n\nexport default defineX({});\n')).toEqual([
      ["config/x.config.ts", 3, "runs code when executed directly (`import.meta.main`) — a config module only declares"],
      ["config/x.config.ts", 3, statement("if")],
    ]);
  });

  for (const { token, form } of [
    { token: "let", form: "let count = 1;" },
    { token: "var", form: "var count = 1;" },
    { token: "function", form: "function build() {\n  return 1;\n}" },
    { token: "await", form: "await Promise.resolve();" },
    { token: "register", form: "register();" },
    { token: "class", form: "class Table {}" },
    { token: "(", form: "(() => 1)();" },
  ]) {
    it(`fails a top-level \`${token}\` statement, at its line`, () => {
      expect(findingsOf(`import { defineX } from "x";\n\n${form}\n\nexport default defineX({});\n`)).toEqual([
        ["config/x.config.ts", 3, statement(token)],
      ]);
    });
  }

  it("reports every violation in a module, in source order, beside a broken default", () => {
    expect(findingsOf("let a = 1;\nexport const B = 2;\nexport default { a };\n")).toEqual([
      ["config/x.config.ts", 1, statement("let")],
      ["config/x.config.ts", 2, "exports `export const B = 2;` — a config module's only export is its default"],
      ["config/x.config.ts", 3, NOT_A_DEFINE_CALL],
    ]);
  });
});

describe("checkConfigFiles() — literals that read like code", () => {
  it("keeps scanning past a regex holding an unbalanced bracket, so a later statement is still judged", () => {
    expect(findingsOf('import { defineX } from "x";\n\nconst RE = /[(]/;\nexport let b = 1;\n\nexport default defineX({ re: RE });\n')).toEqual([
      ["config/x.config.ts", 4, "exports `export let b = 1;` — a config module's only export is its default"],
    ]);
  });

  it("passes a default call whose argument holds a regex with a closing bracket", () => {
    expect(findingsOf('import { defineX } from "x";\n\nexport default defineX({ re: /\\)/ });\n')).toEqual([]);
  });

  it("passes `import.meta.main` named inside a string", () => {
    expect(findingsOf('import { defineX } from "x";\n\nconst A = "import.meta.main";\n\nexport default defineX({ a: A });\n')).toEqual([]);
  });
});

describe("checkConfigFiles() — what it scans", () => {
  it("reads every `*.config.ts` directly under `config/`, failing each that breaks the shape", () => {
    const result = check({ "config/a.config.ts": PASSING, "config/b.config.ts": "export default {};\n", "config/c.config.ts": PASSING });

    expect([result.ok, result.findings.map((finding) => finding.file), result.summary]).toEqual([
      false,
      ["config/b.config.ts"],
      "3 config module(s)",
    ]);
  });

  it("holds only `*.config.ts` to the module shape, and never a config file outside `config/`", () => {
    const BROKEN = "export const A = 1;\n";

    expect(
      check({
        "config/x.config.ts": 'import { A } from "./paths";\nimport { defineX } from "x";\n\nexport default defineX({ A });\n',
        "config/paths.ts": BROKEN,
        "playwright.config.ts": BROKEN,
      }),
    ).toEqual({ ok: true, findings: [], summary: "1 config module(s)" });
  });

  for (const { files, tree } of [
    { tree: "a `config/` holding no config module", files: { "config/paths.ts": "export const A = 1;\n" } },
    { tree: "a root with no `config/` at all", files: { "x.config.ts": PASSING } },
  ]) {
    it(`refuses to report green over ${tree}`, () => {
      expect(check(files)).toEqual({
        ok: false,
        findings: [
          { level: "fail", message: "`config/` holds no `*.config.ts` module — refusing to report a green config-files gate that scanned nothing" },
        ],
        summary: "",
      });
    });
  }
});

describe("checkConfigFiles() — what `config/` holds", () => {
  const ENTRY = 'import { A } from "./data";\nimport { defineX } from "x";\n\nexport default defineX({ A });\n';
  const DATA = 'import { B } from "./more.ts";\n\nexport const A = B;\n';
  const TREE = { "config/x.config.ts": ENTRY, "config/data.ts": DATA, "config/more.ts": "export const B = 1;\n" };
  const found = (files: Record<string, string>, options: Omit<ConfigFileCheckConfig, "root"> = {}) =>
    check({ ...TREE, ...files }, options).findings.map((finding) => [finding.file, finding.message]);

  it("passes the entry points, the modules they import directly or through another, and the default state files", () => {
    expect(found({ "config/changelog-sections.json": "{}", "config/rules-baseline.json": "{}" })).toEqual([]);
  });

  it("fails a test file", () => {
    expect(found({ "config/x.test.ts": "" })).toEqual([
      ["config/x.test.ts", "is a test — a config gets no test; test the code that reads it, beside that code"],
    ]);
  });

  it("fails a script, at its `import.meta.main`, though an entry point imports it", () => {
    expect(
      check({ ...TREE, "config/data.ts": `${DATA}if (import.meta.main) run();\n` }).findings.map((finding) => [
        finding.file,
        finding.line,
        finding.message,
      ]),
    ).toEqual([["config/data.ts", 4, "runs code when executed directly (`import.meta.main`) — a script belongs beside the code it serves"]]);
  });

  it("fails a `.ts` nothing imports", () => {
    expect(found({ "config/orphan.ts": "export const C = 1;\n" })).toEqual([
      ["config/orphan.ts", "is a module no `*.config.ts` imports — fold it into the code that uses it, or delete it"],
    ]);
  });

  it("fails an undeclared `.json`, and passes it once `stateFiles` declares it", () => {
    const message = "is neither a module a `*.config.ts` imports nor a declared state file — move it, or declare it in `stateFiles`";

    expect(found({ "config/cache.json": "{}" })).toEqual([["config/cache.json", message]]);
    expect(found({ "config/cache.json": "{}" }, { stateFiles: ["config/cache.json"] })).toEqual([]);
  });

  it("passes `forge db`'s files at their `DB_LAYOUT` defaults, and fails any other subdirectory unless `stateDirs` declares it", () => {
    const db = {
      "config/db.config.ts": 'import { defineDb } from "x";\n\nexport default defineDb({});\n',
      [`${DB_LAYOUT.migrations}/0001_x.sql`]: "",
      [DB_LAYOUT.snapshot]: "{}",
      [DB_LAYOUT.types]: "export interface Row {}\n",
    };
    const message = "is a directory no tool is declared to write — move what it holds to the code it serves, or declare it in `stateDirs`";

    expect(found(db)).toEqual([]);
    expect(found({ ...db, "config/extra/x.json": "{}" })).toEqual([["config/extra", message]]);
    expect(found({ "config/extra/x.json": "{}" }, { stateDirs: ["config/extra/"] })).toEqual([]);
    expect(found(db, { stateDirs: [] })).toEqual([["config/db", message]]);
  });
});

describe("checkConfigFiles() — markdown off the formatter", () => {
  it("passes an `.oxfmtrc.json` ignoring `**/*.md`, and fails one that does not", () => {
    const formatter = (ignorePatterns: string[]) => ({ "config/x.config.ts": PASSING, ".oxfmtrc.json": JSON.stringify({ ignorePatterns }) });

    expect(check(formatter(["**/*.md"]), { markdown: true }).findings).toEqual([]);
    expect(check(formatter([]), { markdown: true }).findings.map((finding) => [finding.file, finding.message])).toEqual([
      [
        ".oxfmtrc.json",
        "`ignorePatterns` leaves out `**/*.md` while the table runs `validate-markdown` — the formatter and the check would own the same bytes",
      ],
    ]);
  });

  it("holds nothing to it without `markdown`", () => {
    expect(check({ "config/x.config.ts": PASSING, ".oxfmtrc.json": "{}" }).findings).toEqual([]);
  });
});

describe("checkConfigFiles() — the Playwright config's forge imports", () => {
  const playwright = (body: string) => ({ "config/x.config.ts": PASSING, "playwright.config.ts": body });

  it("passes a listed subpath, by specifier or by its source directory, and any import outside forge", () => {
    const body = [
      'import { defineConfig } from "@playwright/test";',
      'import { a } from "@y-core/forge/tooling/playwright";',
      'import { b } from "./src/tooling/playwright/config.ts";',
      'import { c } from "./tests/setup.ts";',
    ].join("\n");

    expect(check(playwright(body), { nodeSubpaths: ["./tooling/playwright"] }).findings).toEqual([]);
  });

  it("fails an unlisted subpath and a source module outside every listed one, at its line", () => {
    const body = ['import { a } from "@y-core/forge/ui/core";', 'import { b } from "./src/ui/core/mod.ts";'].join("\n");

    expect(check(playwright(body), { nodeSubpaths: ["./tooling/playwright"] }).findings.map((finding) => [finding.file, finding.line])).toEqual([
      ["playwright.config.ts", 1],
      ["playwright.config.ts", 2],
    ]);
  });

  it("passes a root with no Playwright config", () => {
    expect(check({ "config/x.config.ts": PASSING }, { nodeSubpaths: [] }).findings).toEqual([]);
  });
});

describe("checkConfigFiles() — baseline", () => {
  const OXLINT = JSON.stringify({ extends: [OXLINT_BASE], ignorePatterns: [".forge/**", ".types/**"] });
  const OXFMT = readFileSync(join(import.meta.dir, "../../config/oxfmt.base.json"), "utf-8");
  const TSCONFIG = JSON.stringify({
    extends: TSCONFIG_BASE,
    compilerOptions: { paths: { "@assets": ["./.forge/assets.ts"] } },
    include: ["src/**/*.ts"],
  });
  const CONFORMING = { "config/x.config.ts": PASSING, ".oxlintrc.json": OXLINT, ".oxfmtrc.json": OXFMT, "tsconfig.json": TSCONFIG };

  function baseline(files: Record<string, string>): [string | undefined, string][] {
    const root = gateFixtureRoot({ ...CONFORMING, ...files }, "forge-config-baseline-");
    roots.push(root);
    return checkConfigFiles({ root, baseline: true }).findings.map((finding) => [finding.file, finding.message]);
  }

  it("passes three configs that extend their bases and only add to them", () => {
    const oxlint = {
      extends: [OXLINT_BASE],
      ignorePatterns: [".forge/**", ".types/**", "src/vendor/**"],
      rules: { "forge/catalog-wrong-raw-input": "error" },
    };
    const oxfmt = { ...JSON.parse(OXFMT), ignorePatterns: [...JSON.parse(OXFMT).ignorePatterns, "**/*.md"] };
    const tsconfig = { extends: TSCONFIG_BASE, compilerOptions: { resolveJsonModule: true } };

    expect(
      baseline({ ".oxlintrc.json": JSON.stringify(oxlint), ".oxfmtrc.json": JSON.stringify(oxfmt), "tsconfig.json": JSON.stringify(tsconfig) }),
    ).toEqual([]);
  });

  it("holds none of the three configs unless asked, so a library keeps its own", () => {
    const root = gateFixtureRoot({ "config/x.config.ts": PASSING }, "forge-config-baseline-off-");
    roots.push(root);

    expect(checkConfigFiles({ root })).toEqual({ ok: true, findings: [], summary: "1 config module(s)" });
  });

  it("names each config that does not extend its base", () => {
    expect(baseline({ ".oxlintrc.json": JSON.stringify({ ignorePatterns: [".forge/**", ".types/**"] }), "tsconfig.json": "{}" })).toEqual([
      [".oxlintrc.json", `does not extend \`${OXLINT_BASE}\``],
      ["tsconfig.json", `does not extend \`${TSCONFIG_BASE}\``],
    ]);
  });

  it("names a local rule or compiler option that overrides a base key, which a local entry may only add to", () => {
    const oxlint = { extends: [OXLINT_BASE], ignorePatterns: [".forge/**", ".types/**"], rules: { "eslint/no-shadow": "off" } };
    const tsconfig = { extends: TSCONFIG_BASE, compilerOptions: { strict: false } };

    expect(baseline({ ".oxlintrc.json": JSON.stringify(oxlint), "tsconfig.json": JSON.stringify(tsconfig) })).toEqual([
      [".oxlintrc.json", "overrides the base's `eslint/no-shadow` — a local rule is an addition; a change to a base rule is made in the base"],
      ["tsconfig.json", "overrides the base's `strict` — a local compiler option is an addition; a change to a base one is made in the base"],
    ]);
  });

  it("names an oxlint key the base states, since a local value replaces the base's", () => {
    const oxlint = { extends: [OXLINT_BASE], ignorePatterns: [".forge/**", ".types/**"], jsPlugins: ["@y-core/forge/tooling/lint/plugin"] };

    expect(baseline({ ".oxlintrc.json": JSON.stringify(oxlint) })).toEqual([
      [".oxlintrc.json", "sets `jsPlugins` — the base states it, and a local value replaces the base's"],
    ]);
  });

  // oxlint does not inherit `ignorePatterns` through `extends`, so each repository states the generated trees itself.
  it("names a lint ignore list that leaves a generated tree out", () => {
    expect(baseline({ ".oxlintrc.json": JSON.stringify({ extends: [OXLINT_BASE], ignorePatterns: [".types/**"] }) })).toEqual([
      [".oxlintrc.json", "`ignorePatterns` leaves out `.forge/**`"],
    ]);
  });

  // `bun fmt` ignores `extends`, so the formatter's copy is compared key by key.
  it("names a formatter option that differs from the base and an ignore it dropped", () => {
    const oxfmt = { ...JSON.parse(OXFMT), printWidth: 100, ignorePatterns: [".claude"] };

    expect(
      baseline({ ".oxfmtrc.json": JSON.stringify(oxfmt) }).map(([file, message]) => [file, message.split(" — ")[0]?.split(" differs")[0]]),
    ).toEqual([
      [".oxfmtrc.json", "`printWidth`"],
      [
        ".oxfmtrc.json",
        "`ignorePatterns` leaves out `**/*.snapshot.json`, `.forge/**`, `.types/**`, `public/**`, `test-results/**`, `playwright-report/**`",
      ],
    ]);
  });

  it("names a `.jsonc` spelling, a missing config and an `exclude` beside `include`", () => {
    const tsconfig = { extends: TSCONFIG_BASE, include: ["src/**/*.ts"], exclude: ["tests/**"] };
    const root = gateFixtureRoot(
      { ...CONFORMING, ".oxlintrc.json": "", "tsconfig.json": JSON.stringify(tsconfig) },
      "forge-config-baseline-shape-",
    );
    roots.push(root);
    rmSync(join(root, ".oxlintrc.json"));
    writeFileSync(join(root, ".oxfmtrc.jsonc"), OXFMT);

    expect(checkConfigFiles({ root, baseline: true }).findings.map((finding) => [finding.file, finding.message])).toEqual([
      [".oxlintrc.json", "is missing"],
      [".oxfmtrc.jsonc", "name it `.oxfmtrc.json` — the fleet spells every tool config `.json`"],
      ["tsconfig.json", "has an `exclude` key — `include` is the whole answer"],
    ]);
  });

  it("reads comments and trailing commas, as oxlint and tsc do", () => {
    expect(baseline({ "tsconfig.json": `{\n  // the base\n  "extends": "${TSCONFIG_BASE}",\n  "include": ["src/**/*.ts"],\n}\n` })).toEqual([]);
  });
});
