import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { renderStatements, ruleStatements, statementsDigest } from "./render";

const DEFINE = resolve(import.meta.dir, "define.ts");

const STATEMENTS = new Map([["forge-x", "Never do x."]]);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function ruleFile(id: string, statement: string): string {
  return `import { defineRules } from ${JSON.stringify(DEFINE)};\nexport default defineRules([{ id: "${id}", statement: "${statement}", detectors: [{ kind: "review" }] }]);\n`;
}

describe("renderStatements()", () => {
  it("renders a marker's statement in bold ahead of it", () => {
    expect(renderStatements("<!-- rule:forge-x --> Because y.\n", STATEMENTS)).toBe("**Never do x.** <!-- rule:forge-x --> Because y.\n");
  });

  it("renders a marker opening a list item or a table cell in place", () => {
    expect(renderStatements("- <!-- rule:forge-x --> Because.\n| a | <!-- rule:forge-x --> b |", STATEMENTS)).toBe(
      "- **Never do x.** <!-- rule:forge-x --> Because.\n| a | **Never do x.** <!-- rule:forge-x --> b |",
    );
  });

  it("leaves a marker inside a fence or a code span untouched", () => {
    const source = "```md\n<!-- rule:forge-x -->\n```\n\nQuote `<!-- rule:forge-x -->` here.\n";

    expect(renderStatements(source, STATEMENTS)).toBe(source);
  });

  it("leaves a marker whose id has no statement as written", () => {
    expect(renderStatements("<!-- rule:forge-unknown --> Because.", STATEMENTS)).toBe("<!-- rule:forge-unknown --> Because.");
  });
});

describe("statementsDigest()", () => {
  it("is independent of insertion order and moves with any statement", () => {
    const a = new Map([
      ["forge-a", "A."],
      ["forge-b", "B."],
    ]);
    const b = new Map([
      ["forge-b", "B."],
      ["forge-a", "A."],
    ]);

    expect(statementsDigest(a)).toBe(statementsDigest(b));
    expect(statementsDigest(a)).not.toBe(
      statementsDigest(
        new Map([
          ["forge-a", "A."],
          ["forge-b", "C."],
        ]),
      ),
    );
  });
});

describe("ruleStatements()", () => {
  it("reads the repository's rule file and the installed library's", () => {
    const root = gateFixtureRoot({ "config/rules.config.ts": ruleFile("app-x", "Never do x.") }, "warden-render-app-");
    const library = gateFixtureRoot({ "config/rules.config.ts": ruleFile("forge-y", "Never do y.") }, "warden-render-lib-");
    roots.push(root, library);

    const statements = ruleStatements({ root, kind: "apps", trees: [], dependencyRoot: library });

    expect(statements.get("app-x")).toBe("Never do x.");
    expect(statements.get("forge-y")).toBe("Never do y.");
  });

  it("throws the loader's message when a rule file does not load", () => {
    const root = gateFixtureRoot({ "config/rules.config.ts": "export default 1;\n" }, "warden-render-bad-");
    roots.push(root);

    expect(() => ruleStatements({ root, kind: "libs", trees: [] })).toThrow("default export is not an array");
  });
});
