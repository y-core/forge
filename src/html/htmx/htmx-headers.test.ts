import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../testing/route";
import { hxCurrentUrl, hxSource, hxTarget, isBoosted, isPartial, readHxRequest } from "./htmx-headers";

describe("readHxRequest", () => {
  it("populates every field from request headers", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json(readHxRequest(c)));
    const res = await app.request("/", {
      headers: {
        "HX-Request": "true",
        "HX-Boosted": "true",
        "HX-Source": "button#my-btn",
        "HX-Target": "div#result",
        "HX-Request-Type": "partial",
        "HX-Current-URL": "https://example.com/page",
      },
    });
    const data = await res.json();
    expect(data).toEqual({
      enabled: true,
      boosted: true,
      source: "button#my-btn",
      target: "div#result",
      requestType: "partial",
      currentUrl: "https://example.com/page",
    });
  });

  it("defaults fields to false/empty string when headers absent", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json(readHxRequest(c)));
    const res = await app.request("/");
    const data = await res.json();
    expect(data).toEqual({ enabled: false, boosted: false, source: "", target: "", requestType: "", currentUrl: "" });
  });

  it("carries no triggerName field and ignores the htmx 2 trigger headers", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json(readHxRequest(c)));
    const res = await app.request("/", { headers: { "HX-Trigger": "my-btn", "HX-Trigger-Name": "submit-btn" } });
    const data = await res.json();
    expect(data).not.toHaveProperty("triggerName");
    expect(data).not.toHaveProperty("trigger");
    expect(data.source).toBe("");
  });

  const requestTypeCases: Array<{ header?: string; expected: string }> = [
    { header: "partial", expected: "partial" },
    { header: "full", expected: "full" },
    { expected: "" },
    { header: "PARTIAL", expected: "" },
    { header: "Full", expected: "" },
    { header: "x", expected: "" },
    { header: "", expected: "" },
  ];

  for (const { header, expected } of requestTypeCases) {
    it(`requestType is ${JSON.stringify(expected)} for HX-Request-Type ${header === undefined ? "absent" : JSON.stringify(header)}`, async () => {
      const app = new Forge();
      mapHandler(app, "GET", "/", (c) => Response.json(readHxRequest(c)));
      const headers: Record<string, string> = { "HX-Request": "true" };
      if (header !== undefined) headers["HX-Request-Type"] = header;
      const res = await app.request("/", { headers });
      expect((await res.json()).requestType).toBe(expected);
    });
  }
});

describe("isPartial", () => {
  const cases: Array<{ name: string; headers: Record<string, string>; expected: boolean }> = [
    { name: "htmx + partial → true", headers: { "HX-Request": "true", "HX-Request-Type": "partial" }, expected: true },
    {
      name: "boosted navigation (full) → false",
      headers: { "HX-Request": "true", "HX-Boosted": "true", "HX-Request-Type": "full" },
      expected: false,
    },
    {
      name: "history restore (full, no HX-Boosted) → false",
      headers: { "HX-Request": "true", "HX-History-Restore-Request": "true", "HX-Request-Type": "full" },
      expected: false,
    },
    { name: "htmx with no request type → false", headers: { "HX-Request": "true" }, expected: false },
    { name: "partial without HX-Request → false", headers: { "HX-Request-Type": "partial" }, expected: false },
    { name: "no htmx → false", headers: {}, expected: false },
  ];

  for (const { name, headers, expected } of cases) {
    it(name, async () => {
      const app = new Forge();
      mapHandler(app, "GET", "/", (c) => Response.json({ partial: isPartial(c) }));
      const res = await app.request("/", { headers });
      const data = await res.json();
      expect(data.partial).toBe(expected);
    });
  }
});

describe("convenience readers", () => {
  it("isBoosted returns true for HX-Boosted: true", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: isBoosted(c) }));
    const res = await app.request("/", { headers: { "HX-Boosted": "true" } });
    expect((await res.json()).v).toBe(true);
  });

  it("hxSource returns the issuing element's tag#id", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxSource(c) }));
    const res = await app.request("/", { headers: { "HX-Source": "button#my-btn" } });
    expect((await res.json()).v).toBe("button#my-btn");
  });

  it("hxSource returns an empty string when HX-Source is absent", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxSource(c) }));
    const res = await app.request("/", { headers: { "HX-Trigger": "my-btn" } });
    expect((await res.json()).v).toBe("");
  });

  it("hxTarget returns the target's tag#id", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxTarget(c) }));
    const res = await app.request("/", { headers: { "HX-Target": "div#result" } });
    expect((await res.json()).v).toBe("div#result");
  });

  it("hxCurrentUrl returns current URL", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxCurrentUrl(c) }));
    const res = await app.request("/", { headers: { "HX-Current-URL": "https://example.com" } });
    expect((await res.json()).v).toBe("https://example.com");
  });
});
