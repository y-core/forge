import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fail } from "../finding";
import { checkCoLocation } from "./co-location";

/** A throwaway root holding exactly the files given — a bare path is written empty. */
function fixtureRoot(...files: (string | Record<string, string>)[]): string {
  const root = mkdtempSync(join(tmpdir(), "forge-co-location-"));
  const tree = Object.fromEntries(files.flatMap((entry) => (typeof entry === "string" ? [[entry, ""]] : Object.entries(entry))));
  for (const [path, contents] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents, "utf-8");
  }
  return root;
}

const messages = (root: string, exempt: ReadonlyMap<string, string> = new Map()): string[] =>
  checkCoLocation({ root, sources: ["src/ui"], exempt }).findings.map((finding) => finding.message);

const reasoned = (...paths: string[]): ReadonlyMap<string, string> => new Map(paths.map((path) => [path, "a stated reason"]));

describe("checkCoLocation()", () => {
  it("passes a module with a co-located test beside it", () => {
    expect(messages(fixtureRoot("src/ui/core/button.tsx", "src/ui/core/button.test.tsx"))).toEqual([]);
  });

  it("reports a module with none", () => {
    expect(messages(fixtureRoot("src/ui/core/button.tsx"))).toEqual(["no co-located test"]);
  });

  it("asks nothing of a barrel or of a test file itself", () => {
    expect(messages(fixtureRoot("src/ui/core/mod.ts", "src/ui/core/button.test.tsx"))).toEqual([]);
  });

  it("accepts an exemption that names a walked module", () => {
    expect(messages(fixtureRoot("src/ui/core/button.tsx"), reasoned("src/ui/core/button.tsx"))).toEqual([]);
  });

  it("fails an exemption that names no walked module — the list only shrinks", () => {
    expect(messages(fixtureRoot("src/ui/core/button.tsx", "src/ui/core/button.test.tsx"), reasoned("src/ui/core/gone.ts"))).toEqual([
      "`src/ui/core/gone.ts` is exempt from the co-location check but is not a module it walks — delete the entry",
    ]);
  });

  it("fails an exemption whose reason is blank, because a reason is what makes it auditable", () => {
    expect(messages(fixtureRoot("src/ui/core/button.tsx"), new Map([["src/ui/core/button.tsx", "   "]]))).toEqual([
      "`src/ui/core/button.tsx` is exempt from the co-location check with no reason — say why, or give it a test",
    ]);
  });
});

describe("checkCoLocation() — the filename conventions", () => {
  it("asks no test of a `types.ts` or a `bin.ts`, without an entry in the map", () => {
    expect(messages(fixtureRoot("src/ui/types.ts", "src/ui/bin.ts"))).toEqual([]);
  });

  it("passes a `types.ts` that declares data, because a const object is not callable", () => {
    expect(messages(fixtureRoot({ "src/ui/types.ts": "export const TABLE = { a: 1 };\n" }))).toEqual([]);
  });

  it("fails a `types.ts` that exports a function — the claim the name makes is re-checked", () => {
    expect(messages(fixtureRoot({ "src/ui/types.ts": "export function smuggled(): void {}\n" }))).toEqual([
      "`types.ts` needs no co-located test only while it declares — this one exports a callable",
    ]);
  });

  it("fails a `bin.ts` that exports a function on the same terms", () => {
    expect(messages(fixtureRoot({ "src/ui/bin.ts": "export const run = () => {};\n" }))).toEqual([
      "`bin.ts` needs no co-located test only while it declares — this one exports a callable",
    ]);
  });

  it("says nothing of a `types.ts` that has a test anyway, callable or not", () => {
    expect(messages(fixtureRoot({ "src/ui/types.ts": "export function smuggled(): void {}\n", "src/ui/types.test.ts": "" }))).toEqual([]);
  });
});

describe("checkCoLocation() — the vacuity refusal", () => {
  it("refuses a walk that matched no file, rather than reporting a green gate over nothing", () => {
    const result = checkCoLocation({ root: fixtureRoot(), sources: ["src/ui"] });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src/ui` matched no file — refusing to report a green co-location gate that scanned nothing")]);
    expect(result.summary).toBe("");
  });

  it("still judges a walk whose every module is exempt, because the raw walk is what it guards", () => {
    const result = checkCoLocation({
      root: fixtureRoot("src/ui/a.ts", "src/ui/a.test.ts"),
      sources: ["src/ui"],
      exempt: reasoned("src/ui/gone.ts"),
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src/ui/gone.ts` is exempt from the co-location check but is not a module it walks — delete the entry",
    ]);
  });
});
