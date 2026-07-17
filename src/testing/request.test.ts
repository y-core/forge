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
});
