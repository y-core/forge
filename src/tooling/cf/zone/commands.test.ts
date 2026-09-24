import { describe, expect, it } from "bun:test";

import { resolveSiteConfig } from "../../../site/config";
import type { SiteConfig, ZoneRule } from "../../../site/types";
import { phaseAction, planZoneRules, rulesInSync } from "./commands";

const base: SiteConfig = {
  origin: "https://example.com",
  pages: ["/", "/fica"],
  robots: { rules: [{ userAgent: "*" }] },
  zone: {
    apex: "example.com",
    redirect: { from: ["www.example.com"] },
    allow: { action: "managed_challenge", prefixes: ["/assets/"], files: ["/favicon.ico"] },
  },
};

const plan = (config: SiteConfig) => planZoneRules(resolveSiteConfig(config));

describe("planZoneRules", () => {
  it("plans the firewall phase before the redirect phase, one rule each", () => {
    const plans = plan(base);
    expect(plans.map((p) => [p.phase, p.desired.length])).toEqual([
      ["http_request_firewall_custom", 1],
      ["http_request_dynamic_redirect", 1],
    ]);
  });

  it("takes the served paths from the config's pages when the allow block names none", () => {
    const [firewall] = plan(base);
    expect(firewall?.desired[0]?.expression).toContain('"/" "/favicon.ico" "/fica"');
  });

  it("prefers an explicit allow.paths over the GET-only page list", () => {
    const zone = { ...base.zone, allow: { ...base.zone?.allow, action: "block" as const, paths: ["/", "/api/contact"] } };
    const [firewall] = plan({ ...base, zone: { apex: "example.com", ...zone } });
    expect(firewall?.desired[0]?.expression).toContain('"/api/contact"');
    expect(firewall?.desired[0]?.action).toBe("block");
  });

  it("plans an empty rule list for a phase the config says nothing about", () => {
    const plans = plan({ ...base, zone: { apex: "example.com" } });
    expect(plans.map((p) => p.desired.length)).toEqual([0, 0]);
  });

  it("refuses a config with no zone block rather than silently clearing both phases", () => {
    expect(() => plan({ ...base, zone: undefined })).toThrow(/no `zone` block/);
  });
});

describe("rulesInSync", () => {
  const rule: ZoneRule = { action: "block", expression: "(true)", description: "d", enabled: true };

  it("ignores the id and version fields a remote rule carries besides", () => {
    const remote = { ...rule, id: "abc123", version: "7", last_updated: "2026-08-29" } as ZoneRule;
    expect(rulesInSync([rule], [remote])).toBe(true);
  });

  it("reports drift on a changed expression", () => {
    expect(rulesInSync([rule], [{ ...rule, expression: "(false)" }])).toBe(false);
  });

  it("reports drift on a changed action, which is the managed_challenge-to-block flip", () => {
    expect(rulesInSync([{ ...rule, action: "managed_challenge" }], [rule])).toBe(false);
  });

  it("reports drift on a differing rule count", () => {
    expect(rulesInSync([rule], [rule, rule])).toBe(false);
    expect(rulesInSync([], [rule])).toBe(false);
  });

  it("treats an unreadable phase as out of sync rather than as matching", () => {
    expect(rulesInSync([], null)).toBe(false);
  });

  it("treats two empty lists as in sync, so a phase neither side uses is not written every run", () => {
    expect(rulesInSync([], [])).toBe(true);
  });

  it("ignores the key order a server serialised action_parameters in", () => {
    const mine: ZoneRule = {
      ...rule,
      action: "redirect",
      action_parameters: { from_value: { status_code: 301, target_url: { expression: "x" }, preserve_query_string: true } },
    };
    const returned: ZoneRule = {
      ...rule,
      action: "redirect",
      action_parameters: { from_value: { preserve_query_string: true, status_code: 301, target_url: { expression: "x" } } },
    };
    expect(rulesInSync([mine], [returned])).toBe(true);
  });

  it("compares action_parameters, so a changed redirect target is drift", () => {
    const redirect: ZoneRule = { ...rule, action: "redirect", action_parameters: { from_value: { status_code: 301 } } };
    expect(rulesInSync([redirect], [{ ...redirect, action_parameters: { from_value: { status_code: 308 } } }])).toBe(false);
  });
});

describe("phaseAction", () => {
  const rule: ZoneRule = { action: "block", expression: "(true)", description: "d", enabled: true };
  const firewall = { name: "firewall", phase: "http_request_firewall_custom" };

  it("reports a phase this run wrote as updated", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: [rule], written: true })).toBe("updated");
  });

  it("reports a phase the commit loop skipped as in-sync, whatever another phase did", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: [rule] })).toBe("in-sync");
  });

  it("reports an unwritten difference as drift", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: [] })).toBe("drift");
  });

  it("reports a phase that failed as error, written or not", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: null, error: "auth failed" })).toBe("error");
  });
});
