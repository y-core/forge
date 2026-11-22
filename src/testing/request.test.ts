import { describe, expect, it } from "bun:test";

import { buildRequest } from "./request";

describe("buildRequest", () => {
  it("defaults to GET against http://test", () => {
    const req = buildRequest("/settings");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://test/settings");
  });

  it("honors an explicit method and base URL", () => {
    const req = buildRequest("/x", { method: "DELETE", baseUrl: "https://example.com" });
    expect(req.method).toBe("DELETE");
    expect(req.url).toBe("https://example.com/x");
  });

  it("merges provided headers", () => {
    const req = buildRequest("/x", { headers: { "x-test": "1" } });
    expect(req.headers.get("x-test")).toBe("1");
  });

  it("encodes a formData record as url-encoded and defaults to POST", async () => {
    const req = buildRequest("/settings", { formData: { theme: "dark", lang: "en" } });
    expect(req.method).toBe("POST");
    expect(req.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(await req.text()).toBe("theme=dark&lang=en");
  });

  it("passes a FormData body through as-is", async () => {
    const fd = new FormData();
    fd.set("k", "v");
    const req = buildRequest("/x", { formData: fd });
    expect(req.method).toBe("POST");
    const body = await req.formData();
    expect(body.get("k")).toBe("v");
  });

  it("serializes a json body with the json content-type", async () => {
    const req = buildRequest("/x", { json: { a: 1 } });
    expect(req.method).toBe("POST");
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(await req.text()).toBe('{"a":1}');
  });

  it("sends a raw body untouched", async () => {
    const req = buildRequest("/x", { body: "raw" });
    expect(req.method).toBe("POST");
    expect(await req.text()).toBe("raw");
  });

  it("sets mode and credentials only when given", () => {
    const req = buildRequest("/x", { mode: "navigate", credentials: "omit" });
    expect(req.mode).toBe("navigate");
    expect(req.credentials).toBe("omit");
    expect(buildRequest("/x").mode).toBe("cors");
  });

  it("leaves mode and credentials at the runtime's defaults when neither is given", () => {
    const runtime = new Request("http://test/x");
    const req = buildRequest("/x");
    expect({ mode: req.mode, credentials: req.credentials }).toEqual({ mode: runtime.mode, credentials: runtime.credentials });
    expect(Object.getOwnPropertyDescriptor(req, "credentials")).toBeUndefined();
  });

  it.each(["navigate", "same-origin", "no-cors", "cors"] as const)("reads mode %s back", (mode) => {
    expect(buildRequest("/x", { mode }).mode).toBe(mode);
  });

  it.each(["omit", "same-origin", "include"] as const)("reads credentials %s back", (credentials) => {
    expect(buildRequest("/x", { credentials }).credentials).toBe(credentials);
  });

  it("keeps method, headers and body alongside mode and credentials", async () => {
    const req = buildRequest("/x", { json: { a: 1 }, mode: "same-origin", credentials: "omit" });
    expect({
      method: req.method,
      type: req.headers.get("content-type"),
      body: await req.text(),
      mode: req.mode,
      credentials: req.credentials,
    }).toEqual({ method: "POST", type: "application/json", body: '{"a":1}', mode: "same-origin", credentials: "omit" });
  });
});
