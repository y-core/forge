import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STUBS = ["node.d.ts", "bun.d.ts"] as const;

// Each `declare module "…" { … }` block is cut out by brace depth, so what remains is the file's top level.
function topLevel(source: string): string {
  const code = source.replace(/\/\/.*$/gm, "");
  let depth = 0;
  let kept = "";
  for (const char of code) {
    if (char === "{") depth++;
    if (depth === 0) kept += char;
    if (char === "}") depth--;
  }
  return kept.replace(/declare module\s+"[^"]+"\s*/g, "");
}

describe("the published testing stubs", () => {
  for (const stub of STUBS) {
    it(`${stub} declares modules only, so a Worker program under "types": [] gains no global`, () => {
      const source = readFileSync(join(import.meta.dir, stub), "utf-8");
      expect(source).not.toMatch(/\bdeclare\s+global\b/);
      expect(topLevel(source).trim()).toBe("");
    });
  }

  it("reads a top-level declaration as one, so the check above is not vacuous", () => {
    expect(topLevel('declare module "node:os" { export function tmpdir(): string; }\ndeclare const process: unknown;\n').trim()).toBe(
      "declare const process: unknown;",
    );
    expect(topLevel('declare module "x" {}\ninterface Buffer { length: number }\n').trim()).toBe("interface Buffer");
  });
});
