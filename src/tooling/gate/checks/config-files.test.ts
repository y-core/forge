import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import type { CheckResult } from "../types";
import { checkConfigFiles } from "./config-files";
import { gateFixtureRoot } from "./gate.fixture";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function check(files: Record<string, string>): CheckResult {
  const root = gateFixtureRoot(files, "forge-config-files-");
  roots.push(root);
  return checkConfigFiles({ root });
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

  it("ignores a plain module, a spec named like a config, a nested config directory and a config file outside `config/`", () => {
    const BROKEN = "if (import.meta.main) run();\nexport const A = 1;\n";

    expect(
      check({
        "config/x.config.ts": PASSING,
        "config/paths.ts": BROKEN,
        "config/bundles.ts": BROKEN,
        "config/x.config.test.ts": BROKEN,
        "config/db/inner.config.ts": BROKEN,
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
