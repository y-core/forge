import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileFences,
  type FenceDiagnostic,
  type FenceSource,
  isParseDiagnostic,
  readDiagnostics,
  resolveCompiler,
  unresolvedName,
} from "./fence-compile";

const fakeFences: FenceSource[] = [
  { file: "design/forms.md", line: 10, body: "import { Badge } from '@y-core/forge/ui/core';\n\n<Badge tone='default'>New</Badge>;" },
  { file: "README.md", line: 40, body: "<Card.Subtitle>t</Card.Subtitle>;\nuse(errors);" },
];

describe("readDiagnostics()", () => {
  it("maps a fence file's row onto the markdown line its body starts on", () => {
    const stdout = "f0.tsx(3,8): error TS2322: Type '\"default\"' is not assignable to type 'Tone'.\n";

    expect(readDiagnostics(stdout, fakeFences)).toEqual([
      { fence: 0, file: "design/forms.md", line: 12, code: 2322, message: "Type '\"default\"' is not assignable to type 'Tone'." },
    ]);
  });

  it("blames the fence the file index names, not the first one", () => {
    const stdout = "f1.tsx(2,1): error TS2304: Cannot find name 'use'.\n";

    expect(readDiagnostics(stdout, fakeFences)).toEqual([
      { fence: 1, file: "README.md", line: 41, code: 2304, message: "Cannot find name 'use'." },
    ]);
  });

  it("takes the last indented continuation line as the message, the most specific of the chain", () => {
    const stdout = [
      "f0.tsx(3,2): error TS2322: Type '{ children: string; tone: \"default\"; }' is not assignable to type 'BadgeProps'.",
      "  Types of property 'tone' are incompatible.",
      "    Type '\"default\"' is not assignable to type 'Tone | undefined'.",
      "",
    ].join("\n");

    expect(readDiagnostics(stdout, fakeFences)).toEqual([
      { fence: 0, file: "design/forms.md", line: 12, code: 2322, message: "Type '\"default\"' is not assignable to type 'Tone | undefined'." },
    ]);
  });

  it("drops a diagnostic raised in a file that is not a fence, continuation included", () => {
    const stdout = [
      "f0.tsx(1,10): error TS2305: Module '\"@y-core/forge/ui/core\"' has no exported member 'Badge'.",
      "../src/ui/core/badge.tsx(4,3): error TS2322: Type 'number' is not assignable to type 'string'.",
      "  The expected type comes from property 'tone'.",
      "",
    ].join("\n");

    expect(readDiagnostics(stdout, fakeFences)).toEqual([
      { fence: 0, file: "design/forms.md", line: 10, code: 2305, message: "Module '\"@y-core/forge/ui/core\"' has no exported member 'Badge'." },
    ]);
  });

  it("drops a semantic diagnostic past the fence body, which is the appended module marker or an ambient declaration", () => {
    const stdout = "f1.tsx(4,15): error TS2300: Duplicate identifier 'rows'.\n";

    expect(readDiagnostics(stdout, fakeFences)).toEqual([]);
  });

  it("blames a parse error past the fence body on the fence's last body line, as an unclosed brace raises at end of file", () => {
    const stdout = "f1.tsx(3,1): error TS1005: '}' expected.\n";

    expect(readDiagnostics(stdout, fakeFences)).toEqual([{ fence: 1, file: "README.md", line: 41, code: 1005, message: "'}' expected." }]);
  });

  it("collapses a diagnostic repeated at one line, as a compound's closing tag repeats its opening tag's", () => {
    const stdout = [
      "f1.tsx(1,7): error TS2339: Property 'Subtitle' does not exist on type 'CardComponent'.",
      "f1.tsx(1,24): error TS2339: Property 'Subtitle' does not exist on type 'CardComponent'.",
      "",
    ].join("\n");

    expect(readDiagnostics(stdout, fakeFences)).toEqual([
      { fence: 1, file: "README.md", line: 40, code: 2339, message: "Property 'Subtitle' does not exist on type 'CardComponent'." },
    ]);
  });

  it("reads nothing from output with no diagnostic head", () => {
    expect(readDiagnostics("", fakeFences)).toEqual([]);
  });
});

describe("isParseDiagnostic()", () => {
  const cases = [
    { code: 1005, expected: true },
    { code: 2657, expected: true },
    { code: 17002, expected: true },
    { code: 2322, expected: false },
    { code: 2304, expected: false },
    { code: 18004, expected: false },
  ];

  for (const { code, expected } of cases) {
    it(`calls TS${code} ${expected ? "a parse error" : "a semantic error"}`, () => {
      expect(isParseDiagnostic(code)).toBe(expected);
    });
  }
});

describe("unresolvedName()", () => {
  const diagnostic = (code: number, message: string): FenceDiagnostic => ({ fence: 0, file: "design/forms.md", line: 1, code, message });
  const cases = [
    { code: 2304, message: "Cannot find name 'errors'.", expected: "errors" },
    { code: 2552, message: "Cannot find name 'Badg'. Did you mean 'Badge'?", expected: "Badg" },
    {
      code: 18004,
      message: "No value exists in scope for the shorthand property 'label'. Either declare one or provide an initializer.",
      expected: "label",
    },
    { code: 2322, message: "Type '\"default\"' is not assignable to type 'Tone'.", expected: undefined },
  ];

  for (const { code, message, expected } of cases) {
    it(`reads ${expected === undefined ? "no name" : `'${expected}'`} from TS${code}`, () => {
      expect(unresolvedName(diagnostic(code, message))).toBe(expected);
    });
  }
});

describe("compileFences()", () => {
  const compiler = resolveCompiler();
  const project = { tsconfig: fileURLToPath(new URL("../../../tests/fixtures/workers-consumer/tsconfig.json", import.meta.url)), paths: {} };
  const fenceDirs = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("forge-fences-"));

  it("resolves the installed compiler", () => {
    expect(compiler).toBeString();
  });

  it("reports a type error at the markdown line and removes its temp dir afterwards", () => {
    const before = fenceDirs();
    const diagnostics = compileFences(compiler ?? "", [{ file: "design/types.md", line: 7, body: "const count: number = 'one';" }], project);

    expect(diagnostics).toEqual({
      ok: true,
      data: [{ fence: 0, file: "design/types.md", line: 7, code: 2322, message: "Type 'string' is not assignable to type 'number'." }],
    });
    expect(fenceDirs()).toEqual(before);
  });

  it("declares a fence's ambient names, so app context compiles", () => {
    const fences = [{ file: "design/context.md", line: 3, body: "const count: number = rows.length;" }];

    expect(compileFences(compiler ?? "", fences, project)).toEqual({
      ok: true,
      data: [{ fence: 0, file: "design/context.md", line: 3, code: 2304, message: "Cannot find name 'rows'." }],
    });
    expect(compileFences(compiler ?? "", fences, project, new Map([[0, ["rows"]]]))).toEqual({ ok: true, data: [] });
  });

  it("checks a fence against the step tsconfig's ambient declarations, so a wrong ExecutionContext fails", () => {
    const body = "const ctx: ExecutionContext = { waitUntil: (pending: number) => {}, passThroughOnException: () => {} };";

    expect(compileFences(compiler ?? "", [{ file: "design/worker.md", line: 4, body }], project)).toEqual({
      ok: true,
      data: [{ fence: 0, file: "design/worker.md", line: 4, code: 2322, message: "Type 'Promise<unknown>' is not assignable to type 'number'." }],
    });
  });

  it("passes a fence that uses ExecutionContext as workerd declares it", () => {
    const body = "const ctx: ExecutionContext = { waitUntil: () => {}, passThroughOnException: () => {} };";

    expect(compileFences(compiler ?? "", [{ file: "design/worker.md", line: 4, body }], project)).toEqual({ ok: true, data: [] });
  });

  it("fails rather than dropping a diagnostic raised outside the fences", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-fence-module-"));
    try {
      writeFileSync(join(dir, "broken.ts"), "export const count: number = 'one';\n");
      const fences = [{ file: "design/import.md", line: 5, body: "import { count } from 'broken';\ncount;" }];
      const result = compileFences(compiler ?? "", fences, { ...project, paths: { broken: [join(dir, "broken.ts")] } });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toStartWith("tsc reported a diagnostic outside the fences: ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the step tsconfig cannot be read", () => {
    const absent = { tsconfig: join(tmpdir(), "forge-fences-absent", "tsconfig.json"), paths: {} };
    const result = compileFences(compiler ?? "", [{ file: "design/types.md", line: 7, body: "const count: number = 'one';" }], absent);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toStartWith("cannot read the step tsconfig ");
  });

  it("fails rather than reporting no diagnostic when the compiler exits non-zero without one", () => {
    const missing = join(tmpdir(), "forge-fences-absent-compiler", "tsc.js");
    const result = compileFences(missing, [{ file: "design/types.md", line: 7, body: "const count: number = 'one';" }], project);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toStartWith("tsc exited ");
  });
});
