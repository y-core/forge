import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { appendForgeDev, DEV_CONDITION, WRANGLER_CONDITIONS } from "./conditions";

const WRANGLER_CLI = fileURLToPath(import.meta.resolve("wrangler"));

function matchOnce(source: string, anchor: RegExp, label: string): RegExpExecArray {
  const matches = [...source.matchAll(anchor)];
  if (matches.length !== 1) throw new Error(`${WRANGLER_CLI}: ${label} not found exactly once (found ${matches.length})`);
  return matches[0]!;
}

function wranglerDefaultConditions(): string[] {
  const cli = readFileSync(WRANGLER_CLI, "utf-8");
  const [, body] = matchOnce(cli, /function getBuildConditions\(\) \{([\s\S]*?)\n\}/g, "function getBuildConditions()");
  const [, literal] = matchOnce(body!, /return (\[[^\]]*\]);/g, "the default conditions literal in getBuildConditions()");
  matchOnce(cli, /conditions: getBuildConditions\(\)/g, "conditions: getBuildConditions()");
  return JSON.parse(literal!) as string[];
}

describe("appendForgeDev", () => {
  it("starts from wrangler's default conditions when the variable is unset", () => {
    expect(appendForgeDev(undefined)).toBe("workerd,worker,browser,forge-dev");
  });

  it("keeps an existing list in its order and appends forge-dev after it", () => {
    expect(appendForgeDev("workerd,custom")).toBe("workerd,custom,forge-dev");
  });

  it("does not repeat forge-dev when the list already carries it", () => {
    expect(appendForgeDev("workerd,forge-dev,custom")).toBe("workerd,custom,forge-dev");
  });

  it("drops the empty entries a stray comma or whitespace leaves", () => {
    expect(appendForgeDev(" workerd, ,worker ,")).toBe("workerd,worker,forge-dev");
  });

  it("treats a set but empty variable as an empty list rather than as unset", () => {
    expect(appendForgeDev("")).toBe("forge-dev");
  });
});

describe("the condition constants", () => {
  it("match the default conditions in the installed wrangler's bundle", () => {
    expect(WRANGLER_CONDITIONS).toEqual(wranglerDefaultConditions());
  });

  it("name forge's development condition", () => {
    expect(DEV_CONDITION).toBe("forge-dev");
  });
});
