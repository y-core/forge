import { describe, expect, it } from "bun:test";

import type { Result } from "../../../result/types";
import { v } from "../../../validation/validation";
import { createCfClient } from "./client";
import { CF_ENVELOPE, CF_OPERATIONS } from "./operations";
import type { CfApiClientError, CfListOperation, CfOperation } from "./types";

const AUTH = { apiToken: "tok" };

type OperationKey = keyof typeof CF_OPERATIONS;

const MALFORMED_ENVELOPE = { success: "yes", errors: [], result: null };

const SAMPLES: Record<OperationKey, { good: unknown; bad?: unknown }> = {
  listKvNamespaces: { good: [{ id: "ns-1", title: "PROJ_KV" }], bad: [{ id: 1, title: "PROJ_KV" }] },
  createKvNamespace: { good: { id: "ns-1", title: "PROJ_KV" }, bad: { id: "ns-1" } },
  listD1Databases: { good: [{ uuid: "db-1", name: "app-db" }], bad: [{ name: "app-db" }] },
  createD1Database: { good: { uuid: "db-1", name: "app-db" }, bad: { uuid: "db-1" } },
  getD1Database: { good: { uuid: "db-1", name: "a" }, bad: { uuid: "db-1" } },
  startD1Export: { good: { status: "active", at_bookmark: "b" }, bad: { status: "x" } },
  pollD1Export: { good: { status: "active", at_bookmark: "b" }, bad: { status: "x" } },
  importD1Database: { good: { status: "complete", result: { num_queries: 1 } }, bad: { errors: [1] } },
  pollD1Import: { good: { status: "complete", result: { num_queries: 1 } }, bad: { errors: [1] } },
  queryD1Database: { good: [{ results: [{ n: 1 }], success: true, meta: {} }], bad: [{ results: "x" }] },
  readD1Database: { good: [{ results: [{ n: 1 }], success: true, meta: {} }], bad: [{ results: "x" }] },
  getD1Bookmark: { good: { bookmark: "b" }, bad: {} },
  restoreD1Bookmark: { good: { bookmark: "b", previous_bookmark: "a", message: "ok" }, bad: { previous_bookmark: 1 } },
  getR2Lifecycle: { good: { rules: [{ id: "r", enabled: true, conditions: { prefix: "" } }] }, bad: { rules: [{ id: 1 }] } },
  putR2Lifecycle: { good: {} },
  listR2Objects: { good: [{ key: "d1-backups/a.sql", size: 12, etag: "e" }], bad: [{ key: "d1-backups/a.sql" }] },
  getR2Object: { good: null },
  putR2Object: { good: { key: "d1-backups/a.sql" } },
  listR2Buckets: { good: { buckets: [{ name: "assets" }] }, bad: { buckets: [{}] } },
  createR2Bucket: { good: null },
  listQueues: { good: [{ queue_id: "q-1", queue_name: "jobs" }], bad: [{ queue_name: "jobs" }] },
  createQueue: { good: { queue_id: "q-1", queue_name: "jobs" }, bad: { queue_id: 1, queue_name: "jobs" } },
  getWorkerSettings: { good: { bindings: [{ type: "plain_text", name: "A", text: "x" }] }, bad: { bindings: [{ type: "plain_text" }] } },
  listWorkerSecrets: { good: [{ name: "S", type: "secret_text" }], bad: [{ type: "secret_text" }] },
  putWorkerSecret: { good: null },
  listWorkerScripts: { good: [{ id: "w", tag: "t1" }], bad: [{ id: "w" }] },
  getWorkerBuildSettings: {
    good: {
      production_settings: { environment_variables: { BUN_VERSION: { value: "1.3.1", is_secret: false } } },
      previews_base_config: { environment_variables: null },
      previews_enabled: true,
    },
    bad: { production_settings: { environment_variables: { BUN_VERSION: { value: 1 } } } },
  },
  patchWorkerBuildSettings: { good: {} },
  getZoneEntrypointRuleset: {
    good: { rules: [{ action: "block", expression: "true", description: "d", enabled: true }] },
    bad: { rules: [{ action: "block", enabled: true }] },
  },
  putZoneEntrypointRuleset: { good: {} },
};

function callOperation(key: OperationKey, body: unknown): Promise<Result<unknown, CfApiClientError>> {
  const operation: CfOperation<unknown> | CfListOperation<unknown> = CF_OPERATIONS[key];
  const client = createCfClient(AUTH, async () => Response.json(body));
  if ("paging" in operation) return client.list("/p", operation);
  const method = operation.name.split(" ")[0];
  if (method === "GET") return client.get("/p", operation);
  if (method === "POST") return client.post("/p", {}, operation);
  if (method === "PATCH") return client.patch("/p", {}, operation);
  return client.put("/p", {}, operation);
}

const envelope = (result: unknown) => ({ success: true, errors: [], messages: [], result });

describe("CF_OPERATIONS", () => {
  it("has a sample for every operation", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(CF_OPERATIONS).sort());
  });

  for (const key of Object.keys(SAMPLES) as OperationKey[]) {
    const { good, bad } = SAMPLES[key];
    const { name } = CF_OPERATIONS[key];

    it(`${key} accepts a well-formed result`, async () => {
      expect((await callOperation(key, envelope(good))).ok).toBe(true);
    });

    it(`${key} refuses a malformed ${bad === undefined ? "envelope" : "result"} as a schema error naming ${name}`, async () => {
      const r = await callOperation(key, bad === undefined ? MALFORMED_ENVELOPE : envelope(bad));
      expect(r.ok ? null : r.error.kind).toBe("schema");
      expect(r.ok ? null : r.error.message).toContain(name);
    });
  }

  for (const key of ["listR2Buckets", "getWorkerSettings", "getWorkerBuildSettings", "getZoneEntrypointRuleset"] as const) {
    it(`${key} refuses a list result, which would otherwise read as an empty one`, async () => {
      const r = await callOperation(key, envelope([]));
      expect(r.ok ? null : r.error.kind).toBe("schema");
    });
  }

  it("names the result, with no expected type, when an R2 listing arrives as a list", async () => {
    const r = await callOperation("listR2Buckets", envelope([]));
    expect(r.ok ? null : r.error.message).toBe("GET /accounts/{account_id}/r2/buckets: unexpected response shape at result");
  });

  it("refuses a rate-limit binding whose simple block is a list", async () => {
    const r = await callOperation("getWorkerSettings", envelope({ bindings: [{ type: "ratelimit", name: "LIMITER", simple: [] }] }));
    expect(r.ok ? null : r.error.message).toBe(
      "GET /accounts/{account_id}/workers/scripts/{script_name}/settings: unexpected response shape at bindings.0.simple",
    );
  });

  it("reads a restore reply naming neither bookmark, since D1 marks both optional", async () => {
    expect(await callOperation("restoreD1Bookmark", envelope({}))).toEqual({ ok: true, data: {} });
  });

  it("reads worker settings without bindings as holding none", async () => {
    expect(await callOperation("getWorkerSettings", envelope({}))).toEqual({ ok: true, data: { bindings: [] } });
  });

  it("reads build settings without either scope as holding neither, with previews disabled", async () => {
    expect(await callOperation("getWorkerBuildSettings", envelope({}))).toEqual({
      ok: true,
      data: { production_settings: undefined, previews_base_config: undefined, previews_enabled: false },
    });
  });

  it("reads a secret build variable that returns no value as a secret with none", async () => {
    const r = await createCfClient(AUTH, async () =>
      Response.json(envelope({ production_settings: { environment_variables: { T: { is_secret: true } } } })),
    ).get("/p", CF_OPERATIONS.getWorkerBuildSettings);
    expect(r.ok ? r.data.production_settings?.environment_variables?.T : null).toEqual({ is_secret: true });
  });

  it("reads a build variable without is_secret as a plain one", async () => {
    const r = await createCfClient(AUTH, async () =>
      Response.json(envelope({ production_settings: { environment_variables: { V: { value: "1" } } } })),
    ).get("/p", CF_OPERATIONS.getWorkerBuildSettings);
    expect(r.ok ? r.data.production_settings?.environment_variables?.V : null).toEqual({ value: "1", is_secret: false });
  });

  it("reads an entry point ruleset without rules as holding none", async () => {
    expect(await callOperation("getZoneEntrypointRuleset", envelope({}))).toEqual({ ok: true, data: { rules: [] } });
  });

  it("refuses a list as result_info, which would otherwise read as no paging metadata", async () => {
    const r = await callOperation("listKvNamespaces", { ...envelope([]), result_info: [] });
    expect(r.ok ? null : r.error.kind).toBe("schema");
  });

  it("reads an R2 listing without buckets as an empty one", async () => {
    expect(await callOperation("listR2Buckets", envelope({}))).toEqual({ ok: true, data: [] });
  });

  it("gives a zone rule without a description an empty one", async () => {
    const r = await createCfClient(AUTH, async () =>
      Response.json(envelope({ rules: [{ action: "block", expression: "true", enabled: true }] })),
    ).get("/p", CF_OPERATIONS.getZoneEntrypointRuleset);
    expect(r.ok ? r.data.rules[0]?.description : null).toBe("");
  });

  it("keeps the id and version Cloudflare assigns to a zone rule", async () => {
    const rule = { id: "r-1", version: "3", ref: "ref-1", action: "block", expression: "true", description: "d", enabled: true };
    const r = await createCfClient(AUTH, async () => Response.json(envelope({ rules: [rule] }))).get("/p", CF_OPERATIONS.getZoneEntrypointRuleset);
    expect(r.ok ? r.data.rules[0] : null).toMatchObject({ id: "r-1", version: "3", ref: "ref-1" });
  });
});

describe("CF_OPERATIONS idempotency", () => {
  it("marks only the reads — of a query, a bookmark, a database, a lifecycle, an object, a listing or an export or import poll — as safe to resend", () => {
    const idempotent = (Object.keys(CF_OPERATIONS) as OperationKey[]).filter((key) => {
      const operation: CfOperation<unknown> | CfListOperation<unknown> = CF_OPERATIONS[key];
      return operation.idempotent === true;
    });
    expect(idempotent.sort()).toEqual([
      "getD1Bookmark",
      "getD1Database",
      "getR2Lifecycle",
      "getR2Object",
      "listR2Objects",
      "pollD1Export",
      "pollD1Import",
      "readD1Database",
    ]);
  });
});

describe("queryD1Database", () => {
  it("reads a statement without results or success as an empty, successful one", async () => {
    const r = await createCfClient(AUTH, async () => Response.json(envelope([{ meta: {} }]))).post("/p", {}, CF_OPERATIONS.queryD1Database);
    expect(r).toEqual({ ok: true, data: [{ results: [], success: true }] });
  });
});

describe("CF_ENVELOPE", () => {
  it("accepts an error item without a code and a null result_info", () => {
    const parsed = v.safeParse(CF_ENVELOPE, { success: false, errors: [{ message: "bad" }], result: null, result_info: null });
    expect(parsed.success).toBe(true);
  });
});
