import { v } from "../../../validation/validation";
import { jsonTable } from "../schema";
import type { CfListOperation, CfOperation } from "./types";

const count = v.exactOptional(v.number());

export const CF_ENVELOPE = v.object({
  success: v.boolean(),
  errors: v.optional(v.array(v.object({ code: v.exactOptional(v.number()), message: v.string() })), []),
  result: v.unknown(),
  result_info: v.nullish(
    jsonTable(
      v.object({
        page: count,
        per_page: count,
        count,
        total_count: count,
        total_pages: count,
        cursor: v.nullish(v.string()),
        is_truncated: v.exactOptional(v.boolean()),
      }),
    ),
  ),
});

const kvNamespace = v.object({ id: v.string(), title: v.string() });

const d1Database = v.object({ uuid: v.string(), name: v.string() });

const queue = v.object({ queue_id: v.string(), queue_name: v.string() });

const binding = v.object({
  type: v.string(),
  name: v.string(),
  text: v.exactOptional(v.string()),
  namespace_id: v.exactOptional(v.string()),
  simple: v.exactOptional(jsonTable(v.object({ limit: v.exactOptional(v.number()), period: v.exactOptional(v.number()) }))),
});

// Loose so `--json` keeps the `id`, `version` and `ref` Cloudflare assigns to each rule.
const zoneRule = v.looseObject({
  action: v.string(),
  expression: v.string(),
  description: v.optional(v.string(), ""),
  enabled: v.boolean(),
  action_parameters: v.exactOptional(v.record(v.string(), v.unknown())),
});

const ZONE_ENTRYPOINT = "/zones/{zone_id}/rulesets/phases/{ruleset_phase}/entrypoint";

const D1_DATABASE = "/accounts/{account_id}/d1/database/{database_id}";

const d1Statement = jsonTable(
  v.object({ results: v.optional(v.array(v.record(v.string(), v.unknown())), []), success: v.optional(v.boolean(), true) }),
);

/** A Workflow instance as both the Cloudflare API and a local dev session's explorer answer it. @internal */
export const CF_WORKFLOW_INSTANCE = v.looseObject({
  status: v.string(),
  output: v.exactOptional(v.unknown()),
  error: v.nullish(v.union([v.string(), v.looseObject({ message: v.string() })])),
});

const buildVariable = v.object({ value: v.nullish(v.string()), is_secret: v.optional(v.boolean(), false) });

const buildScope = jsonTable(v.object({ environment_variables: v.nullish(jsonTable(v.record(v.string(), buildVariable))) }));

const BUILD_SETTINGS = "/accounts/{account_id}/builds/workers/{external_script_id}";

/** Each Cloudflare REST operation forge calls, named and paired with the schema its result must satisfy. @internal */
export const CF_OPERATIONS = {
  listKvNamespaces: { name: "GET /accounts/{account_id}/storage/kv/namespaces", paging: "page", result: v.array(kvNamespace) },
  createKvNamespace: { name: "POST /accounts/{account_id}/storage/kv/namespaces", result: kvNamespace },
  listD1Databases: { name: "GET /accounts/{account_id}/d1/database", paging: "page", result: v.array(d1Database) },
  createD1Database: { name: "POST /accounts/{account_id}/d1/database", result: d1Database },
  queryD1Database: { name: `POST ${D1_DATABASE}/query`, result: v.array(d1Statement) },
  readD1Database: { name: `POST ${D1_DATABASE}/query`, result: v.array(d1Statement), idempotent: true },
  getD1Bookmark: { name: `GET ${D1_DATABASE}/time_travel/bookmark`, result: jsonTable(v.object({ bookmark: v.string() })), idempotent: true },
  restoreD1Bookmark: {
    name: `POST ${D1_DATABASE}/time_travel/restore`,
    result: jsonTable(v.object({ bookmark: v.exactOptional(v.string()), previous_bookmark: v.exactOptional(v.string()) })),
  },
  createWorkflowInstance: { name: "POST /accounts/{account_id}/workflows/{workflow_name}/instances", result: v.looseObject({ id: v.string() }) },
  getWorkflowInstance: {
    name: "GET /accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}",
    result: CF_WORKFLOW_INSTANCE,
    idempotent: true,
  },
  listR2Buckets: {
    name: "GET /accounts/{account_id}/r2/buckets",
    paging: "cursor",
    result: v.pipe(
      jsonTable(v.object({ buckets: v.optional(v.array(v.object({ name: v.string() })), []) })),
      v.transform((r) => r.buckets),
    ),
  },
  getR2Lifecycle: {
    name: "GET /accounts/{account_id}/r2/buckets/{bucket_name}/lifecycle",
    result: jsonTable(
      v.object({
        rules: v.optional(v.array(v.looseObject({ id: v.string(), enabled: v.boolean(), conditions: v.looseObject({ prefix: v.string() }) })), []),
      }),
    ),
    idempotent: true,
  },
  listR2Objects: {
    name: "GET /accounts/{account_id}/r2/buckets/{bucket_name}/objects",
    result: v.array(v.object({ key: v.string(), size: v.number() })),
    idempotent: true,
  },
  getR2Object: { name: "GET /accounts/{account_id}/r2/buckets/{bucket_name}/objects/{object_key}", result: v.unknown(), idempotent: true },
  putR2Object: { name: "PUT /accounts/{account_id}/r2/buckets/{bucket_name}/objects/{object_key}", result: v.unknown() },
  putR2Lifecycle: { name: "PUT /accounts/{account_id}/r2/buckets/{bucket_name}/lifecycle", result: v.unknown() },
  createR2Bucket: { name: "PUT /accounts/{account_id}/r2/buckets/{bucket_name}", result: v.unknown() },
  listQueues: { name: "GET /accounts/{account_id}/queues", paging: "page", result: v.array(queue) },
  createQueue: { name: "POST /accounts/{account_id}/queues", result: queue },
  getWorkerSettings: {
    name: "GET /accounts/{account_id}/workers/scripts/{script_name}/settings",
    result: jsonTable(v.object({ bindings: v.optional(v.array(binding), []) })),
  },
  listWorkerSecrets: { name: "GET /accounts/{account_id}/workers/scripts/{script_name}/secrets", result: v.array(v.object({ name: v.string() })) },
  putWorkerSecret: { name: "PUT /accounts/{account_id}/workers/scripts/{script_name}/secrets", result: v.unknown() },
  listWorkerScripts: { name: "GET /accounts/{account_id}/workers/scripts", result: v.array(v.object({ id: v.string(), tag: v.string() })) },
  getWorkerBuildSettings: {
    name: `GET ${BUILD_SETTINGS}`,
    result: jsonTable(
      v.object({
        production_settings: v.nullish(buildScope),
        previews_base_config: v.nullish(buildScope),
        previews_enabled: v.optional(v.boolean(), false),
      }),
    ),
  },
  patchWorkerBuildSettings: { name: `PATCH ${BUILD_SETTINGS}`, result: v.unknown() },
  getZoneEntrypointRuleset: { name: `GET ${ZONE_ENTRYPOINT}`, result: jsonTable(v.object({ rules: v.optional(v.array(zoneRule), []) })) },
  putZoneEntrypointRuleset: { name: `PUT ${ZONE_ENTRYPOINT}`, result: v.unknown() },
} satisfies Record<string, CfOperation<unknown> | CfListOperation<unknown>>;
