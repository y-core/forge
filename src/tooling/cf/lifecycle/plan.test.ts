import { describe, expect, it } from "bun:test";

import { desiredLifecycleRule, forgeRuleId, planLifecycle, readLifecycleRetention } from "./plan";
import type { R2LifecycleRule } from "./types";

const FOREIGN: R2LifecycleRule = {
  id: "media-tmp",
  enabled: true,
  conditions: { prefix: "tmp/" },
  abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 86_400 } },
};

describe("readLifecycleRetention()", () => {
  it("reads days and a prefix, ending the prefix in a slash so it cannot match a sibling", () => {
    expect(readLifecycleRetention({ "expire-days": "90", "ia-days": "30" })).toEqual({
      prefix: "d1-backups/",
      expireAfterDays: 90,
      infrequentAccessAfterDays: 30,
    });
    expect(readLifecycleRetention({ "expire-days": "7", prefix: "ops/dumps" }).prefix).toBe("ops/dumps/");
  });

  it("refuses no retention, a non-number, and a move to Infrequent Access no earlier than the expiry", () => {
    expect(() => readLifecycleRetention({})).toThrow("name a retention: --expire-days, --ia-days, or both");
    expect(() => readLifecycleRetention({ "expire-days": "0" })).toThrow("--expire-days takes a whole number of days, not 0");
    expect(() => readLifecycleRetention({ "expire-days": "30", "ia-days": "30" })).toThrow("--ia-days 30 is not before --expire-days 30");
  });
});

describe("desiredLifecycleRule()", () => {
  it("expires and moves by age in seconds under forge's own id for the prefix", () => {
    expect(desiredLifecycleRule({ prefix: "d1-backups/", expireAfterDays: 2, infrequentAccessAfterDays: 1 })).toEqual({
      id: "forge-d1-backups",
      enabled: true,
      conditions: { prefix: "d1-backups/" },
      deleteObjectsTransition: { condition: { type: "Age", maxAge: 172_800 } },
      storageClassTransitions: [{ condition: { type: "Age", maxAge: 86_400 }, storageClass: "InfrequentAccess" }],
    });
  });

  it("carries only the transitions asked for", () => {
    const rule = desiredLifecycleRule({ prefix: "d1-backups/", expireAfterDays: null, infrequentAccessAfterDays: 3 });
    expect([rule.deleteObjectsTransition, rule.storageClassTransitions?.length]).toEqual([undefined, 1]);
  });
});

describe("forgeRuleId()", () => {
  it("derives a stable id from the prefix", () => {
    expect([forgeRuleId("d1-backups/"), forgeRuleId("ops/dumps/"), forgeRuleId("")]).toEqual(["forge-d1-backups", "forge-ops-dumps", "forge-all"]);
  });
});

describe("planLifecycle()", () => {
  const rule = desiredLifecycleRule({ prefix: "d1-backups/", expireAfterDays: 90, infrequentAccessAfterDays: null });

  it("adds forge's rule after every foreign one", () => {
    expect(planLifecycle("b", [FOREIGN], rule)).toMatchObject({ action: "would-create", before: null, rules: [FOREIGN, rule] });
  });

  it("replaces only forge's rule, in place, when it changed", () => {
    const old = { ...rule, deleteObjectsTransition: { condition: { type: "Age" as const, maxAge: 1 } } };
    expect(planLifecycle("b", [old, FOREIGN], rule)).toMatchObject({ action: "would-update", before: old, rules: [rule, FOREIGN] });
  });

  it("refuses to take over a rule of the same id written for another prefix, naming both", () => {
    const other = desiredLifecycleRule({ prefix: "a.b/", expireAfterDays: 7, infrequentAccessAfterDays: null });
    const mine = desiredLifecycleRule({ prefix: "a-b/", expireAfterDays: 90, infrequentAccessAfterDays: null });
    expect(() => planLifecycle("b", [other], mine)).toThrow('b already has rule forge-a-b for prefix "a.b/", and "a-b/" maps to the same id');
  });

  it("is in sync when the rule already reads the same, whatever its key order", () => {
    const reordered = JSON.parse(
      JSON.stringify({ deleteObjectsTransition: rule.deleteObjectsTransition, conditions: rule.conditions, enabled: true, id: rule.id }),
    );
    expect(planLifecycle("b", [reordered], rule).action).toBe("in-sync");
  });
});
