/** cf-env-gen.test.ts — the portable Cloudflare-binding env-schema generator.
 *
 *  Exercises the pure core (`cf-env-gen.ts`): `stripJsonc`, the `REGISTRY`-driven
 *  `collectBindings` (multi-kind config, dotted/single-object paths, name-field
 *  extraction, registry ordering, `v.optional` policy), `collectVars` (typed
 *  `wrangler.jsonc` vars + `.dev.vars` secrets, refinements, dedupe precedence),
 *  and `emit` (header + single `v` import) — plus the command surface
 *  (`cf-env-command.ts`): `createGenEnv` flag defaults and `loadOptions` merge.
 */

import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGenEnv, loadOptions } from "./cf-env-command";
import { collectBindings, collectVars, DEFAULT_OPTIONS, type Entry, emit, type GenOptions, HEADER, REGISTRY, stripJsonc } from "./cf-env-gen";

const CHECK = '(x) => typeof x === "object" && x !== null';

const OPTIONS: GenOptions = { optional: new Set(["RATE_LIMITER"]), refinements: { SESSION_SECRET: { minLength: 32 } }, bindingCheck: CHECK };

describe("stripJsonc", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    { name: "line comment becomes a newline", input: '{"a":1} // c', expected: '{"a":1} \n' },
    { name: "block comment is removed", input: "a/* b */c", expected: "ac" },
    { name: "`//` inside a string survives", input: '{"u":"http://x"}', expected: '{"u":"http://x"}' },
    { name: "`/* */` inside a string survives", input: '"a/*b*/c"', expected: '"a/*b*/c"' },
    { name: "escaped quote does not end the string", input: '"a\\"b"', expected: '"a\\"b"' },
  ];
  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(stripJsonc(input)).toBe(expected);
    });
  }
});

describe("collectBindings", () => {
  const cfg = {
    kv_namespaces: [{ binding: "SETTINGS" }, { binding: "LOGS" }],
    r2_buckets: [{ binding: "DOCUMENTS" }],
    d1_databases: [{ binding: "DB" }],
    queues: { producers: [{ binding: "QUEUE" }] },
    ratelimits: [{ name: "RATE_LIMITER" }],
    assets: { binding: "ASSETS" },
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
      "RATE_LIMITER",
      "ASSETS",
      "COUNTER",
      "AUTH",
    ]);
  });

  it("reads the correct name-field (`binding` vs `name`) and TS type per kind", () => {
    const byName = new Map(collectBindings(cfg, OPTIONS).map((e) => [e.name, e.expr]));
    expect(byName.get("DB")).toBe(`v.custom<D1Database>(${CHECK}, "DB must be a D1 database binding")`);
    expect(byName.get("QUEUE")).toBe(`v.custom<Queue>(${CHECK}, "QUEUE must be a Queue binding")`);
    // ratelimits/durable_objects identify by `name`; services by `binding`.
    expect(byName.get("COUNTER")).toBe(`v.custom<DurableObjectNamespace>(${CHECK}, "COUNTER must be a Durable Object binding")`);
    expect(byName.get("AUTH")).toBe(`v.custom<Service>(${CHECK}, "AUTH must be a service binding")`);
    expect(byName.get("ASSETS")).toBe(`v.custom<Fetcher>(${CHECK}, "ASSETS must be a Fetcher binding")`);
  });

  it("wraps a policy-optional binding in v.optional", () => {
    const byName = new Map(collectBindings(cfg, OPTIONS).map((e) => [e.name, e.expr]));
    expect(byName.get("RATE_LIMITER")).toBe(`v.optional(v.custom<RateLimit>(${CHECK}, "RATE_LIMITER must be a rate-limit binding"))`);
  });

  it("returns an empty list for an empty config", () => {
    expect(collectBindings({}, OPTIONS)).toEqual([]);
  });
});

describe("collectVars", () => {
  it("types wrangler `vars` by JS type, treats .dev.vars keys as string secrets, and applies refinements", () => {
    const devVars = "BASE_URL=http://x\nLOG_LEVEL=DEBUG\nSESSION_SECRET=zzz\n";
    const wranglerVars = { ENABLED: true, MAX_ITEMS: 5, LABEL: "hi" };
    expect(collectVars(devVars, wranglerVars, OPTIONS)).toEqual([
      { name: "ENABLED", expr: "v.boolean()" },
      { name: "MAX_ITEMS", expr: "v.number()" },
      { name: "LABEL", expr: "v.string()" },
      { name: "BASE_URL", expr: "v.string()" },
      { name: "LOG_LEVEL", expr: "v.string()" },
      { name: "SESSION_SECRET", expr: "v.pipe(v.string(), v.minLength(32))" },
    ]);
  });

  it("gives .dev.vars secrets precedence over a colliding wrangler var", () => {
    const result = collectVars("BASE_URL=http://x\n", { BASE_URL: "from-wrangler" }, OPTIONS);
    expect(result).toEqual([{ name: "BASE_URL", expr: "v.string()" }]);
  });

  it("returns no entries for empty inputs", () => {
    expect(collectVars("", {}, OPTIONS)).toEqual([]);
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
});

describe("REGISTRY", () => {
  it("covers the key wrangler binding kinds, each with a valid name-field and shape", () => {
    const byKey = new Map(REGISTRY.map((d) => [d.configKey, d]));
    for (const key of [
      "kv_namespaces",
      "r2_buckets",
      "d1_databases",
      "queues.producers",
      "ratelimits",
      "assets",
      "durable_objects.bindings",
      "services",
      "workflows",
    ]) {
      expect(byKey.has(key)).toBe(true);
    }
    for (const def of REGISTRY) {
      expect(["binding", "name"]).toContain(def.nameField);
      expect(["list", "object"]).toContain(def.shape);
    }
  });

  it("preserves wrangler's order: ratelimits before assets", () => {
    const keys = REGISTRY.map((d) => d.configKey);
    expect(keys.indexOf("ratelimits")).toBeLessThan(keys.indexOf("assets"));
  });
});

describe("DEFAULT_OPTIONS", () => {
  it("is an empty, generic policy carrying the presence/shape binding check", () => {
    expect(DEFAULT_OPTIONS.optional.size).toBe(0);
    expect(DEFAULT_OPTIONS.refinements).toEqual({});
    expect(DEFAULT_OPTIONS.bindingCheck).toBe(CHECK);
  });
});

describe("createGenEnv", () => {
  it("declares path flags with sensible defaults and an optional --config", () => {
    const cmd = createGenEnv();
    expect(cmd.name).toBe("gen-env");
    expect(cmd.flags.wrangler).toEqual({ type: "string", default: "wrangler.jsonc", description: "Path to wrangler.jsonc" });
    expect(cmd.flags["dev-vars"]).toEqual({ type: "string", default: ".dev.vars", description: "Path to .dev.vars" });
    expect(cmd.flags.out).toEqual({ type: "string", default: "src/app/env.schema.ts", description: "Output module path" });
    expect(cmd.flags.config).toEqual({
      type: "string",
      default: "src/app/env.config.ts",
      description: "Host-policy module exporting a Partial<GenOptions>",
    });
  });
});

describe("loadOptions", () => {
  it("returns the defaults when no config path is given", async () => {
    expect(await loadOptions()).toBe(DEFAULT_OPTIONS);
  });

  it("merges a host --config module over the defaults, inheriting unspecified fields", async () => {
    const path = join(tmpdir(), "forge-cfgen-config.fixture.ts");
    writeFileSync(path, 'export const options = { optional: new Set(["RATE_LIMITER"]), refinements: { SESSION_SECRET: { minLength: 32 } } };\n');
    const opts = await loadOptions(path);
    expect([...opts.optional]).toEqual(["RATE_LIMITER"]);
    expect(opts.refinements).toEqual({ SESSION_SECRET: { minLength: 32 } });
    expect(opts.bindingCheck).toBe(DEFAULT_OPTIONS.bindingCheck); // inherited
  });
});
