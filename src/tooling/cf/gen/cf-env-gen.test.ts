import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { experimental_generateTypes } from "wrangler";

import { createGenEnvCommand, loadOptions } from "./cf-env-command";
import { collectBindings, collectSecretNames, collectVars, emit } from "./cf-env-gen";
import { DEFAULT_OPTIONS, HEADER } from "./cf-env-registry";
import type { Entry, GenOptions } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CHECK = '(x) => typeof x === "object" && x !== null';

const OPTIONS: GenOptions = { optional: new Set(["RATE_LIMITER"]), refinements: { SESSION_SECRET: { minLength: 32 } }, bindingCheck: CHECK };

describe("collectBindings", () => {
  const cfg = {
    kv_namespaces: [{ binding: "SETTINGS" }, { binding: "LOGS" }],
    r2_buckets: [{ binding: "DOCUMENTS" }],
    d1_databases: [{ binding: "DB" }],
    queues: { producers: [{ binding: "QUEUE" }] },
    k2: [{ binding: "EVENTS", stream: "events" }],
    ratelimits: [{ name: "RATE_LIMITER" }],
    browser: { binding: "BROWSER" },
    analytics: { binding: "ANALYTICS" },
    assets: { binding: "ASSETS" },
    pipelines: [{ binding: "INGEST", pipeline: "ingest" }],
    durable_objects: { bindings: [{ name: "COUNTER", class_name: "Counter" }] },
    services: [{ binding: "AUTH", service: "auth-worker" }],
  };

  it("walks REGISTRY in order across list, dotted-path, and single-object kinds", () => {
    expect(collectBindings(cfg, OPTIONS).map((e) => e.name)).toEqual([
      "SETTINGS",
      "LOGS",
      "DOCUMENTS",
      "DB",
      "QUEUE",
      "EVENTS",
      "RATE_LIMITER",
      "BROWSER",
      "ANALYTICS",
      "ASSETS",
      "INGEST",
      "COUNTER",
      "AUTH",
    ]);
  });

  it("reads the correct name-field (`binding` vs `name`) and TS type per kind", () => {
    const byName = new Map(collectBindings(cfg, OPTIONS).map((e) => [e.name, e.expr]));
    expect(byName.get("DB")).toBe(`v.custom<D1Database>(${CHECK}, "DB must be a D1 database binding")`);
    expect(byName.get("QUEUE")).toBe(`v.custom<Queue>(${CHECK}, "QUEUE must be a Queue binding")`);
    expect(byName.get("COUNTER")).toBe(`v.custom<DurableObjectNamespace>(${CHECK}, "COUNTER must be a Durable Object binding")`);
    expect(byName.get("AUTH")).toBe(`v.custom<Fetcher>(${CHECK}, "AUTH must be a service binding")`);
    expect(byName.get("ASSETS")).toBe(`v.custom<Fetcher>(${CHECK}, "ASSETS must be a Fetcher binding")`);
  });

  it("types analytics, pipelines and k2 as wrangler types them", () => {
    const byName = new Map(collectBindings(cfg, OPTIONS).map((e) => [e.name, e.expr]));
    expect(byName.get("ANALYTICS")).toBe(`v.custom<AnalyticsSQLBinding>(${CHECK}, "ANALYTICS must be an Analytics SQL binding")`);
    expect(byName.get("INGEST")).toBe(
      `v.custom<import("cloudflare:pipelines").Pipeline<import("cloudflare:pipelines").PipelineRecord>>(${CHECK}, "INGEST must be a pipeline binding")`,
    );
    expect(byName.get("EVENTS")).toBe(
      `v.custom<{ send(records: | { content: ArrayBuffer; headers?: Record<string, string> }[] | { content: Uint8Array; headers?: Record<string, string> }[] ): Promise< | { success: true } | { success: false; error: { code: number; message: string; retryable: boolean } } >; }>(${CHECK}, "EVENTS must be a K2 stream binding")`,
    );
  });

  it("wraps a policy-optional binding in v.optional", () => {
    const byName = new Map(collectBindings(cfg, OPTIONS).map((e) => [e.name, e.expr]));
    expect(byName.get("RATE_LIMITER")).toBe(`v.optional(v.custom<RateLimit>(${CHECK}, "RATE_LIMITER must be a rate-limit binding"))`);
  });

  it("returns an empty list for an empty config", () => {
    expect(collectBindings({}, OPTIONS)).toEqual([]);
  });

  it("types no logfwdr, unsafe or websearch binding", () => {
    const untyped = {
      logfwdr: { bindings: [{ name: "LOGFWDR_SCHEMA", destination: "x" }] },
      unsafe: { bindings: [{ name: "LIMITER", type: "ratelimit", namespace_id: "1001", simple: { limit: 1, period: 60 } }] },
      websearch: { binding: "SEARCH" },
    };
    expect(collectBindings(untyped, OPTIONS)).toEqual([]);
  });
});

async function wranglerRequiredStrings(cfg: Record<string, unknown>, devVarsText: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "forge-cfgen-secrets-"));
  roots.push(dir);
  writeFileSync(join(dir, "index.ts"), "export default {};\n");
  writeFileSync(join(dir, ".dev.vars"), devVarsText);
  writeFileSync(join(dir, "wrangler.json"), JSON.stringify({ name: "secrets", main: "index.ts", compatibility_date: "2025-01-01", ...cfg }));
  const { env } = await experimental_generateTypes({ config: join(dir, "wrangler.json"), includeRuntime: false });
  const base = /^interface __BaseEnv_Env \{\n(.*?)^\}/ms.exec(env ?? "")?.[1] ?? "";
  return [...base.matchAll(/^\t(\w+): string;$/gm)].map((match) => match[1]!);
}

describe("collectSecretNames", () => {
  const DEV_VARS = "CSRF_SECRET=x\n";
  const cases: { name: string; cfg: Record<string, unknown>; devVars: string; expected: string[] }[] = [
    {
      name: "every .dev.vars key when the config declares no secrets",
      cfg: {},
      devVars: "API_KEY=x\nCSRF_SECRET=y\n",
      expected: ["API_KEY", "CSRF_SECRET"],
    },
    {
      name: "the keys `parseDevVars` recognises — spaced `=` and a lowercase name",
      cfg: {},
      devVars: "STRIPE_KEY = x\nlower_key=1\n",
      expected: ["STRIPE_KEY", "lower_key"],
    },
    {
      name: ".dev.vars keys when environments exist but none declares secrets",
      cfg: { env: { staging: { vars: { MODE: "staging" } } } },
      devVars: DEV_VARS,
      expected: ["CSRF_SECRET"],
    },
    { name: ".dev.vars keys when `env` is null", cfg: { env: null }, devVars: DEV_VARS, expected: ["CSRF_SECRET"] },
    { name: ".dev.vars keys when an environment entry is null", cfg: { env: { staging: null } }, devVars: DEV_VARS, expected: ["CSRF_SECRET"] },
    {
      name: "only `secrets.required` once the top level declares secrets",
      cfg: { secrets: { required: ["API_KEY"] } },
      devVars: DEV_VARS,
      expected: ["API_KEY"],
    },
    { name: "no names for an empty `secrets` block", cfg: { secrets: {} }, devVars: DEV_VARS, expected: [] },
    { name: "no names when `secrets.required` is not an array", cfg: { secrets: { required: "API_KEY" } }, devVars: DEV_VARS, expected: [] },
    {
      name: "no names when only env.staging declares secrets",
      cfg: { env: { staging: { secrets: { required: ["STAGING_KEY"] } } } },
      devVars: DEV_VARS,
      expected: [],
    },
    {
      name: "the string entries of `secrets.required`, dropping non-string and empty ones",
      cfg: { secrets: { required: ["API_KEY", 7, "", null, "TOKEN"] } },
      devVars: "",
      expected: ["API_KEY", "TOKEN"],
    },
  ];

  for (const { name, cfg, devVars, expected } of cases) {
    it(`returns ${name}`, () => {
      expect(collectSecretNames(cfg, devVars)).toEqual(expected);
    });
  }

  it("names the secrets wrangler types as required strings on the top-level Env, for each way a config can declare them", async () => {
    const shapes: Record<string, unknown>[] = [
      {},
      { env: { staging: { vars: { MODE: "staging" } } } },
      { secrets: { required: ["API_KEY"] } },
      { secrets: {} },
      { env: { staging: { secrets: { required: ["STAGING_KEY"] } } } },
    ];
    const wrangler = await Promise.all(shapes.map((cfg) => wranglerRequiredStrings(cfg, DEV_VARS)));

    expect(shapes.map((cfg) => collectSecretNames(cfg, DEV_VARS))).toEqual(wrangler);
  }, 30_000);
});

describe("collectVars", () => {
  it("types wrangler `vars` by JS type, treats secret names as strings, and applies refinements", () => {
    const wranglerVars = { ENABLED: true, MAX_ITEMS: 5, LABEL: "hi" };
    expect(collectVars(["BASE_URL", "LOG_LEVEL", "SESSION_SECRET"], wranglerVars, OPTIONS)).toEqual([
      { name: "ENABLED", expr: "v.boolean()" },
      { name: "MAX_ITEMS", expr: "v.number()" },
      { name: "LABEL", expr: "v.string()" },
      { name: "BASE_URL", expr: "v.string()" },
      { name: "LOG_LEVEL", expr: "v.string()" },
      { name: "SESSION_SECRET", expr: "v.pipe(v.string(), v.minLength(32))" },
    ]);
  });

  it("a secret name wins over a colliding wrangler var", () => {
    const result = collectVars(["BASE_URL"], { BASE_URL: "from-wrangler" }, OPTIONS);
    expect(result).toEqual([{ name: "BASE_URL", expr: "v.string()" }]);
  });

  it("returns no entries for empty inputs", () => {
    expect(collectVars([], {}, OPTIONS)).toEqual([]);
  });
});

describe("emit", () => {
  it("renders the baked HEADER, the single `v` import (no guard import), schema, and type", () => {
    const entries: Entry[] = [
      { name: "SETTINGS", expr: `v.custom<KVNamespace>(${CHECK}, "SETTINGS must be a KV namespace binding")` },
      { name: "BASE_URL", expr: "v.string()" },
    ];
    expect(emit(entries)).toBe(`${HEADER}

import { v } from "@y-core/forge/validation";

/** The Worker's binding/var surface as a runtime valibot schema. */
export const EnvSchema = v.object({
  SETTINGS: v.custom<KVNamespace>(${CHECK}, "SETTINGS must be a KV namespace binding"),
  BASE_URL: v.string(),
});

/** The Worker's binding/var surface as a type — inferred from \`EnvSchema\`. */
export type Env = v.InferOutput<typeof EnvSchema>;
`);
  });

  it("quotes a key that is not a valid identifier, so the generated module still parses", () => {
    expect(emit([{ name: "WEIRD-KEY", expr: "v.string()" }])).toContain(`  "WEIRD-KEY": v.string(),`);
  });
});

describe("createGenEnvCommand", () => {
  it("declares path flags with sensible defaults and an optional --config", () => {
    const cmd = createGenEnvCommand();
    expect(cmd.name).toBe("env");
    expect(cmd.flags.wrangler).toEqual({ type: "string", default: "wrangler.jsonc", description: "Path to wrangler.jsonc" });
    expect(cmd.flags["dev-vars"]).toEqual({ type: "string", default: ".dev.vars", description: "Path to .dev.vars" });
    expect(cmd.flags.out).toEqual({ type: "string", default: "src/app/env.schema.ts", description: "Output module path" });
    expect(cmd.flags.config).toEqual({
      type: "string",
      default: "config/env.config.ts",
      description: "Host-policy module default-exporting defineEnvConfig({...})",
    });
  });
});

describe("loadOptions", () => {
  it("returns the defaults when no config path is given", async () => {
    expect(await loadOptions()).toBe(DEFAULT_OPTIONS);
  });

  it("merges a host --config module over the defaults, inheriting unspecified fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-cfgen-"));
    roots.push(dir);
    const path = join(dir, "config.fixture.ts");
    writeFileSync(path, 'export default { optional: new Set(["RATE_LIMITER"]), refinements: { SESSION_SECRET: { minLength: 32 } } };\n');
    const opts = await loadOptions(path);
    expect([...opts.optional]).toEqual(["RATE_LIMITER"]);
    expect(opts.refinements).toEqual({ SESSION_SECRET: { minLength: 32 } });
    expect(opts.bindingCheck).toBe(DEFAULT_OPTIONS.bindingCheck);
  });
});
