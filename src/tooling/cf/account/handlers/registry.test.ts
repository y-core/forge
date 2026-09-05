import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResourceType, WranglerConfig } from "../../types";
import { buildHandlers, defaultHandlers, findHandler } from "./registry";
import type { ResourceHandler } from "./types";

describe("defaultHandlers", () => {
  it("contains at least one handler per resource-creating type", () => {
    const types = defaultHandlers.map((h) => h.type);
    const requiredTypes: ResourceType[] = [
      "kv_namespaces",
      "d1_databases",
      "r2_buckets",
      "queues",
      "local_vars",
      "vars",
      "secrets",
      "rotatable_secrets",
    ];
    for (const t of requiredTypes) {
      expect(types).toContain(t);
    }
  });

  it("contains declarative handlers", () => {
    const types = defaultHandlers.map((h) => h.type);
    const declarativeTypes: ResourceType[] = ["ratelimits", "durable_objects", "hyperdrive", "vectorize", "ai"];
    for (const t of declarativeTypes) {
      expect(types).toContain(t);
    }
  });

  it("has no duplicate types", () => {
    const types = defaultHandlers.map((h) => h.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe("findHandler()", () => {
  it("finds kv handler", () => {
    const h = findHandler("kv_namespaces");
    expect(h?.type).toBe("kv_namespaces");
  });

  it("returns undefined for unknown type", () => {
    expect(findHandler("unknown_type" as ResourceType)).toBeUndefined();
  });
});

describe("buildHandlers()", () => {
  it("builds the same set as defaultHandlers", () => {
    const built = buildHandlers({ configPath: "wrangler.jsonc" });
    expect(built.map((h) => h.type)).toEqual(defaultHandlers.map((h) => h.type));
  });

  it("threads configPath into the secrets handler's .dev.vars lookup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "foundry-registry-"));
    writeFileSync(join(dir, ".dev.vars"), "# foundry:push\nFROM_THAT_DIR=1\n", "utf-8");

    const handlers = buildHandlers({ configPath: join(dir, "wrangler.jsonc") });
    const secrets = handlers.find((h) => h.type === "secrets");
    expect(secrets?.extract({ name: "t" })).toEqual([{ name: "FROM_THAT_DIR", value: "1" }]);
  });

  it("threads configPath into the vars handler too, so it can see the override", async () => {
    const dir = mkdtempSync(join(tmpdir(), "foundry-registry-vars-"));
    writeFileSync(join(dir, ".dev.vars"), "BASE_URL=http://localhost:8787\n", "utf-8");

    const handlers = buildHandlers({ configPath: join(dir, "wrangler.jsonc") });
    const vars = handlers.find((h) => h.type === "vars");
    expect(vars?.extract({ name: "t", vars: { BASE_URL: "https://prod.test" } })).toEqual([
      { name: "BASE_URL", value: "https://prod.test", overridden: true },
    ]);
  });

  it("defaultHandlers resolves .dev.vars against the cwd, not its parent", () => {
    // `dirname(resolve("wrangler.jsonc"))` is the cwd — which is why this default
    // is correct rather than merely conventional.
    const secrets = defaultHandlers.find((h) => h.type === "secrets");
    expect(secrets).toBeDefined();
    // No .dev.vars in the repo root, so this is empty rather than reaching upward
    // into /src and finding somebody else's.
    expect(secrets?.extract({ name: "t" })).toEqual([]);
  });
});

describe("registry-wide invariant: no `in-sync` without a query", () => {
  const AUTH = { apiToken: "tok", accountId: "acc" };

  // A config declaring one binding of every type the registry handles, so that each
  // handler has something to report on.
  const CONFIG: WranglerConfig = {
    name: "proj",
    main: "src/index.ts",
    vars: { A_VAR: "v" },
    kv_namespaces: [{ binding: "KV" }],
    d1_databases: [{ binding: "D1" }],
    r2_buckets: [{ binding: "R2" }],
    queues: { producers: [{ binding: "Q" }] },
    ratelimits: [{ name: "LIMITER", namespace_id: "1001", simple: { limit: 60, period: 60 } }],
    durable_objects: { bindings: [{ name: "DO", class_name: "C" }] },
    hyperdrive: [{ binding: "HD", id: "hd" }],
    vectorize: [{ binding: "VEC", index_name: "i" }],
    ai: { binding: "AI" },
    browser: { binding: "BROWSER" },
    analytics_engine_datasets: [{ binding: "AE" }],
    services: [{ binding: "SVC", service: "other" }],
    send_email: [{ name: "EMAIL" }],
    dispatch_namespaces: [{ binding: "DISPATCH", namespace: "ns" }],
    mtls_certificates: [{ binding: "MTLS", certificate_id: "c" }],
    workflows: [{ binding: "WF", name: "wf", class_name: "C" }],
    pipelines: [{ binding: "PIPE", pipeline: "p" }],
  };

  it("every `in-sync` row was earned by a query", async () => {
    const failures: string[] = [];

    for (const handler of defaultHandlers) {
      let calls = 0;
      const countingFetch: typeof globalThis.fetch = async () => {
        calls++;
        // An empty-but-successful envelope: no handler finds its resource, so any
        // `exists` here cannot have come from a match.
        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: [],
            result_info: { page: 1, per_page: 100, count: 0, total_count: 0 },
          }),
        );
      };

      const entries = handler.extract(CONFIG);
      if (entries.length === 0 && !handler.reportsEmpty) continue;

      const { results } = await (handler as ResourceHandler<unknown>).reconcile(entries, {
        auth: AUTH,
        scriptName: "proj",
        prefix: "",
        dryRun: true,
        rotate: new Set<string>(),
        fetch: countingFetch,
        target: { kind: "worker", name: "proj" },
      });

      for (const row of results) {
        if (row.action !== "in-sync") continue;
        if (calls > 0) continue; // it looked; the claim is earned
        failures.push(`${handler.type}/${row.binding}: in-sync with no query (detail: ${row.detail ?? "none"})`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("no handler still uses the old blanket wording", async () => {
    for (const handler of defaultHandlers) {
      const entries = handler.extract(CONFIG);
      if (entries.length === 0) continue;
      const { results } = await (handler as ResourceHandler<unknown>).reconcile(entries, {
        auth: AUTH,
        scriptName: "proj",
        prefix: "",
        dryRun: true,
        rotate: new Set<string>(),
        fetch: async () => new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [] })),
        target: { kind: "worker", name: "proj" },
      });
      for (const row of results) {
        expect(row.detail ?? "").not.toBe("declarative — no provisioning needed");
      }
    }
  });
});
