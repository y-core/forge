import { describe, expect, it } from "bun:test";

import { CF_ERROR_CODES, pagesProject, SURFACE_PERMISSIONS, workerSecrets, workerSettings, ZONE_PHASES, zoneRulesetEntrypoint } from "./endpoints";

describe("workerSettings", () => {
  it("builds the settings path", () => {
    expect(workerSettings("acc-1", "my-worker")).toBe("/accounts/acc-1/workers/scripts/my-worker/settings");
  });

  it("encodes a slash in the account id, so it cannot open a second path segment", () => {
    expect(workerSettings("acc/../other", "my-worker")).toBe("/accounts/acc%2F..%2Fother/workers/scripts/my-worker/settings");
  });

  it("encodes a slash in the script name", () => {
    expect(workerSettings("acc-1", "a/b")).toBe("/accounts/acc-1/workers/scripts/a%2Fb/settings");
  });

  it("encodes a space in the script name", () => {
    expect(workerSettings("acc-1", "my worker")).toBe("/accounts/acc-1/workers/scripts/my%20worker/settings");
  });

  it("encodes a query introducer, so a name cannot append parameters", () => {
    expect(workerSettings("acc-1", "w?x=1&y=2")).toBe("/accounts/acc-1/workers/scripts/w%3Fx%3D1%26y%3D2/settings");
  });

  it("encodes a non-ASCII name", () => {
    expect(workerSettings("acc-1", "wörker")).toBe("/accounts/acc-1/workers/scripts/w%C3%B6rker/settings");
  });

  it("builds a path from empty segments rather than dropping them", () => {
    expect(workerSettings("", "")).toBe("/accounts//workers/scripts//settings");
  });
});

describe("workerSecrets", () => {
  it("builds the secrets path", () => {
    expect(workerSecrets("acc-1", "my-worker")).toBe("/accounts/acc-1/workers/scripts/my-worker/secrets");
  });

  it("encodes both interpolated segments", () => {
    expect(workerSecrets("a c/1", "my worker")).toBe("/accounts/a%20c%2F1/workers/scripts/my%20worker/secrets");
  });
});

describe("pagesProject", () => {
  it("builds the project path", () => {
    expect(pagesProject("acc-1", "site")).toBe("/accounts/acc-1/pages/projects/site");
  });

  it("encodes both interpolated segments", () => {
    expect(pagesProject("acc/1", "my site")).toBe("/accounts/acc%2F1/pages/projects/my%20site");
  });
});

describe("zoneRulesetEntrypoint", () => {
  it("builds the entrypoint path for a phase", () => {
    expect(zoneRulesetEntrypoint("zone-1", ZONE_PHASES.redirect)).toBe("/zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint");
  });

  it("builds the entrypoint path for the firewall phase", () => {
    expect(zoneRulesetEntrypoint("zone-1", ZONE_PHASES.firewall)).toBe("/zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint");
  });

  it("encodes both interpolated segments", () => {
    expect(zoneRulesetEntrypoint("zone/1", "a phase")).toBe("/zones/zone%2F1/rulesets/phases/a%20phase/entrypoint");
  });
});

describe("the constant tables", () => {
  it("names the two zone phases this tool writes", () => {
    expect(ZONE_PHASES).toEqual({ redirect: "http_request_dynamic_redirect", firewall: "http_request_firewall_custom" });
  });

  it("lists the codes each failure class is recognised by", () => {
    expect(CF_ERROR_CODES).toEqual({ notFound: [7000, 7003, 10009], auth: [9106, 9107, 9109, 10000] });
  });

  it("names the permission each deployment surface needs", () => {
    expect(SURFACE_PERMISSIONS).toEqual({ worker: "Workers Scripts", pages: "Cloudflare Pages" });
  });

  it("keeps the two failure classes disjoint, so classification cannot depend on which is tested first", () => {
    expect(CF_ERROR_CODES.notFound.filter((c) => (CF_ERROR_CODES.auth as readonly number[]).includes(c))).toEqual([]);
  });
});
