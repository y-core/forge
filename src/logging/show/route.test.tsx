import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import { mapHandler } from "../../app/route-test-helper";
import type { KVNamespace } from "../../storage/kv/types";
import { kvLogChannel } from "../kv-channel";
import type { LogChannel } from "../types";
import { loadLogViewer, renderLogFragment } from "./route";

function makeKvStub(): KVNamespace {
  return {
    get: () => Promise.resolve(null),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true }),
  } as unknown as KVNamespace;
}

// Drives the loadLogViewer loader through a definePage, mirroring how an app composes it.
// The view branches on HX-Request: HTMX requests get the <tbody> fragment; others get JSON.
function makeApp(options?: { basePath?: string }) {
  const app = new Forge();
  const handler = definePage({
    loader: (c) => loadLogViewer(c, { channel: () => kvLogChannel(makeKvStub()), ...options }),
    view: (c, _config, state) => (c.request.headers.get("HX-Request") === "true" ? renderLogFragment(state.data) : Response.json(state.data)),
  });
  mapHandler(app, "GET", "/logs", handler);
  return app;
}

describe("loadLogViewer — non-HTMX request", () => {
  it("returns the loader data when HX-Request header is absent", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rows).toEqual([]);
    expect(data.complete).toBe(true);
    expect(data.basePath).toBe("/admin/logs");
  });

  it("uses default basePath of /admin/logs", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.basePath).toBe("/admin/logs");
  });

  it("reflects a custom basePath in the returned data", async () => {
    const app = makeApp({ basePath: "/dashboard/logs" });
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.basePath).toBe("/dashboard/logs");
  });

  it("reflects level query param in the returned data", async () => {
    const app = makeApp();
    const res = await app.request("/logs?level=error");
    const data = await res.json();
    expect(data.level).toBe("error");
  });

  it("reflects q query param in the returned data", async () => {
    const app = makeApp();
    const res = await app.request("/logs?q=payment");
    const data = await res.json();
    expect(data.q).toBe("payment");
  });

  it("reflects both level and q query params together", async () => {
    const app = makeApp();
    const res = await app.request("/logs?level=error&q=payment");
    const data = await res.json();
    expect(data.level).toBe("error");
    expect(data.q).toBe("payment");
  });

  it("omits level from data when query param is absent", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.level).toBeUndefined();
  });

  it("omits q from data when query param is absent", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.q).toBeUndefined();
  });

  it("returns empty rows when channel has no read method", async () => {
    const writeOnlyChannel: LogChannel = { write: () => {} };
    const app = new Forge();
    const handler = definePage({
      loader: (c) => loadLogViewer(c, { channel: () => writeOnlyChannel }),
      view: (_c, _config, state) => Response.json(state.data),
    });
    mapHandler(app, "GET", "/logs", handler);

    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rows).toEqual([]);
    expect(data.complete).toBe(true);
  });
});

describe("loadLogViewer — HTMX request (via view branch)", () => {
  it("returns a 200 HTML <tbody> fragment when HX-Request header is true", async () => {
    const app = makeApp();
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<tbody");
  });

  it("returns an HTML content-type for the HTMX partial", async () => {
    const app = makeApp();
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  it("does not treat HX-Request: false as an HTMX request", async () => {
    const app = makeApp();
    const res = await app.request("/logs", { headers: { "HX-Request": "false" } });
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");
  });
});

describe("renderLogFragment — direct unit tests", () => {
  it("returns 200 with text/html content-type", async () => {
    const res = await renderLogFragment({ rows: [], complete: true, basePath: "/admin/logs" });
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  it("body contains a <tbody element", async () => {
    const res = await renderLogFragment({ rows: [], complete: true, basePath: "/admin/logs" });
    const body = await res.text();
    expect(body).toContain("<tbody");
  });

  it("uses a custom basePath for the load-more action", async () => {
    const res = await renderLogFragment({ rows: [], complete: false, cursor: "abc", basePath: "/dashboard/logs" });
    const body = await res.text();
    expect(body).toContain("/dashboard/logs");
  });
});
