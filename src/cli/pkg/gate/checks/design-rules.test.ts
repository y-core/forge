import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isValidRuleId } from "./design-parse";
import { corpusIdOf, lintKeyOf, RULE_CORPUS_PATH, RULE_ENFORCER, type RuleId } from "./design-rules";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const ids: RuleId[] = [
  "forge-ui-color-token-only",
  "forge-ui-color-theme-no-raw-utility",
  "forge-ui-no-inline-style",
  "forge-ui-spacing-scale-only",
  "forge-ui-no-nested-card",
  "forge-ui-interaction-focus-visible",
  "forge-ui-catalog-wrong-raw-input",
  "forge-ui-contrast-floor",
  "forge-ui-a11y-label-association",
  "forge-ui-a11y-live-politeness",
  "forge-ui-a11y-no-aria-readonly-on-button",
  "forge-ui-a11y-one-live-region",
  "forge-ui-a11y-aria-beside-data",
  "forge-ui-a11y-heading-size-by-class",
  "forge-ui-reduced-motion",
  "forge-ui-focus-ring",
];

describe("RULE_CORPUS_PATH", () => {
  it("carries exactly the enforced rules", () => {
    expect(Object.keys(RULE_CORPUS_PATH).sort()).toEqual([...ids].sort());
  });

  it("routes every rule to a file that exists under src/ui/design/", () => {
    const missing = Object.entries(RULE_CORPUS_PATH).filter(([, path]) => !path.startsWith("src/ui/design/") || !existsSync(resolve(ROOT, path)));

    expect(missing).toEqual([]);
  });

  it("names a well-formed id for every key", () => {
    expect(Object.keys(RULE_CORPUS_PATH).filter((id) => !isValidRuleId(id))).toEqual([]);
  });
});

describe("RULE_ENFORCER", () => {
  it("names an enforcer for exactly the rules RULE_CORPUS_PATH routes", () => {
    expect(Object.keys(RULE_ENFORCER).sort()).toEqual(Object.keys(RULE_CORPUS_PATH).sort());
  });
});

describe("lintKeyOf() / corpusIdOf()", () => {
  it("round-trips every rule id through its plugin key", () => {
    const roundTripped = ids.map((id) => corpusIdOf(lintKeyOf(id)));

    expect(roundTripped).toEqual(ids);
  });

  it("strips the `forge-ui-` prefix and nothing else", () => {
    expect(lintKeyOf("forge-ui-spacing-scale-only")).toBe("spacing-scale-only");
  });

  it("answers undefined for a key the register does not name", () => {
    expect(corpusIdOf("suppression-needs-reason")).toBeUndefined();
  });
});

describe("the register's dependency-free property", () => {
  it("imports nothing, so forge's oxlint plugin can read it", () => {
    const own = readFileSync(resolve(ROOT, "src/cli/pkg/gate/checks/design-rules.ts"), "utf-8");

    expect(own.match(/^\s*import\b/m)).toBeNull();
  });
});
