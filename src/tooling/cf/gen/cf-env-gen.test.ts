import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { experimental_generateTypes } from "wrangler";

import { validateCommentBudget } from "../../gate/checks/comment-budget-parse";
import { createGenEnvCommand, loadOptions } from "./cf-env-command";
import { collectBindings, collectNamedEnvVars, collectPolicyVars, collectSecretNames, collectVars, declaresSecrets, emit } from "./cf-env-gen";
import { DEFAULT_OPTIONS } from "./cf-env-registry";
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

async function wranglerBaseEnv(cfg: Record<string, unknown>, devVarsText: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "forge-cfgen-secrets-"));
  roots.push(dir);
  writeFileSync(join(dir, "index.ts"), "export default {};\n");
  writeFileSync(join(dir, ".dev.vars"), devVarsText);
  writeFileSync(join(dir, "wrangler.json"), JSON.stringify({ name: "secrets", main: "index.ts", compatibility_date: "2025-01-01", ...cfg }));
  const { env } = await experimental_generateTypes({ config: join(dir, "wrangler.json"), includeRuntime: false });
  return /^interface __BaseEnv_Env \{\n(.*?)^\}/ms.exec(env ?? "")?.[1] ?? "";
}

async function wranglerRequiredStrings(cfg: Record<string, unknown>, devVarsText: string): Promise<string[]> {
  return [...(await wranglerBaseEnv(cfg, devVarsText)).matchAll(/^\t(\w+): string;$/gm)].map((match) => match[1]!);
}

async function wranglerOptionalNames(cfg: Record<string, unknown>, devVarsText: string): Promise<string[]> {
  return [...(await wranglerBaseEnv(cfg, devVarsText)).matchAll(/^\t(\w+)\?:/gm)].map((match) => match[1]!).toSorted();
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

describe("declaresSecrets", () => {
  const cases = [
    { name: "a top-level `secrets`", cfg: { name: "app", secrets: { required: ["API_KEY"] } }, expected: true },
    { name: "a named env's `secrets`", cfg: { name: "app", env: { staging: { secrets: { required: ["API_KEY"] } } } }, expected: true },
    { name: "named envs without `secrets`", cfg: { name: "app", env: { staging: { vars: { LOG_LEVEL: "debug" } } } }, expected: false },
    { name: "neither", cfg: { name: "app", vars: { BASE_URL: "https://example.com" } }, expected: false },
  ];
  for (const { name, cfg, expected } of cases) {
    it(`is ${expected} for a config with ${name}`, () => {
      expect(declaresSecrets(cfg)).toBe(expected);
    });
  }
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

describe("collectNamedEnvVars", () => {
  const cases: { name: string; cfg: Record<string, unknown>; declared: string[]; expected: Entry[] }[] = [
    {
      name: "types a var only env.dev declares by its value, optional",
      cfg: { env: { dev: { vars: { SITE_ORIGIN: "http://localhost", PORT: 8787, DEBUG: true } } } },
      declared: [],
      expected: [
        { name: "SITE_ORIGIN", expr: "v.optional(v.string())" },
        { name: "PORT", expr: "v.optional(v.number())" },
        { name: "DEBUG", expr: "v.optional(v.boolean())" },
      ],
    },
    {
      name: "types a required secret only env.dev declares as an optional string",
      cfg: { env: { dev: { secrets: { required: ["DEV_KEY"] } } } },
      declared: [],
      expected: [{ name: "DEV_KEY", expr: "v.optional(v.string())" }],
    },
    {
      name: "skips a name the top level already declares",
      cfg: { vars: { LOG_LEVEL: "info" }, env: { dev: { vars: { LOG_LEVEL: "debug", SITE_ORIGIN: "http://localhost" } } } },
      declared: ["LOG_LEVEL"],
      expected: [{ name: "SITE_ORIGIN", expr: "v.optional(v.string())" }],
    },
    {
      name: "types a name that is a var in one env and a secret in another as a string",
      cfg: { env: { dev: { vars: { TOKEN: 7 } }, prod: { secrets: { required: ["TOKEN"] } } } },
      declared: [],
      expected: [{ name: "TOKEN", expr: "v.optional(v.string())" }],
    },
    { name: "returns nothing when `env` is null", cfg: { env: null }, declared: [], expected: [] },
    {
      name: "skips a null environment entry and reads the rest",
      cfg: { env: { staging: null, dev: { vars: { SITE_ORIGIN: "http://localhost" } } } },
      declared: [],
      expected: [{ name: "SITE_ORIGIN", expr: "v.optional(v.string())" }],
    },
    {
      name: "drops non-string and empty secret names",
      cfg: { env: { dev: { secrets: { required: ["DEV_KEY", 7, "", null] } } } },
      declared: [],
      expected: [{ name: "DEV_KEY", expr: "v.optional(v.string())" }],
    },
    { name: "returns nothing for a config without environments", cfg: { vars: { A: "a" } }, declared: ["A"], expected: [] },
  ];

  for (const { name, cfg, declared, expected } of cases) {
    it(name, () => {
      expect(collectNamedEnvVars(cfg, new Set(declared), DEFAULT_OPTIONS)).toEqual(expected);
    });
  }

  it("applies a refinement inside the optional wrapper", () => {
    const cfg = { env: { dev: { secrets: { required: ["SESSION_SECRET"] } } } };
    expect(collectNamedEnvVars(cfg, new Set(), OPTIONS)).toEqual([
      { name: "SESSION_SECRET", expr: "v.optional(v.pipe(v.string(), v.minLength(32)))" },
    ]);
  });

  it("names exactly the names wrangler types as optional on the top-level Env", async () => {
    const DEV_VARS = "";
    const shapes: Record<string, unknown>[] = [
      { env: { dev: { vars: { SITE_ORIGIN: "http://localhost" } } } },
      { env: { dev: { secrets: { required: ["DEV_KEY"] } } } },
      { env: { dev: { vars: { SITE_ORIGIN: "http://localhost", LOG_LEVEL: "debug" }, secrets: { required: ["DEV_KEY"] } } } },
      {
        vars: { LOG_LEVEL: "info" },
        secrets: { required: ["API_KEY"] },
        env: { dev: { vars: { LOG_LEVEL: "debug", SITE_ORIGIN: "http://localhost" }, secrets: { required: ["API_KEY", "DEV_KEY"] } } },
      },
    ];
    const wrangler = await Promise.all(shapes.map((cfg) => wranglerOptionalNames(cfg, DEV_VARS)));

    const ours = shapes.map((cfg) => {
      const declared = collectVars(collectSecretNames(cfg, DEV_VARS), (cfg.vars ?? {}) as Record<string, unknown>, DEFAULT_OPTIONS);
      return collectNamedEnvVars(cfg, new Set(declared.map((entry) => entry.name)), DEFAULT_OPTIONS)
        .map((entry) => entry.name)
        .toSorted();
    });
    expect(ours).toEqual(wrangler);
  }, 30_000);
});

describe("collectPolicyVars", () => {
  const policy = (optional: string[]): GenOptions => ({ ...OPTIONS, optional: new Set(optional) });

  it("makes an optional name nothing declares an optional string", () => {
    expect(collectPolicyVars(new Set(), policy(["TURNSTILE_SITE_KEY"]))).toEqual([{ name: "TURNSTILE_SITE_KEY", expr: "v.optional(v.string())" }]);
  });

  it("skips an optional name something already declares", () => {
    expect(collectPolicyVars(new Set(["RATE_LIMITER"]), policy(["RATE_LIMITER", "TURNSTILE_SITE_KEY"]))).toEqual([
      { name: "TURNSTILE_SITE_KEY", expr: "v.optional(v.string())" },
    ]);
  });

  it("applies a refinement inside the optional wrapper", () => {
    expect(collectPolicyVars(new Set(), policy(["SESSION_SECRET"]))).toEqual([
      { name: "SESSION_SECRET", expr: "v.optional(v.pipe(v.string(), v.minLength(32)))" },
    ]);
  });

  it("returns nothing when the policy names no optional", () => {
    expect(collectPolicyVars(new Set(), DEFAULT_OPTIONS)).toEqual([]);
  });
});

describe("emit", () => {
  const COMMAND = "forge cf gen env --out src/app/env-schema.ts";

  it("renders the header, the single `v` import, the type, the schema, and the DeclaredEnv augmentation", () => {
    const entries: Entry[] = [
      { name: "SETTINGS", expr: `v.custom<KVNamespace>(${CHECK}, "SETTINGS must be a KV namespace binding")` },
      { name: "BASE_URL", expr: "v.string()" },
    ];
    expect(emit(entries, COMMAND)).toBe(`/** GENERATED — do not edit; run \`forge cf gen env --out src/app/env-schema.ts\`. */

import { v } from "@y-core/forge/validation";

/** The Worker's binding/var surface as a type — inferred from \`EnvSchema\`. */
export type Env = v.InferOutput<typeof EnvSchema>;

/** The Worker's binding/var surface as a runtime valibot schema. */
export const EnvSchema = v.object({
  SETTINGS: v.custom<KVNamespace>(${CHECK}, "SETTINGS must be a KV namespace binding"),
  BASE_URL: v.string(),
});

declare module "@y-core/forge/config" {
  interface DeclaredEnv extends Env {}
}
`);
  });

  const commands = ["forge cf gen env", COMMAND, "forge cf gen env --wrangler wrangler.prod.jsonc --config config/prod.env.ts"];
  for (const command of commands) {
    it(`names \`${command}\` on the first line`, () => {
      expect(emit([], command).split("\n")[0]).toBe(`/** GENERATED — do not edit; run \`${command}\`. */`);
    });
  }

  it("declares the Env type before the EnvSchema const", () => {
    const lines = emit([{ name: "BASE_URL", expr: "v.string()" }], COMMAND).split("\n");
    const declarations = lines.filter((line) => line.startsWith("export ")).map((line) => line.split(" ").slice(0, 3).join(" "));
    expect(declarations).toEqual(["export type Env", "export const EnvSchema"]);
  });

  it("ends with the block that merges Env into the config namespace's DeclaredEnv", () => {
    const source = emit([{ name: "BASE_URL", expr: "v.string()" }], COMMAND);
    expect(source.slice(source.indexOf("declare module"))).toBe(`declare module "@y-core/forge/config" {
  interface DeclaredEnv extends Env {}
}
`);
  });

  it("writes a module the comment budget passes", () => {
    const source = emit([{ name: "BASE_URL", expr: "v.string()" }], COMMAND);
    expect(validateCommentBudget("src/app/env.schema.ts", source)).toEqual([]);
  });

  it("quotes a key that is not a valid identifier, so the generated module still parses", () => {
    expect(emit([{ name: "WEIRD-KEY", expr: "v.string()" }], COMMAND)).toContain(`  "WEIRD-KEY": v.string(),`);
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
    expect(await loadOptions(process.cwd())).toBe(DEFAULT_OPTIONS);
  });

  it("merges a host --config module over the defaults, inheriting unspecified fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-cfgen-"));
    roots.push(dir);
    const path = join(dir, "config.fixture.ts");
    writeFileSync(path, 'export default { optional: new Set(["RATE_LIMITER"]), refinements: { SESSION_SECRET: { minLength: 32 } } };\n');
    const opts = await loadOptions(dir, path);
    expect([...opts.optional]).toEqual(["RATE_LIMITER"]);
    expect(opts.refinements).toEqual({ SESSION_SECRET: { minLength: 32 } });
    expect(opts.bindingCheck).toBe(DEFAULT_OPTIONS.bindingCheck);
  });
});
