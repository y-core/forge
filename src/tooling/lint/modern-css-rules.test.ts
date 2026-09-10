import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { RULE_CORPUS_PATH } from "./design-rules";
import { MODERN_CSS_CITED_RULES, MODERN_CSS_RULES, modernCssRule } from "./modern-css-rules";
import type { ModernCssCitedRuleId, ModernCssRuleId } from "./types";

const ROOT = resolve(import.meta.dir, "../../..");

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
  it("mints no id the design register already owns, which would silently take the register's corpus path", () => {
    expect(MINTED.filter((id) => id in RULE_CORPUS_PATH)).toEqual([]);
  });

  it("cites only ids the design register owns, so the lint reporter resolves them there", () => {
    expect(CITED.filter((id) => !(id in RULE_CORPUS_PATH))).toEqual([]);
  });

  it("cites each one at the corpus file the register states, so both reporters name the same document", () => {
    expect(CITED.map((id) => [id, modernCssRule(id).corpus])).toEqual(CITED.map((id) => [id, RULE_CORPUS_PATH[id]]));
  });
});

describe("MODERN_CSS_RULES — what a finding can promise", () => {
  it("names a corpus file that exists, since every finding sends a reader to it", () => {
    const missing = [...MINTED, ...CITED].filter((id) => !existsSync(resolve(ROOT, modernCssRule(id).corpus)));

    expect(missing).toEqual([]);
  });

  it("fails only on the textual tier, the one tier the check reads source to decide", () => {
    expect(MINTED.filter((id) => modernCssRule(id).severity === "fail" && modernCssRule(id).tier !== "A")).toEqual([]);
  });
});
