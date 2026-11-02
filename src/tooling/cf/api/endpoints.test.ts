import { describe, expect, it } from "bun:test";

import {
  CF_ERROR_CODES,
  D1_WRITE_PERMISSION,
  d1DatabasePath,
  d1Path,
  r2ObjectPath,
  r2ObjectsPath,
  WORKER_PERMISSION,
  workerBuildSettings,
  WORKERS_CI_PERMISSION,
  workerScripts,
  workerSecrets,
  workerSettings,
  ZONE_PHASES,
  zoneRulesetEntrypoint,
} from "./endpoints";

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

describe("workerScripts", () => {
  it("builds the account's script list path", () => {
    expect(workerScripts("acc-1")).toBe("/accounts/acc-1/workers/scripts");
  });

  it("encodes a slash in the account id, so it cannot open a second path segment", () => {
    expect(workerScripts("acc/../other")).toBe("/accounts/acc%2F..%2Fother/workers/scripts");
  });
});

describe("workerBuildSettings", () => {
  it("builds the Workers Builds settings path for a script tag", () => {
    expect(workerBuildSettings("acc-1", "0a1b2c")).toBe("/accounts/acc-1/builds/workers/0a1b2c");
  });

  it("encodes a slash in the tag, so it cannot reach a sibling operation", () => {
    expect(workerBuildSettings("acc-1", "t/../triggers")).toBe("/accounts/acc-1/builds/workers/t%2F..%2Ftriggers");
  });

  it("encodes a query introducer in the tag, so a tag cannot append parameters", () => {
    expect(workerBuildSettings("acc-1", "t?patch_existing_previews=true")).toBe(
      "/accounts/acc-1/builds/workers/t%3Fpatch_existing_previews%3Dtrue",
    );
  });

  it("encodes both interpolated segments", () => {
    expect(workerBuildSettings("a c", "t 1")).toBe("/accounts/a%20c/builds/workers/t%201");
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

describe("d1Path", () => {
  it("builds the account's D1 database path", () => {
    expect(d1Path("acc-1")).toBe("/accounts/acc-1/d1/database");
  });

  it("encodes a slash in the account id, so it cannot open a second path segment", () => {
    expect(d1Path("acc/../other")).toBe("/accounts/acc%2F..%2Fother/d1/database");
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

  it("names the permission the Worker surface needs", () => {
    expect(WORKER_PERMISSION).toEqual({ name: "Workers Scripts", grants: "Read to report, Edit to change" });
  });

  it("names the Workers Builds permission by its API name, with the user-scoped token it requires", () => {
    expect(WORKERS_CI_PERMISSION).toEqual({
      name: "Workers CI",
      grants: "Read to report, Write to change, on a user-scoped token — an account-scoped one is refused as invalid",
    });
  });

  it("names the permission a D1 write needs as the dashboard spells it", () => {
    expect(D1_WRITE_PERMISSION).toBe("Account → D1 → Edit");
  });

  it("keeps the two failure classes disjoint, so classification cannot depend on which is tested first", () => {
    expect(CF_ERROR_CODES.notFound.filter((c) => (CF_ERROR_CODES.auth as readonly number[]).includes(c))).toEqual([]);
  });
});

describe("d1DatabasePath", () => {
  it("addresses one database under the account's D1 path", () => {
    expect(d1DatabasePath("acc-1", "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a")).toBe(
      "/accounts/acc-1/d1/database/0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
    );
  });

  it("encodes a slash in the database id, so it cannot reach a sibling operation", () => {
    expect(d1DatabasePath("acc-1", "x/../y")).toBe("/accounts/acc-1/d1/database/x%2F..%2Fy");
  });
});

describe("r2ObjectPath", () => {
  it("builds a bucket's object listing path", () => {
    expect(r2ObjectsPath("acc-1", "app-backups")).toBe("/accounts/acc-1/r2/buckets/app-backups/objects");
  });

  it("keeps each slash of the key as a path separator and encodes every segment", () => {
    expect(r2ObjectPath("acc-1", "app-backups", "d1-backups/db 1/2026-09-11T09:00:00.000Z-b?.sql")).toBe(
      "/accounts/acc-1/r2/buckets/app-backups/objects/d1-backups/db%201/2026-09-11T09%3A00%3A00.000Z-b%3F.sql",
    );
  });
});
