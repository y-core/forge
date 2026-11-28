import { describe, expect, it } from "bun:test";

import { matchFindings, parseFindings, REVIEW_SUFFIX } from "./review";
import type { EvalTrap, ReviewFinding, TrapFiring } from "./types";

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    impact: "A Worker cannot load the module.",
    where: "src/sample/mod.ts:2, in `a`",
    what: "A node: import.",
    exploitScenario: "Deploying fails.",
    preconditions: "none",
    fix: "Use a Web API.",
    chunkIds: ["canon:CODE_RULES.md#1a"],
    ...overrides,
  };
}

function reply(json: string): string {
  return `Review done.\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

const trap: EvalTrap = {
  id: "node-import",
  rules: ["project:docs/FORGE_REVIEW.md#3b"],
  detector: { kind: "rg", pattern: "node:", paths: ["src"] },
};

const fired: TrapFiring = { fires: true, hits: [{ file: "src/sample/mod.ts", line: 10, text: 'import "node:fs";' }] };

describe("parseFindings()", () => {
  it("reads the findings from the last json fence", () => {
    const text = reply("[]") + reply(JSON.stringify([finding()]));
    expect(parseFindings(text)).toEqual({ findings: [finding()], reviewParseFailed: false });
  });

  it("accepts an empty array as a review with no findings", () => {
    expect(parseFindings(reply("[]"))).toEqual({ findings: [], reviewParseFailed: false });
  });

  it("drops fields beyond the seven it reads", () => {
    expect(parseFindings(reply(JSON.stringify([{ ...finding(), severity: "high" }]))).findings).toEqual([finding()]);
  });

  it.each([
    ["no fence", "No findings."],
    ["JSON that does not parse", reply("[{")],
    ["an object rather than an array", reply(JSON.stringify(finding()))],
    ["a finding missing a field", reply(JSON.stringify([{ ...finding(), chunkIds: undefined }]))],
  ])("yields no findings and flags the parse failure on %s", (_label, text) => {
    expect(parseFindings(text)).toEqual({ findings: [], reviewParseFailed: true });
  });

  it("asks for the json fence the parser reads", () => {
    expect(REVIEW_SUFFIX).toContain("```json");
    expect(REVIEW_SUFFIX).toContain('"chunkIds"');
  });
});

describe("matchFindings()", () => {
  it("catches a firing trap by a finding citing one of its rules, wherever it points", () => {
    const match = finding({ where: "elsewhere.ts:900", chunkIds: ["project:docs/FORGE_REVIEW.md#3b"] });
    expect(matchFindings([match], [trap], { "node-import": fired })).toEqual({ "node-import": "caught" });
  });

  it("catches a firing trap by a finding within three lines of a line its detector hit", () => {
    expect(matchFindings([finding({ where: "src/sample/mod.ts:13" })], [trap], { "node-import": fired })).toEqual({ "node-import": "caught" });
    expect(matchFindings([finding({ where: "./src/sample/mod.ts:7" })], [trap], { "node-import": fired })).toEqual({ "node-import": "caught" });
    expect(matchFindings([finding({ where: "/tmp/tree/src/sample/mod.ts:10" })], [trap], { "node-import": fired })).toEqual({
      "node-import": "caught",
    });
  });

  it("calls a firing trap no finding matches `through`", () => {
    const far = finding({ where: "src/sample/mod.ts:14" });
    const otherFile = finding({ where: "src/sample/other.ts:10" });
    expect(matchFindings([far, otherFile], [trap], { "node-import": fired })).toEqual({ "node-import": "through" });
    expect(matchFindings([], [trap], { "node-import": fired })).toEqual({ "node-import": "through" });
  });

  it("calls a trap that did not fire `clean`, even when a finding cites its rule", () => {
    const match = finding({ chunkIds: trap.rules });
    expect(matchFindings([match], [trap], { "node-import": { fires: false, hits: [] } })).toEqual({ "node-import": "clean" });
    expect(matchFindings([match], [trap], {})).toEqual({ "node-import": "clean" });
  });
});
