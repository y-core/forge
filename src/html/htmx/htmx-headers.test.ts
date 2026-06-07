import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import { hxCurrentUrl, hxTarget, hxTrigger, hxTriggerName, isBoosted, isPartial, readHxRequest } from "./htmx-headers";

describe("readHxRequest", () => {
  it("populates all six fields from request headers", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json(readHxRequest(c)));
    const res = await app.request("/", {
      headers: {
        "HX-Request": "true",
        "HX-Boosted": "true",
        "HX-Trigger": "my-btn",
        "HX-Target": "#result",
        "HX-Trigger-Name": "submit-btn",
        "HX-Current-URL": "https://example.com/page",
      },
    });
    const data = await res.json();
    expect(data).toEqual({
      enabled: true,
      boosted: true,
      trigger: "my-btn",
      target: "#result",
      triggerName: "submit-btn",
      currentUrl: "https://example.com/page",
    });
  });

  it("defaults fields to false/empty string when headers absent", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json(readHxRequest(c)));
    const res = await app.request("/");
    const data = await res.json();
    expect(data).toEqual({ enabled: false, boosted: false, trigger: "", target: "", triggerName: "", currentUrl: "" });
  });
});

describe("isPartial", () => {
  const cases: Array<{ name: string; hxRequest?: string; boosted?: string; expected: boolean }> = [
    { name: "htmx + not boosted → true", hxRequest: "true", expected: true },
    { name: "htmx + boosted → false", hxRequest: "true", boosted: "true", expected: false },
    { name: "no htmx → false", expected: false },
  ];

  for (const { name, hxRequest, boosted, expected } of cases) {
    it(name, async () => {
      const app = new Forge();
      mapHandler(app, "GET", "/", (c) => Response.json({ partial: isPartial(c) }));
      const headers: Record<string, string> = {};
      if (hxRequest) headers["HX-Request"] = hxRequest;
      if (boosted) headers["HX-Boosted"] = boosted;
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

  it("hxTrigger returns trigger name", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxTrigger(c) }));
    const res = await app.request("/", { headers: { "HX-Trigger": "my-btn" } });
    expect((await res.json()).v).toBe("my-btn");
  });

  it("hxTarget returns target selector", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxTarget(c) }));
    const res = await app.request("/", { headers: { "HX-Target": "#result" } });
    expect((await res.json()).v).toBe("#result");
  });

  it("hxTriggerName returns trigger name attribute", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxTriggerName(c) }));
    const res = await app.request("/", { headers: { "HX-Trigger-Name": "submit-btn" } });
    expect((await res.json()).v).toBe("submit-btn");
  });

  it("hxCurrentUrl returns current URL", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => Response.json({ v: hxCurrentUrl(c) }));
    const res = await app.request("/", { headers: { "HX-Current-URL": "https://example.com" } });
    expect((await res.json()).v).toBe("https://example.com");
  });
});
