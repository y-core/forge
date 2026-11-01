import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { experimental_generateTypes } from "wrangler";

import { DEFAULT_OPTIONS, REGISTRY } from "./cf-env-registry";
import type { BindingDef } from "./types";

const CHECK = '(x) => typeof x === "object" && x !== null';

const NOT_A_BINDING = [
  "name",
  "account_id",
  "compatibility_date",
  "compatibility_flags",
  "main",
  "find_additional_modules",
  "preserve_file_names",
  "base_dir",
  "workers_dev",
  "preview_urls",
  "routes",
  "route",
  "tsconfig",
  "jsx_factory",
  "jsx_fragment",
  "migrations",
  "exports",
  "triggers",
  "limits",
  "rules",
  "build",
  "no_bundle",
  "minify",
  "keep_names",
  "first_party_worker",
  "logpush",
  "upload_source_maps",
  "placement",
  "observability",
  "access",
  "cache",
  "compliance_region",
  "python_modules",
  "previews",
  "define",
  "cloudchamber",
  "containers",
  "connect",
  "tail_consumers",
  "streaming_tail_consumers",
];

const COVERED_BY_VARS = ["vars", "secrets"];

const UNCOVERED = ["logfwdr", "unsafe"];

const FIXTURE: Record<string, Record<string, unknown>> = {
  kv_namespaces: { id: "kv-one" },
  r2_buckets: { bucket_name: "bucket-one" },
  d1_databases: { database_id: "d1-one" },
  vectorize: { index_name: "index-one" },
  hyperdrive: { id: "hyperdrive-one" },
  send_email: {},
  analytics_engine_datasets: {},
  dispatch_namespaces: { namespace: "namespace-one" },
  mtls_certificates: { certificate_id: "certificate-one" },
  "queues.producers": { queue: "queue-one" },
  k2: { stream: "stream-one" },
  secrets_store_secrets: { store_id: "store-one", secret_name: "secret-one" },
  artifacts: { namespace: "namespace-one" },
  unsafe_hello_world: {},
  flagship: {},
  ratelimits: { namespace_id: "1", simple: { limit: 1, period: 60 } },
  worker_loaders: {},
  vpc_services: { service_id: "service-one" },
  vpc_networks: { network_id: "network-one" },
  ai_search_namespaces: { namespace: "namespace-one" },
  ai_search: { instance_name: "instance-one" },
  agent_memory: { namespace: "namespace-one" },
  browser: {},
  analytics: {},
  ai: {},
  images: {},
  stream: {},
  media: {},
  version_metadata: {},
  assets: { directory: "./public" },
  pipelines: { stream: "stream-one" },
  "durable_objects.bindings": { class_name: "X" },
  services: { service: "service-one" },
  workflows: { name: "workflow-one", class_name: "X" },
};

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function topLevelKey(def: BindingDef): string {
  return def.configKey.split(".")[0]!;
}

function memberName(index: number): string {
  return `B_${String(index).padStart(2, "0")}`;
}

function baseType(type: string): string {
  const uncommented = type.replace(/\/\*[\s\S]*?\*\//g, "");
  let stripped = uncommented;
  for (let previous = ""; previous !== stripped;) {
    previous = stripped;
    stripped = stripped.replace(/<[^<>]*>/g, "");
  }
  return stripped.replace(/\s+/g, " ").trim();
}

function rawEnvironmentKeys(): string[] {
  const wranglerRoot = dirname(fileURLToPath(import.meta.resolve("wrangler/package.json")));
  const schema = JSON.parse(readFileSync(join(wranglerRoot, "config-schema.json"), "utf-8")) as {
    definitions: { RawEnvironment: { properties: Record<string, unknown> } };
  };
  return Object.keys(schema.definitions.RawEnvironment.properties).sort();
}

function writeFixtureWorker(defs: readonly BindingDef[]): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-cf-env-drift-"));
  tempDirs.push(dir);
  const bindings = defs.map((def, index) => {
    const entry = { [def.nameField]: memberName(index), ...FIXTURE[def.configKey] };
    const value = def.shape === "list" ? [entry] : entry;
    const [top, nested] = def.configKey.split(".") as [string, string | undefined];
    return [top, nested === undefined ? value : { [nested]: value }] as const;
  });
  const config = {
    name: "drift",
    main: "index.ts",
    compatibility_date: "2025-01-01",
    exports: { X: { type: "durable-object", storage: "sqlite" } },
    secrets: { required: [] },
    ...Object.fromEntries(bindings),
  };
  writeFileSync(join(dir, "index.ts"), "export default {}; export class X {}\n");
  writeFileSync(join(dir, "wrangler.json"), JSON.stringify(config));
  return join(dir, "wrangler.json");
}

function envMembers(env: string): [string, string][] {
  return [...env.matchAll(/^\t(B_\d{2}): (.*?);\n(?=\tB_|\})/gms)].map((match) => [match[1]!, baseType(match[2]!)]);
}

describe("REGISTRY", () => {
  it("classifies every RawEnvironment key exactly once (the RawConfig-only wasm_modules, text_blobs and data_blobs are out of scope)", () => {
    const classified = [...REGISTRY.map(topLevelKey), ...UNCOVERED, ...COVERED_BY_VARS, ...NOT_A_BINDING].sort();

    expect(classified).toEqual(rawEnvironmentKeys());
  });

  it("has a fixture for every binding kind and none besides", () => {
    expect(Object.keys(FIXTURE).sort()).toEqual(REGISTRY.map((def) => def.configKey).sort());
  });

  it("matches wrangler's emitted members, in REGISTRY order, for every kind but pipelines, which would reach the network, with no secret source read", async () => {
    const defs = REGISTRY.filter((def) => def.configKey !== "pipelines");
    const result = await experimental_generateTypes({ config: writeFixtureWorker(defs), includeRuntime: false });

    expect(result.runtime).toBeNull();
    expect(envMembers(result.env ?? "")).toEqual(defs.map((def, index) => [memberName(index), baseType(def.tsType)]));
  }, 30_000);
});

describe("DEFAULT_OPTIONS", () => {
  it("is an empty, generic policy carrying the presence/shape binding check", () => {
    expect(DEFAULT_OPTIONS.optional.size).toBe(0);
    expect(DEFAULT_OPTIONS.refinements).toEqual({});
    expect(DEFAULT_OPTIONS.bindingCheck).toBe(CHECK);
  });
});
