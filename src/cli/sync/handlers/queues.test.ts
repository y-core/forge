import { describe, expect, it } from "bun:test";
import type { WranglerConfig } from "../types";
import { queuesHandler } from "./queues";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    auth: AUTH,
    scriptName: "worker",
    prefix: "",
    dryRun: false,
    rotate: new Set<string>(),
    fetch: globalThis.fetch,
    target: { kind: "worker", name: "worker" },
    ...overrides,
  };
}

function makeFetch(queues: unknown[], createResult?: unknown): typeof globalThis.fetch {
  let count = 0;
  return async (_url, init) => {
    if ((init?.method ?? "GET") === "POST") {
      count++;
      return new Response(
        JSON.stringify({ success: true, errors: [], messages: [], result: createResult ?? { queue_id: `q-${count}`, queue_name: "created" } }),
      );
    }
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: queues }));
  };
}

describe("queuesHandler.extract()", () => {
  it("returns empty when no queues", () => {
    expect(queuesHandler.extract({ name: "t" } as WranglerConfig)).toEqual([]);
  });

  it("returns producers from queues.producers", () => {
    const config: WranglerConfig = { name: "t", queues: { producers: [{ binding: "Q", queue: "my-q" }] } };
    expect(queuesHandler.extract(config)).toHaveLength(1);
  });
});

describe("queuesHandler.reconcile()", () => {
  it("reports exists when queue found", async () => {
    const fetchFn = makeFetch([{ queue_id: "q-1", queue_name: "my-queue" }]);
    const res = await queuesHandler.reconcile([{ binding: "MY_QUEUE", queue: "my-queue" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteId).toBe("q-1");
    expect(res.results[0]?.remoteName).toBe("my-queue");
  });

  it("creates queue when not found", async () => {
    const fetchFn = makeFetch([], { queue_id: "new-q", queue_name: "my-queue" });
    const res = await queuesHandler.reconcile([{ binding: "MY_QUEUE" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("created");
    expect(res.entries[0]?.queue_id).toBe("new-q");
  });

  it("skips in dry-run", async () => {
    const res = await queuesHandler.reconcile([{ binding: "Q" }], makeCtx({ fetch: makeFetch([]), dryRun: true }));
    expect(res.results[0]?.action).toBe("would-create");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
    expect(res.results[0]?.remoteName).toBe("q");
  });
});

describe("queuesHandler.reconcile() — the queue_id is the identity", () => {
  it("matches by queue_id whatever the queue is named", async () => {
    const fetchFn = makeFetch([{ queue_id: "q-legacy", queue_name: "hand-made-queue" }]);
    const res = await queuesHandler.reconcile([{ binding: "JOBS", queue_id: "q-legacy" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteName).toBe("hand-made-queue");
    expect(res.entries[0]).toEqual({ binding: "JOBS", queue_id: "q-legacy" });
  });

  it("treats an explicit queue name as the remote it means", async () => {
    const fetchFn = makeFetch([{ queue_id: "q-2", queue_name: "existing-queue" }]);
    const res = await queuesHandler.reconcile([{ binding: "JOBS", queue: "existing-queue" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.entries[0]?.queue_id).toBe("q-2");
  });

  it("names a stale queue_id on the row it falls back to", async () => {
    const fetchFn = makeFetch([{ queue_id: "q-current", queue_name: "jobs" }]);
    const res = await queuesHandler.reconcile([{ binding: "JOBS", queue_id: "q-gone" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.remoteId).toBe("q-current");
    expect(res.results[0]?.detail).toBe("local id q-gone not found on this account");
  });
});
