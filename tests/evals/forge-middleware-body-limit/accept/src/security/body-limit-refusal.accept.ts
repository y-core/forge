import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { Forge } from "../app/forge-app";
import { refuseHookCtx } from "../context/refusal";
import type { Refusal } from "../context/types";
import { mapHandler } from "../testing/route";
import { bodyLimit } from "./mod";

describe("bodyLimit's refusal", () => {
  it("is answered by the hook the chain published, as every guard's refusal is", async () => {
    const seen: Refusal[] = [];
    const publish: Middleware = (context, next) => {
      refuseHookCtx.set(context, (_c, refusal) => {
        seen.push(refusal);
        return new Response("the app's own page", { status: refusal.status });
      });
      return next();
    };
    const app = new Forge();
    app.use("*", publish, bodyLimit({ maxBytes: 1 }));
    mapHandler(app, "POST", "/upload", () => new Response("ok"));

    const res = await app.request("/upload", { method: "POST", body: "12" });

    expect([res.status, await res.text()]).toEqual([413, "the app's own page"]);
    expect(seen.map((refusal) => refusal.status)).toEqual([413]);
  });
});
