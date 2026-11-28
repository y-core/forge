import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { corpusWords, countWords, detectorClass, ownedDocuments, ruleStats } from "./stats";
import type { RuleEntry } from "./types";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function detected(...detectors: RuleEntry["detectors"]): Pick<RuleEntry, "detectors"> {
  return { detectors };
}

describe("detectorClass()", () => {
  it("takes the strongest detector a rule carries", () => {
    expect(detectorClass(detected({ kind: "review" }, { kind: "step", label: "lint" }))).toBe("automated");
    expect(detectorClass(detected({ kind: "runtime" }, { kind: "lint", key: "forge/a" }))).toBe("automated");
    expect(detectorClass(detected({ kind: "runtime" }, { kind: "test", path: "src/a.test.ts" }))).toBe("test");
    expect(detectorClass(detected({ kind: "review" }, { kind: "runtime" }))).toBe("runtime");
    expect(detectorClass(detected({ kind: "review" }, { kind: "rg", pattern: "x", paths: ["."], level: "fail" }))).toBe("automated");
    expect(detectorClass(detected({ kind: "runtime" }, { kind: "rg", pattern: "x", paths: ["."], level: "warn", triage: "t" }))).toBe("triaged");
    expect(
      detectorClass(detected({ kind: "test", path: "a.test.ts" }, { kind: "rg", pattern: "x", paths: ["."], level: "warn", triage: "t" })),
    ).toBe("test");
    expect(detectorClass(detected({ kind: "review" }))).toBe("review-only");
  });
});

describe("ruleStats()", () => {
  it("counts every class, naming an empty one as zero", () => {
    const stats = ruleStats([detected({ kind: "review" }), detected({ kind: "review" }), detected({ kind: "lint", key: "forge/a" })]);

    expect(stats).toEqual({ total: 3, byClass: { automated: 1, test: 0, triaged: 0, runtime: 0, "review-only": 2 } });
  });
});

describe("countWords()", () => {
  it("counts whitespace tokens holding a letter or digit, so punctuation alone is no word", () => {
    expect(countWords("One two, — 3 | four.\n\n- five\n")).toBe(5);
  });

  it("ignores frontmatter, fenced code, HTML comments and link reference definitions", () => {
    const source = [
      "---",
      "title: Not counted",
      "---",
      "",
      "<!-- rule:forge-a --> Counted words here.",
      "",
      "```ts",
      "const never = counted;",
      "```",
      "",
      "<!--",
      "a comment across lines",
      "-->",
      "",
      "[ref]: https://example.com/never-counted",
      "See [ref].",
    ].join("\n");

    expect(countWords(source)).toBe(5);
  });
});

describe("ownedDocuments() and corpusWords()", () => {
  const files = {
    "canon/shared/AGENT_GUIDE.md": "Shared canon words.\n",
    "canon/apps/APPS.md": "Apps canon.\n",
    "docs/OWN.md": "Own document prose here.\n",
  };

  function fixture(): string {
    const root = gateFixtureRoot(files, "warden-rules-stats-");
    roots.push(root);
    return root;
  }

  it("is the repository's own documents alone where it is not the canon's home", () => {
    const root = fixture();

    expect(ownedDocuments(root, "libs", false, join(root, "canon"))).toEqual(["docs/OWN.md"]);
  });

  it("adds every canon tree, repository-relative, where it is the canon's home", () => {
    const root = fixture();

    expect(ownedDocuments(root, "libs", true, join(root, "canon")).sort()).toEqual([
      "canon/apps/APPS.md",
      "canon/shared/AGENT_GUIDE.md",
      "docs/OWN.md",
    ]);
  });

  it("counts each document's words by its path", () => {
    const root = fixture();

    expect([...corpusWords(root, ["docs/OWN.md", "canon/apps/APPS.md"])]).toEqual([
      ["docs/OWN.md", 4],
      ["canon/apps/APPS.md", 2],
    ]);
  });
});
