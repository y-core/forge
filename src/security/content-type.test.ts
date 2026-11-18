import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { requireFormContentType } from "./content-type";

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
  ];

  for (const { label, header } of malformed) {
    it(`returns 415 for ${label}`, async () => {
      const res = await makeApp().request("/test", { method: "POST", headers: { "content-type": header }, body: "x" });
      expect([res.status, await res.text()]).toEqual([415, "Unsupported Media Type"]);
    });
  }

  it("passes for a form type closed by an empty parameter list", async () => {
    const res = await makeApp().request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;" },
      body: "a=1",
    });
    expect(res.status).toBe(200);
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
