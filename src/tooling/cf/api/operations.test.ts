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
  queryD1Database: { good: [{ results: [{ n: 1 }], success: true, meta: {} }], bad: [{ results: "x" }] },
  exportD1Database: {
    good: { status: "complete", at_bookmark: "b", result: { filename: "f.sql", signed_url: "https://example.com/f" } },
    bad: { status: "active" },
  },
  getD1Bookmark: { good: { bookmark: "b" }, bad: {} },
  restoreD1Bookmark: { good: { bookmark: "b", previous_bookmark: "a", message: "ok" }, bad: { bookmark: "b" } },
  listR2Buckets: { good: { buckets: [{ name: "assets" }] }, bad: { buckets: [{}] } },
  createR2Bucket: { good: null },
  listQueues: { good: [{ queue_id: "q-1", queue_name: "jobs" }], bad: [{ queue_name: "jobs" }] },
  createQueue: { good: { queue_id: "q-1", queue_name: "jobs" }, bad: { queue_id: 1, queue_name: "jobs" } },
  getWorkerSettings: { good: { bindings: [{ type: "plain_text", name: "A", text: "x" }] }, bad: { bindings: [{ type: "plain_text" }] } },
  listWorkerSecrets: { good: [{ name: "S", type: "secret_text" }], bad: [{ type: "secret_text" }] },
  putWorkerSecret: { good: null },
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

  for (const key of ["listR2Buckets", "getWorkerSettings", "getZoneEntrypointRuleset"] as const) {
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

  it("reads worker settings without bindings as holding none", async () => {
    expect(await callOperation("getWorkerSettings", envelope({}))).toEqual({ ok: true, data: { bindings: [] } });
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

describe("exportD1Database", () => {
  it("reads an export still running, at HTTP 202, as a success carrying its bookmark", async () => {
    const r = await createCfClient(AUTH, async () =>
      Response.json(envelope({ status: "active", at_bookmark: "B", messages: [] }), { status: 202 }),
    ).post("/p", { output_format: "polling" }, CF_OPERATIONS.exportD1Database);
    expect(r).toEqual({ ok: true, data: { status: "active", at_bookmark: "B" } });
  });

  it("gives an error status with no detail an empty one", async () => {
    const r = await createCfClient(AUTH, async () => Response.json(envelope({ status: "error" }))).post("/p", {}, CF_OPERATIONS.exportD1Database);
    expect(r).toEqual({ ok: true, data: { status: "error", error: "" } });
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
