import { describe, expect, it } from "bun:test";

import { createCfClient } from "../api/client";
import { describeLifecycle, resolveLifecycleBucket, syncLifecycle } from "./commands";
import { desiredLifecycleRule } from "./plan";
import type { R2LifecycleRule } from "./types";

const URL_OF = "https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/app-backups/lifecycle";
const RETENTION = { prefix: "d1-backups/", expireAfterDays: 90, infrequentAccessAfterDays: 30 };
const FOREIGN: R2LifecycleRule = {
  id: "media-tmp",
  enabled: true,
  conditions: { prefix: "tmp/", suffix: ".part" },
  abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 86_400 } },
  futureField: { nested: [1, "two"] },
};

function fake(rules: unknown[]) {
  const calls: { method: string; body: unknown }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(URL_OF);
    calls.push({ method: init?.method ?? "GET", body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    return Response.json({ success: true, errors: [], messages: [], result: init?.method === "PUT" ? {} : { rules } });
  }) as typeof globalThis.fetch;
  return { client: createCfClient({ apiToken: "tok" }, fetchFn), calls };
}

describe("syncLifecycle()", () => {
  it("reads and plans without writing unless --commit asks", async () => {
    const { client, calls } = fake([FOREIGN]);
    const { plan, written } = await syncLifecycle(client, "acct", "app-backups", RETENTION, false);
    expect([plan.action, written, calls.map((call) => call.method)]).toEqual(["would-create", false, ["GET"]]);
  });

  it("writes the whole rule list back on --commit, the foreign rule's unknown fields kept byte for byte", async () => {
    const { client, calls } = fake([FOREIGN]);
    const { written } = await syncLifecycle(client, "acct", "app-backups", RETENTION, true);
    expect([written, calls[1]]).toEqual([true, { method: "PUT", body: { rules: [FOREIGN, desiredLifecycleRule(RETENTION)] } }]);
  });

  it("writes nothing when forge's rule is already in place", async () => {
    const { client, calls } = fake([desiredLifecycleRule(RETENTION)]);
    expect((await syncLifecycle(client, "acct", "app-backups", RETENTION, true)).written).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("resolveLifecycleBucket()", () => {
  it("maps a binding to its bucket and takes anything else as a bucket name", () => {
    const buckets = [{ binding: "BACKUPS", bucket_name: "app-backups" }];
    expect([resolveLifecycleBucket(buckets, "BACKUPS"), resolveLifecycleBucket(buckets, "other"), resolveLifecycleBucket(undefined, "x")]).toEqual([
      "app-backups",
      "other",
      "x",
    ]);
  });
});

describe("describeLifecycle()", () => {
  it("shows the rule as it is and as wanted, and says --commit writes it", () => {
    const rule = desiredLifecycleRule(RETENTION);
    expect(describeLifecycle({ bucket: "app-backups", rule, before: null, rules: [rule], action: "would-create" }, false)).toEqual([
      "would-create — app-backups: rule forge-d1-backups on d1-backups/",
      "  now:    none",
      "  wanted: Infrequent Access after 30 days, expire after 90 days",
      "  read-only; --commit writes the bucket's lifecycle rules, every other rule kept",
    ]);
  });
});
