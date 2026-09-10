import { describe, expect, it } from "bun:test";

import type { DeploymentTarget } from "../types";
import type { SyncConfig, WranglerConfig } from "../types";
import { syncBindings } from "./engine";
import type { ResourceHandler } from "./handlers/types";

const AUTH = { apiToken: "tok", accountId: "acc" };

type KvEntry = { binding: string; id?: string };

function makeKvHandler(action: "in-sync" | "created" | "error"): ResourceHandler {
  return {
    type: "kv_namespaces",
    displayName: "KV",
    extract: (c: WranglerConfig) => c.kv_namespaces ?? [],
    reconcile: async (entries) => ({
      entries: (entries as KvEntry[]).map((e) => ({ ...e, id: action === "created" ? "new-id" : e.id })),
      results: (entries as KvEntry[]).map((e) => ({ resourceType: "kv_namespaces" as const, binding: e.binding, action })),
    }),
  };
}

describe("syncBindings()", () => {
  const baseConfig: WranglerConfig = { name: "my-worker", kv_namespaces: [{ binding: "MY_KV" }] };

  it("returns results from handler", async () => {
    const syncConfig: SyncConfig = { auth: AUTH };
    const out = await syncBindings(baseConfig, syncConfig, [makeKvHandler("in-sync")]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.action).toBe("in-sync");
    expect(out.results[0]?.binding).toBe("MY_KV");
  });

  it("reports the surface it compared against", async () => {
    // Returned rather than re-derived: `printResults` strips the surface prefix off every
    // detail, and must strip the exact string the handlers put there.
    const worker = await syncBindings(baseConfig, { auth: AUTH }, [makeKvHandler("in-sync")]);
    expect(worker.target).toEqual({ kind: "worker", name: "my-worker" });

    const pages: WranglerConfig = { name: "site", pages_build_output_dir: "dist", kv_namespaces: [{ binding: "KV" }] };
    const out = await syncBindings(pages, { auth: AUTH }, [makeKvHandler("in-sync")]);
    expect(out.target).toEqual({ kind: "pages", name: "site" });
  });

  it("carries a handler's notes out, tagged with the type that raised them", async () => {
    // A note is about a resource type, not a binding — so the engine attributes it
    // rather than the handler, which would otherwise have to repeat its own name.
    const noting: ResourceHandler = {
      type: "secrets",
      displayName: "Secrets",
      reportsEmpty: true,
      extract: () => [],
      reconcile: async () => ({ entries: [], results: [], notes: ["no .dev.vars here"] }),
    };
    const out = await syncBindings({ name: "w" }, { auth: AUTH }, [noting]);
    expect(out.results).toEqual([]);
    expect(out.notes).toEqual([{ resourceType: "secrets", message: "no .dev.vars here" }]);
  });

  it("reports no notes when no handler raised one", async () => {
    const out = await syncBindings(baseConfig, { auth: AUTH }, [makeKvHandler("in-sync")]);
    expect(out.notes).toEqual([]);
  });

  it("marks configChanged when IDs are written back", async () => {
    const syncConfig: SyncConfig = { auth: AUTH };
    const out = await syncBindings(baseConfig, syncConfig, [makeKvHandler("created")]);
    expect(out.configChanged).toBe(true);
    expect((out.updatedConfig.kv_namespaces as KvEntry[])[0]?.id).toBe("new-id");
  });

  it("configChanged is false when nothing changed", async () => {
    const config: WranglerConfig = { name: "w", kv_namespaces: [{ binding: "KV", id: "existing" }] };
    const handler = makeKvHandler("in-sync");
    const out = await syncBindings(config, { auth: AUTH }, [handler]);
    expect(out.configChanged).toBe(false);
  });

  it("skips handlers for types not in resources filter", async () => {
    const syncConfig: SyncConfig = { auth: AUTH, resources: ["d1_databases"] };
    const out = await syncBindings(baseConfig, syncConfig, [makeKvHandler("created")]);
    expect(out.results).toHaveLength(0);
  });

  it("skips handlers with no entries", async () => {
    const config: WranglerConfig = { name: "w" };
    const out = await syncBindings(config, { auth: AUTH }, [makeKvHandler("in-sync")]);
    expect(out.results).toHaveLength(0);
  });

  it("resolves prefix from project name by default", async () => {
    let capturedPrefix = "";
    const handler: ResourceHandler = {
      type: "kv_namespaces",
      displayName: "KV",
      extract: (c: WranglerConfig) => c.kv_namespaces ?? [],
      reconcile: async (entries, ctx) => {
        capturedPrefix = ctx.prefix;
        return { entries, results: [] };
      },
    };
    await syncBindings({ name: "my-worker", kv_namespaces: [{ binding: "KV" }] }, { auth: AUTH }, [handler]);
    expect(capturedPrefix).toBe("MY_WORKER");
  });

  it("sanitises a project name that is not an identifier", async () => {
    // Replacing only `-` left `MY.APP_KV` — not a legal name once it is lowercased
    // into DNS form for a bucket or a queue.
    let capturedPrefix = "";
    const handler: ResourceHandler = {
      type: "kv_namespaces",
      displayName: "KV",
      extract: (c: WranglerConfig) => c.kv_namespaces ?? [],
      reconcile: async (entries, ctx) => {
        capturedPrefix = ctx.prefix;
        return { entries, results: [] };
      },
    };
    await syncBindings({ name: "my.app worker", kv_namespaces: [{ binding: "KV" }] }, { auth: AUTH }, [handler]);
    expect(capturedPrefix).toBe("MY_APP_WORKER");
  });

  it("resolves custom prefix", async () => {
    let capturedPrefix = "";
    const handler: ResourceHandler = {
      type: "kv_namespaces",
      displayName: "KV",
      extract: (c: WranglerConfig) => c.kv_namespaces ?? [],
      reconcile: async (entries, ctx) => {
        capturedPrefix = ctx.prefix;
        return { entries, results: [] };
      },
    };
    await syncBindings({ name: "w", kv_namespaces: [{ binding: "KV" }] }, { auth: AUTH, prefix: { kind: "custom", prefix: "MYPREFIX" } }, [
      handler,
    ]);
    expect(capturedPrefix).toBe("MYPREFIX");
  });

  it("resolves no prefix with kind=none", async () => {
    let capturedPrefix = "NOT_EMPTY";
    const handler: ResourceHandler = {
      type: "kv_namespaces",
      displayName: "KV",
      extract: (c: WranglerConfig) => c.kv_namespaces ?? [],
      reconcile: async (entries, ctx) => {
        capturedPrefix = ctx.prefix;
        return { entries, results: [] };
      },
    };
    await syncBindings({ name: "w", kv_namespaces: [{ binding: "KV" }] }, { auth: AUTH, prefix: { kind: "none" } }, [handler]);
    expect(capturedPrefix).toBe("");
  });
});

describe("syncBindings() — deployment target", () => {
  function captureTarget(): { handler: ResourceHandler; seen: () => DeploymentTarget | undefined } {
    let captured: DeploymentTarget | undefined;
    return {
      seen: () => captured,
      handler: {
        type: "kv_namespaces",
        displayName: "KV",
        extract: (c: WranglerConfig) => c.kv_namespaces ?? [],
        reconcile: async (entries, ctx) => {
          captured = ctx.target;
          return { entries, results: [] };
        },
      },
    };
  }

  it("threads a pages target derived from the config", async () => {
    const { handler, seen } = captureTarget();
    await syncBindings({ name: "cornellaw", pages_build_output_dir: "./public", kv_namespaces: [{ binding: "KV" }] }, { auth: AUTH }, [handler]);
    expect(seen()).toEqual({ kind: "pages", name: "cornellaw" });
  });

  it("threads a worker target when main is present", async () => {
    const { handler, seen } = captureTarget();
    await syncBindings({ name: "w", main: "src/index.ts", kv_namespaces: [{ binding: "KV" }] }, { auth: AUTH }, [handler]);
    expect(seen()).toEqual({ kind: "worker", name: "w" });
  });

  it("uses the overridden scriptName as the target name", async () => {
    const { handler, seen } = captureTarget();
    await syncBindings({ name: "config-name", kv_namespaces: [{ binding: "KV" }] }, { auth: AUTH, scriptName: "override" }, [handler]);
    expect(seen()?.name).toBe("override");
  });
});

describe("syncBindings() — reportsEmpty", () => {
  const emptyReporter: ResourceHandler = {
    type: "secrets",
    displayName: "Secrets",
    reportsEmpty: true,
    extract: () => [],
    reconcile: async () => ({
      entries: [],
      results: [{ resourceType: "secrets" as const, binding: "(none)", action: "unavailable" as const, detail: "looked, found nothing" }],
    }),
  };

  it("runs a reportsEmpty handler even with no entries", async () => {
    const out = await syncBindings({ name: "w" }, { auth: AUTH }, [emptyReporter]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.detail).toBe("looked, found nothing");
  });

  it("still skips handlers that do not opt in", async () => {
    const out = await syncBindings({ name: "w" }, { auth: AUTH }, [makeKvHandler("in-sync")]);
    expect(out.results).toHaveLength(0);
  });
});
