import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import * as contextBarrel from "./mod";
import { refuseHookCtx } from "./refusal";
import type { RefuseHook } from "./types";

function makeCtx() {
  return new RequestContext(new Request("http://localhost/save", { method: "POST" }));
}

const hook: RefuseHook = (_c, refusal) => new Response(null, { status: refusal.status });

describe("refuseHookCtx", () => {
  it("is undefined on a request no chain published a hook for", () => {
    expect(refuseHookCtx.getOptional(makeCtx())).toBeUndefined();
  });

  it("returns the very hook published on the request", () => {
    const c = makeCtx();
    refuseHookCtx.set(c, hook);
    expect(refuseHookCtx.getOptional(c)).toBe(hook);
  });

  it("keeps one request's hook off another request", () => {
    const published = makeCtx();
    refuseHookCtx.set(published, hook);
    expect(refuseHookCtx.getOptional(makeCtx())).toBeUndefined();
  });

  it("is the export the context barrel publishes", () => {
    expect(contextBarrel.refuseHookCtx).toBe(refuseHookCtx);
  });
});
