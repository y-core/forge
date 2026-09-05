import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fail } from "../finding";
import { checkCoLocation } from "./co-location";

/** A throwaway root holding exactly the files given. */
function fixtureRoot(...files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "forge-co-location-"));
  for (const path of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "", "utf-8");
  }
  return root;
}

const messages = (root: string, exempt: readonly string[] = []): string[] =>
  checkCoLocation({ root, sources: ["src/ui"], exempt }).findings.map((finding) => finding.message);

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
    expect(messages(fixtureRoot("src/ui/core/button.tsx"), ["src/ui/core/button.tsx"])).toEqual([]);
  });

  it("fails an exemption that names no walked module — the list only shrinks", () => {
    expect(messages(fixtureRoot("src/ui/core/button.tsx", "src/ui/core/button.test.tsx"), ["src/ui/core/gone.ts"])).toEqual([
      "`src/ui/core/gone.ts` is exempt from the co-location check but is not a module it walks — delete the entry",
    ]);
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
    const result = checkCoLocation({ root: fixtureRoot("src/ui/a.ts", "src/ui/a.test.ts"), sources: ["src/ui"], exempt: ["src/ui/gone.ts"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src/ui/gone.ts` is exempt from the co-location check but is not a module it walks — delete the entry",
    ]);
  });
});
