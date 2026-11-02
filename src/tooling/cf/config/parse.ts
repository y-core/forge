import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { v } from "../../../validation/mod";
import { formatPath, stripJsonc } from "../../cli/jsonc";
import type { JsonPath } from "../../cli/types";
import { jsonTable } from "../schema";
import type { WranglerConfig } from "../types";
import type { LoadedWranglerConfig } from "./types";

const MISSING_NAME_MESSAGE = 'wrangler config must define a string "name"';

const D1DatabaseSchema = v.looseObject({
  binding: v.string(),
  database_name: v.optional(v.string()),
  database_id: v.optional(v.string()),
  preview_database_id: v.optional(v.string()),
  migrations_dir: v.optional(v.string()),
  migrations_pattern: v.optional(v.string()),
  migrations_table: v.optional(v.string()),
});

const ENVIRONMENT_ENTRIES = {
  r2_buckets: v.optional(v.array(v.looseObject({ binding: v.string() }))),
  workflows: v.optional(
    v.array(v.looseObject({ name: v.string(), binding: v.string(), class_name: v.string(), script_name: v.optional(v.string()) })),
  ),
  name: v.optional(v.string()),
  main: v.optional(v.string()),
  compatibility_date: v.optional(v.string()),
  compatibility_flags: v.optional(v.array(v.string())),
  account_id: v.optional(v.string()),
  assets: v.optional(
    jsonTable(
      v.looseObject({
        directory: v.optional(v.string()),
        binding: v.optional(v.string()),
        run_worker_first: v.optional(v.union([v.boolean(), v.array(v.string())])),
      }),
      "must be a table",
    ),
  ),
  workers_dev: v.optional(v.boolean()),
  preview_urls: v.optional(v.boolean()),
  routes: v.optional(v.array(v.unknown())),
  d1_databases: v.optional(v.array(D1DatabaseSchema)),
};

function hasOwnProto(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "__proto__");
}

const EnvironmentSchema = jsonTable(v.looseObject(ENVIRONMENT_ENTRIES), "must be an environment table");

const WranglerConfigSchema = v.looseObject(
  {
    ...ENVIRONMENT_ENTRIES,
    name: v.string(MISSING_NAME_MESSAGE),
    pages_build_output_dir: v.optional(v.string()),
    env: v.optional(
      v.pipe(
        v.unknown(),
        v.check((envs) => !Array.isArray(envs) && !hasOwnProto(envs), "must be a table of named environments"),
        v.record(v.string(), EnvironmentSchema),
      ),
    ),
    vars: v.optional(v.record(v.string(), v.unknown())),
    kv_namespaces: v.optional(v.array(v.looseObject({ binding: v.string() }))),
    queues: v.optional(
      v.looseObject({
        producers: v.optional(v.array(v.looseObject({ binding: v.string() }))),
        consumers: v.optional(v.array(v.looseObject({ queue: v.string() }))),
      }),
    ),
  },
  (issue) => (issue.expected === '"name"' ? MISSING_NAME_MESSAGE : issue.message),
);

function describeIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues
    .map((issue) => {
      const keys = (issue.path ?? []).map((item) => item.key as JsonPath[number]);
      return `${formatPath(keys) || "(root)"}: ${issue.message}`;
    })
    .join("; ");
}

/** Decodes JSONC source text into a plain value, throwing the normalized malformed-config error. @internal */
export function decodeWranglerSource(source: string, origin: string): unknown {
  try {
    return JSON.parse(stripJsonc(source));
  } catch (thrown) {
    throw new Error(`malformed wrangler config at ${origin}: invalid JSON — ${(thrown as Error).message}`, { cause: thrown });
  }
}

/** Holds a decoded config to the fields forge reads, returning it unchanged; the seam a non-JSONC source plugs into. @internal */
export function validateWranglerConfig(tree: unknown, origin: string): WranglerConfig {
  const result = v.safeParse(WranglerConfigSchema, tree);
  if (!result.success) throw new Error(`malformed wrangler config at ${origin}: ${describeIssues(result.issues)}`);
  return tree as WranglerConfig;
}

export function loadWranglerConfig(configPath: string): LoadedWranglerConfig {
  const abs = resolve(configPath);
  const source = readFileSync(abs, "utf-8");
  return { path: abs, source, config: validateWranglerConfig(decodeWranglerSource(source, abs), abs) };
}

export function parseWranglerConfig(configPath: string): WranglerConfig {
  return loadWranglerConfig(configPath).config;
}
