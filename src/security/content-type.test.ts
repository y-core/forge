import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { applyMiddlewareChain } from "../app/middleware-chain";
import { importKeyRing } from "../crypto/keyring/ring";
import { isSafeHttpMethod } from "../http/method";
import { mapHandler } from "../testing/route";
import { isSafeMethod, requireFormContentType } from "./content-type";

function makeApp() {
  const app = new Forge();
  app.use("*", requireFormContentType());
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

describe("requireFormContentType middleware", () => {
  it("passes for application/x-www-form-urlencoded", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Jane" });
    expect(res.status).toBe(200);
  });

  it("passes for multipart/form-data", async () => {
    const app = makeApp();
    const fd = new FormData();
    fd.append("name", "Jane");
    const res = await app.request("/test", { method: "POST", body: fd });
    expect(res.status).toBe(200);
  });

  it("returns 415 for application/json", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane" }),
    });
    expect(res.status).toBe(415);
  });

  it("returns 415 when content-type is absent", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(415);
  });

  it("passes for an uppercased media type (case-insensitive)", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "Application/X-WWW-Form-Urlencoded" }, body: "name=Jane" });
    expect(res.status).toBe(200);
  });

  it("passes for an uppercased media type with a charset parameter", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "MULTIPART/FORM-DATA; boundary=xyz" }, body: "ignored" });
    expect(res.status).toBe(200);
  });

  it("passes for a mixed-case media type with a quoted parameter", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": 'Application/X-WWW-Form-Urlencoded; charset="utf-8"' },
      body: "name=Jane",
    });
    expect(res.status).toBe(200);
  });

  it("returns 415 for a media type with trailing junk before any parameter", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "multipart/form-data x" }, body: "x" });
    expect(res.status).toBe(415);
  });

  const malformed: ReadonlyArray<{ label: string; header: string }> = [
    { label: "a parameter with no name before its equals sign", header: "multipart/form-data=1" },
    { label: "a missing subtype", header: "multipart/" },
    { label: "a third path segment", header: "multipart/form-data/extra" },
    { label: "a quoted media type", header: '"multipart/form-data"' },
    { label: "a comma-joined second media type", header: "multipart/form-data,text/html" },
    { label: "a form type closed by a trailing comma", header: "application/x-www-form-urlencoded," },
    { label: "a form type preceded by a comma", header: ",multipart/form-data" },
    { label: "a form type followed by a stray quote", header: 'multipart/form-data"' },
    { label: "an empty header value", header: "" },
    { label: "a whitespace-only header value", header: "   " },
  ];

  for (const { label, header } of malformed) {
    it(`returns 415 for ${label}`, async () => {
      const res = await makeApp().request("/test", { method: "POST", headers: { "content-type": header }, body: "x" });
      expect([res.status, await res.text()]).toEqual([415, "Unsupported Media Type"]);
    });
  }

  it("passes for a multipart boundary whose quoted value holds a comma", async () => {
    const res = await makeApp().request("/test", {
      method: "POST",
      headers: { "content-type": 'multipart/form-data; boundary="a, b"' },
      body: "x",
    });
    expect([res.status, await res.text()]).toEqual([200, "ok"]);
  });

  it("passes for a form type closed by an empty parameter list", async () => {
    const res = await makeApp().request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;" },
      body: "a=1",
    });
    expect(res.status).toBe(200);
  });

  it("returns 415 for a form type followed by a second media type", async () => {
    const res = await makeApp().request("/test", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x, text/html" },
      body: "x",
    });
    expect(res.status).toBe(415);
  });

  it("returns 415 for a quoted form type in a parameter of another media type", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": 'Text/HTML; charset="utf-8"; x="multipart/form-data"' },
      body: "x",
    });
    expect(res.status).toBe(415);
  });
});

describe("isSafeMethod", () => {
  const cases: ReadonlyArray<[string, boolean]> = [
    ["GET", true],
    ["HEAD", true],
    ["OPTIONS", true],
    ["get", true],
    ["head", true],
    ["options", true],
    ["gEt", true],
    ["Options", true],
    ["TRACE", true],
    ["trace", true],
    ["POST", false],
    ["PUT", false],
    ["PATCH", false],
    ["DELETE", false],
    ["post", false],
    ["CONNECT", false],
    ["PROPFIND", false],
    ["GETS", false],
    ["", false],
    // padded with whitespace, which a method token cannot contain
    [" GET ", false],
  ];

  for (const [method, safe] of cases) {
    it(`answers ${safe} for ${JSON.stringify(method)}`, () => {
      expect(isSafeMethod(method)).toBe(safe);
    });
  }

  it("answers TRACE as http's RFC 9110 predicate does", () => {
    expect(isSafeMethod("TRACE")).toBe(isSafeHttpMethod("TRACE"));
  });

  for (const method of ["GET", "HEAD", "OPTIONS", "TRACE", "POST", "PUT", "PATCH", "DELETE", "CONNECT"]) {
    it(`agrees with isSafeHttpMethod on ${method}`, () => {
      expect(isSafeMethod(method)).toBe(isSafeHttpMethod(method));
    });
  }
});

describe("requireFormContentType on a safe method", () => {
  function pageApp() {
    const app = new Forge();
    app.use("*", requireFormContentType());
    for (const method of ["GET", "HEAD", "OPTIONS"] as const) mapHandler(app, method, "/page", () => new Response("page"));
    return app;
  }

  const safe: ReadonlyArray<{ method: string; body: string }> = [
    { method: "GET", body: "page" },
    { method: "HEAD", body: "" },
    { method: "OPTIONS", body: "page" },
  ];

  for (const { method, body } of safe) {
    it(`passes a ${method} that carries no Content-Type`, async () => {
      const res = await pageApp().request("/page", { method });
      expect([res.status, await res.text()]).toEqual([200, body]);
    });

    it(`passes a ${method} that declares a JSON Content-Type`, async () => {
      const res = await pageApp().request("/page", { method, headers: { "content-type": "application/json" } });
      expect([res.status, await res.text()]).toEqual([200, body]);
    });
  }

  it("passes an OPTIONS that carries a JSON body", async () => {
    const res = await pageApp().request("/page", {
      method: "OPTIONS",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ probe: true }),
    });
    expect([res.status, await res.text()]).toEqual([200, "page"]);
  });

  it("passes a TRACE that declares a JSON Content-Type", async () => {
    const app = new Forge();
    app.use("*", requireFormContentType());
    mapHandler(app, "ANY", "/trace", () => new Response("traced"));
    const res = await app.request("/trace", { method: "TRACE", headers: { "content-type": "application/json" } });
    expect([res.status, await res.text()]).toEqual([200, "traced"]);
  });
});

describe("requireFormContentType on an unsafe method other than POST", () => {
  function mutationApp() {
    const app = new Forge();
    app.use("*", requireFormContentType());
    for (const method of ["PUT", "PATCH", "DELETE"] as const) mapHandler(app, method, "/item", () => new Response("mutated"));
    return app;
  }

  for (const method of ["PUT", "PATCH", "DELETE"]) {
    it(`answers a ${method} with a JSON body 415`, async () => {
      const res = await mutationApp().request("/item", { method, headers: { "content-type": "application/json" }, body: "{}" });
      expect([res.status, await res.text()]).toEqual([415, "Unsupported Media Type"]);
    });

    it(`answers a ${method} with no Content-Type 415`, async () => {
      const res = await mutationApp().request("/item", { method });
      expect([res.status, await res.text()]).toEqual([415, "Unsupported Media Type"]);
    });

    it(`passes a ${method} with a urlencoded body`, async () => {
      const res = await mutationApp().request("/item", { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" });
      expect([res.status, await res.text()]).toEqual([200, "mutated"]);
    });

    it(`passes a ${method} with a multipart body`, async () => {
      const fd = new FormData();
      fd.append("a", "1");
      const res = await mutationApp().request("/item", { method, body: fd });
      expect([res.status, await res.text()]).toEqual([200, "mutated"]);
    });
  }
});

describe("requireFormContentType in a guard group's shape, under a csrf policy", () => {
  const SECRET = "38f516127047072640d79f757593f8c971ed2324a5e1db688f6f129f9b0478db";

  async function confirmApp() {
    const ring = await importKeyRing([SECRET]);
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      csrf: { paths: ["/confirm"], ring: () => ring, subject: false },
      guards: [{ paths: ["/confirm"], shape: [requireFormContentType()] }],
    });
    mapHandler(app, "GET", "/confirm", () => new Response("<form></form>", { headers: { "content-type": "text/html" } }));
    mapHandler(app, "POST", "/confirm", () => new Response("confirmed"));
    mapHandler(app, "OPTIONS", "/confirm", () => new Response("options"));
    return app;
  }

  it("renders the page's GET", async () => {
    const res = await (await confirmApp()).request("/confirm");
    expect([res.status, await res.text()]).toEqual([200, "<form></form>"]);
  });

  it("answers a JSON POST 415 before the csrf verify can refuse it", async () => {
    const res = await (
      await confirmApp()
    ).request("/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    expect([res.status, await res.text()]).toEqual([415, "Unsupported Media Type"]);
  });

  it("leaves a tokenless form POST to the csrf verify", async () => {
    const res = await (
      await confirmApp()
    ).request("/confirm", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "confirm=1" });
    expect([res.status, await res.text()]).toEqual([403, "Forbidden"]);
  });

  it("renders the page's GET when it declares a JSON Content-Type", async () => {
    const res = await (await confirmApp()).request("/confirm", { headers: { "content-type": "application/json" } });
    expect([res.status, await res.text()]).toEqual([200, "<form></form>"]);
  });

  it("still holds a tokenless OPTIONS with a form body to the csrf verify", async () => {
    const res = await (
      await confirmApp()
    ).request("/confirm", { method: "OPTIONS", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "confirm=1" });
    expect([res.status, await res.text()]).toEqual([403, "Forbidden"]);
  });

  it("lets a tokenless OPTIONS with a JSON body past the guard, for the csrf verify to refuse as unreadable", async () => {
    const res = await (await confirmApp()).request("/confirm", { method: "OPTIONS", headers: { "content-type": "application/json" }, body: "{}" });
    expect([res.status, await res.text()]).toEqual([400, "Bad Request"]);
  });
});
