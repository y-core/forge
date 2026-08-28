import { describe, expect, it } from "bun:test";
import { aiHandler, createDeclarativeHandler, hyperdriveHandler, UNVERIFIED_DETAIL } from "./declarative";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

type AnyEntry = { binding?: string; name?: string; [key: string]: unknown };

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

describe("createDeclarativeHandler() — no remote object", () => {
  const handler = createDeclarativeHandler("ai", "AI", (c) => (c.ai ? [c.ai as AnyEntry] : []), {
    kind: "no-remote-object",
    reason: "an account-level capability",
  });

  it("reports deploy-pushes, since the deploy is what binds it", async () => {
    const res = await handler.reconcile([{ binding: "AI" }], makeCtx());
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect(res.results[0]?.binding).toBe("AI");
  });

  it("says why nothing was checked", async () => {
    const res = await handler.reconcile([{ binding: "AI" }], makeCtx());
    expect(res.results[0]?.detail).toBe("an account-level capability");
  });

  it("returns empty for empty entries", async () => {
    const res = await handler.reconcile([], makeCtx());
    expect(res.results).toHaveLength(0);
  });
});

describe("createDeclarativeHandler() — unverified", () => {
  const handler = createDeclarativeHandler("vectorize", "Vectorize", () => [], {
    kind: "unverified",
    reason: "indexes are listable but not queried here",
  });

  it("does not claim the binding was verified", async () => {
    const res = await handler.reconcile([{ binding: "VEC" }], makeCtx());
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect(res.results[0]?.action).not.toBe("in-sync");
  });

  it("uses the shared wording, so handler and test cannot drift", async () => {
    const res = await handler.reconcile([{ binding: "VEC" }], makeCtx());
    expect(res.results[0]?.detail).toBe(UNVERIFIED_DETAIL);
    expect(UNVERIFIED_DETAIL).toBe("not verified — no read API");
  });

  it("behaves the same in dry-run, since it makes no API calls either way", async () => {
    const res = await handler.reconcile([{ binding: "VEC" }], makeCtx({ dryRun: true }));
    expect(res.results[0]?.action).toBe("deploy-pushes");
  });
});

describe("the shipped declarative handlers", () => {
  it("does not claim a hyperdrive config was verified", async () => {
    const res = await hyperdriveHandler.reconcile([{ binding: "MY_HD", id: "hd-1" }], makeCtx());
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect(res.results[0]?.detail).toBe(UNVERIFIED_DETAIL);
  });

  it("gives a binding with no remote object its own reason", async () => {
    const res = await aiHandler.reconcile([{ binding: "AI" }], makeCtx());
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect(res.results[0]?.detail).toBe("an account-level capability, not a provisioned resource");
  });
});
