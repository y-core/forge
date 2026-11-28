import { describe, expect, it } from "bun:test";

import { MODERN_CSS_CITED_RULES, MODERN_CSS_RULES, modernCssRule } from "./modern-css-rules";
import type { ModernCssCitedRuleId, ModernCssRuleId } from "./types";

const MINTED = Object.keys(MODERN_CSS_RULES) as ModernCssRuleId[];

const CITED = Object.keys(MODERN_CSS_CITED_RULES) as ModernCssCitedRuleId[];

describe("modernCssRule()", () => {
  it("resolves every minted id to its own row, over a table that is not empty", () => {
    const unresolved = MINTED.filter((id) => modernCssRule(id) !== MODERN_CSS_RULES[id]);

    expect({ minted: MINTED.length === 0, unresolved }).toEqual({ minted: false, unresolved: [] });
  });

  it("resolves every cited id to the corpus row rather than to a minted one, over a table that is not empty", () => {
    const unresolved = CITED.filter((id) => modernCssRule(id) !== MODERN_CSS_CITED_RULES[id]);

    expect({ cited: CITED.length === 0, unresolved }).toEqual({ cited: false, unresolved: [] });
  });
});

describe("MODERN_CSS_RULES — the ids it may mint", () => {
  it("mints no id it also cites, which would shadow the cited row", () => {
    expect(MINTED.filter((id) => (CITED as string[]).includes(id))).toEqual([]);
  });
});

describe("MODERN_CSS_RULES — what a finding can promise", () => {
  it("fails only on the textual tier, the one tier the check reads source to decide", () => {
    expect(MINTED.filter((id) => modernCssRule(id).severity === "fail" && modernCssRule(id).tier !== "A")).toEqual([]);
  });
});
