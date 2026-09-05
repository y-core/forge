import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fail } from "../finding";
import { checkJsx, resolveJsxSources, validateJsxSource } from "./jsx";

const PRAGMAS = ["@jsxRuntime automatic", "@jsxImportSource @y-core/forge/jsx"];
const HEADER = `/** @jsxRuntime automatic */\n/** @jsxImportSource @y-core/forge/jsx */\n`;

/** A throwaway repository root holding exactly the files given. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-jsx-check-"));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

describe("validateJsxSource() — the pragma rule", () => {
  it("returns nothing for a file carrying both pragmas", () => {
    expect(validateJsxSource("src/a.tsx", `${HEADER}export const A = () => <div />;`, PRAGMAS)).toEqual([]);
  });

  it("names each missing pragma verbatim, so the fix is copy-pasteable", () => {
    const findings = validateJsxSource("src/a.tsx", "export const A = () => <div />;", PRAGMAS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe("fail");
    expect(findings[0]?.file).toBe("src/a.tsx");
    expect(findings[0]?.detail).toEqual(["missing: /** @jsxRuntime automatic */", "missing: /** @jsxImportSource @y-core/forge/jsx */"]);
  });

  it("reports only the pragma that is actually absent", () => {
    const source = "/** @jsxRuntime automatic */\nexport const A = () => <div />;";

    expect(validateJsxSource("src/a.tsx", source, PRAGMAS)[0]?.detail).toEqual(["missing: /** @jsxImportSource @y-core/forge/jsx */"]);
  });

  it("accepts a project that declares its own pragmas", () => {
    expect(validateJsxSource("src/a.tsx", "/** @jsxImportSource preact */", ["@jsxImportSource preact"])).toEqual([]);
  });

  // The ordering half of the JSX contract moved to `forge/data-slot-before-spread`, whose spec is
  // `src/tooling/lint/rules/data-slot-before-spread.test.ts`.
  it("leaves a clobberable `data-slot` to the linter, which reads it off the AST", () => {
    const source = `${HEADER}export const A = (rest) => <div data-slot="card" {...rest} />;`;

    expect(validateJsxSource("src/a.tsx", source, PRAGMAS)).toEqual([]);
  });
});

describe("resolveJsxSources()", () => {
  it("walks nested directories and skips test files", () => {
    const root = fixtureRoot({ "src/a.tsx": HEADER, "src/deep/b.tsx": HEADER, "src/a.test.tsx": HEADER, "src/c.ts": "export const c = 1;" });

    expect(
      resolveJsxSources({ root })
        .map((file) => file.slice(root.length + 1))
        .sort(),
    ).toEqual(["src/a.tsx", "src/deep/b.tsx"]);
  });

  it("walks every configured source directory", () => {
    const root = fixtureRoot({ "src/a.tsx": HEADER, "app/b.tsx": HEADER });

    expect(resolveJsxSources({ root, sources: ["src", "app"] })).toHaveLength(2);
  });
});

describe("checkJsx()", () => {
  it("passes a clean tree and says how many files it covered", () => {
    const result = checkJsx({ root: fixtureRoot({ "src/a.tsx": HEADER, "src/b.tsx": HEADER }) });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("2 .tsx files carry every JSX pragma.");
  });

  it("refuses a zero-file walk rather than reporting a green gate that judged nothing", () => {
    const result = checkJsx({ root: fixtureRoot({ "src/only.ts": "export const x = 1;" }) });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src` matched no `.tsx` file — refusing to report a green jsx gate that scanned nothing")]);
    expect(result.summary).toBe("");
  });

  it("fails a tree with a violation, and closes with the rule it violated", () => {
    const result = checkJsx({ root: fixtureRoot({ "src/a.tsx": HEADER, "src/bad.tsx": "export const B = () => <div />;" }) });

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]?.file).toBe("src/bad.tsx");
    expect(result.findings[1]?.message).toContain("must carry every JSX pragma line");
  });

  it("reports paths relative to the root, never absolute", () => {
    const root = fixtureRoot({ "src/deep/bad.tsx": "export const B = () => <div />;" });
    const result = checkJsx({ root });

    expect(result.findings[0]?.file).toBe("src/deep/bad.tsx");
  });
});
