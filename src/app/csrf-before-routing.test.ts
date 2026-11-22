import { beforeAll, describe, expect, it } from "bun:test";

import { importKeyRing } from "../crypto/keyring/ring";
import type { KeyRing } from "../crypto/keyring/types";
import { createCsrfToken } from "../form/csrf";
import { mapHandler } from "../testing/route";
import { Forge } from "./forge-app";
import { applyMiddlewareChain } from "./middleware-chain";
import type { MethodMismatch } from "./types";

const CSRF_SECRET = "38f516127047072640d79f757593f8c971ed2324a5e1db688f6f129f9b0478db";
const SAME_ORIGIN = { origin: "http://localhost" };

let ring: KeyRing;
beforeAll(async () => {
  ring = await importKeyRing([CSRF_SECRET]);
});

function buildApp(mode: MethodMismatch | "default", options: { devTools?: boolean } = {}) {
  const dispatched: string[] = [];
  const app = new Forge();
  if (mode !== "default") app.setMethodMismatch(mode);
  applyMiddlewareChain(app, { securityHeaders: {}, csrf: { ring: () => ring, subject: false } });
  mapHandler(app, "GET", "/privacy", () => (dispatched.push("GET /privacy"), new Response("privacy")));
  mapHandler(app, "POST", "/contact", () => (dispatched.push("POST /contact"), new Response("sent")));
  if (options.devTools) mapHandler(app, "POST", "/__dev/reset", () => (dispatched.push("POST /__dev/reset"), new Response("reset")));
  return { app, dispatched };
}

function post(headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...SAME_ORIGIN, ...headers }, body: "name=Ada" };
}

async function tokenFor(path: string): Promise<Record<string, string>> {
  return { "x-csrf-token": await createCsrfToken(ring, path) };
}

async function observe(res: Response, dispatched: string[]) {
  return { status: res.status, allow: res.headers.get("allow"), body: await res.text(), dispatched };
}

const FORBIDDEN = { status: 403, allow: null, body: "Forbidden", dispatched: [] };
const NOT_FOUND = { status: 404, allow: null, body: "Not Found", dispatched: [] };

for (const mode of ["default", "advertise"] as const) {
  describe(`a tokenless POST under the default csrf paths, methodMismatch ${mode}`, () => {
    for (const { name, path } of [
      { name: "a URL no route serves", path: "/nope" },
      { name: "a route that serves only GET", path: "/privacy" },
    ]) {
      it(`answers the csrf 403 for ${name}, before the router's own answer`, async () => {
        const { app, dispatched } = buildApp(mode);

        expect(await observe(await app.request(path, post()), dispatched)).toStrictEqual(FORBIDDEN);
      });
    }

    it("answers a path mounted only in dev identically in prod, where it is unmounted", async () => {
      const dev = buildApp(mode, { devTools: true });
      const prod = buildApp(mode);

      expect({
        dev: await observe(await dev.app.request("/__dev/reset", post()), dev.dispatched),
        prod: await observe(await prod.app.request("/__dev/reset", post()), prod.dispatched),
      }).toStrictEqual({ dev: FORBIDDEN, prod: FORBIDDEN });
    });

    it("answers the csrf 403 for a POST route, the real mutation the others are indistinguishable from", async () => {
      const { app, dispatched } = buildApp(mode);

      expect(await observe(await app.request("/contact", post()), dispatched)).toStrictEqual(FORBIDDEN);
    });

    it("answers a forged token on a GET-only route with the csrf 403", async () => {
      const { app, dispatched } = buildApp(mode);

      expect(await observe(await app.request("/privacy", post({ "x-csrf-token": "forged.token" })), dispatched)).toStrictEqual(FORBIDDEN);
    });
  });
}

describe("a token-bearing POST reaches the router's own answer", () => {
  it("answers a GET-only route with the not-found 404 by default", async () => {
    const { app, dispatched } = buildApp("default");

    expect(await observe(await app.request("/privacy", post(await tokenFor("/privacy"))), dispatched)).toStrictEqual(NOT_FOUND);
  });

  it("answers a GET-only route with a 405 naming GET and HEAD under advertise", async () => {
    const { app, dispatched } = buildApp("advertise");

    expect(await observe(await app.request("/privacy", post(await tokenFor("/privacy"))), dispatched)).toStrictEqual({
      status: 405,
      allow: "GET, HEAD",
      body: "Method Not Allowed",
      dispatched: [],
    });
  });

  for (const mode of ["default", "advertise"] as const) {
    it(`answers a URL no route serves with 404, methodMismatch ${mode}`, async () => {
      const { app, dispatched } = buildApp(mode);

      expect(await observe(await app.request("/nope", post(await tokenFor("/nope"))), dispatched)).toStrictEqual(NOT_FOUND);
    });

    it(`dispatches a POST route, methodMismatch ${mode}`, async () => {
      const { app, dispatched } = buildApp(mode);

      expect(await observe(await app.request("/contact", post(await tokenFor("/contact"))), dispatched)).toStrictEqual({
        status: 200,
        allow: null,
        body: "sent",
        dispatched: ["POST /contact"],
      });
    });

    it(`dispatches a path mounted only in dev, and answers 404 for it in prod, methodMismatch ${mode}`, async () => {
      const dev = buildApp(mode, { devTools: true });
      const prod = buildApp(mode);
      const token = await tokenFor("/__dev/reset");

      expect({
        dev: await observe(await dev.app.request("/__dev/reset", post(token)), dev.dispatched),
        prod: await observe(await prod.app.request("/__dev/reset", post(token)), prod.dispatched),
      }).toStrictEqual({ dev: { status: 200, allow: null, body: "reset", dispatched: ["POST /__dev/reset"] }, prod: NOT_FOUND });
    });
  }
});

describe("a safe-method mismatch, which the csrf policy never arms", () => {
  it("answers a GET to a POST-only route with the not-found 404 by default", async () => {
    const { app, dispatched } = buildApp("default");

    expect(await observe(await app.request("/contact"), dispatched)).toStrictEqual(NOT_FOUND);
  });

  it("answers a GET to a POST-only route with a 405 naming POST under advertise", async () => {
    const { app, dispatched } = buildApp("advertise");

    expect(await observe(await app.request("/contact"), dispatched)).toStrictEqual({
      status: 405,
      allow: "POST",
      body: "Method Not Allowed",
      dispatched: [],
    });
  });

  for (const mode of ["default", "advertise"] as const) {
    it(`answers a GET to a URL no route serves with 404, methodMismatch ${mode}`, async () => {
      const { app, dispatched } = buildApp(mode);

      expect(await observe(await app.request("/nope"), dispatched)).toStrictEqual(NOT_FOUND);
    });
  }
});
