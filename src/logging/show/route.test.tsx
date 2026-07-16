import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import { mapHandler } from "../../app/route-test-helper";
import type { KVNamespace } from "../../storage/kv/types";
import { createIcon } from "../../ui/core/icon";
import { kvLogChannel } from "../kv-channel";
import type { LogChannel } from "../types";
import type { LogViewerAccess } from "./route";
import { loadLogViewer } from "./route";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

function makeKvStub(): KVNamespace {
  return {
    get: () => Promise.resolve(null),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true }),
  } as unknown as KVNamespace;
}

// Drives loadLogViewer through a definePage, mirroring how an app composes it. The loader now
// returns a Response for every path, so it short-circuits before the view runs — the view here
// is a sentinel that must never execute.
function makeApp(options?: { basePath?: string; access?: LogViewerAccess; channel?: (c: unknown) => LogChannel }) {
  const app = new Forge();
  const handler = definePage({
    loader: (c) => loadLogViewer(c, { channel: () => kvLogChannel(makeKvStub()), access: "allow-unauthenticated", icon, ...options }),
    view: () => new Response("view-should-not-run", { status: 500 }),
  });
  mapHandler(app, "GET", "/logs", handler);
  return app;
}

describe("loadLogViewer — access control", () => {
  it("denies with exactly 403 Forbidden when the access predicate returns false", async () => {
    const app = makeApp({ access: () => false });
    const res = await app.request("/logs");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("never touches the channel when access is denied", async () => {
    let channelResolved = false;
    const app = makeApp({
      access: async () => false,
      channel: () => {
        channelResolved = true;
        return kvLogChannel(makeKvStub());
      },
    });

    const res = await app.request("/logs");
    expect(res.status).toBe(403);
    expect(channelResolved).toBe(false);
  });

  it("denies the HTMX fragment path as well (guard runs in the shared loader)", async () => {
    const app = makeApp({ access: () => false });
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("denies the detail path as well", async () => {
    const app = makeApp({ access: () => false });
    const res = await app.request("/logs?detail=anything");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it('proceeds when access is the explicit "allow-unauthenticated" literal', async () => {
    const app = makeApp({ access: "allow-unauthenticated" });
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
  });

  it("proceeds when the access predicate returns true", async () => {
    const app = makeApp({ access: async (c) => c.request.headers.get("x-admin") === "yes" });
    const res = await app.request("/logs", { headers: { "x-admin": "yes" } });
    expect(res.status).toBe(200);
  });
});

describe("loadLogViewer — full page (non-HTMX GET)", () => {
  it("returns a 200 text/html full-document Response", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("renders a complete HTML document (doctype + title + viewer main)", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(body).toContain("<title>Request Log</title>");
    expect(body).toContain('<h1 class="mb-6 text-2xl font-semibold text-brand-900">Request Log</h1>');
    expect(body).toContain('<main id="main-content"');
    // The empty channel yields the no-entries row (period included, no entity encoding needed).
    expect(body).toContain("No log entries found.");
  });

  it("never falls through to the view (loader short-circuits with a Response)", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const body = await res.text();
    expect(body).not.toContain("view-should-not-run");
  });

  it("uses default basePath of /admin/logs in the filter form action", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const body = await res.text();
    expect(body).toContain('hx-get="/admin/logs"');
  });

  it("reflects a custom basePath in the rendered form action", async () => {
    const app = makeApp({ basePath: "/dashboard/logs" });
    const res = await app.request("/logs");
    const body = await res.text();
    expect(body).toContain('hx-get="/dashboard/logs"');
  });

  it("pre-selects the level from the query param", async () => {
    const app = makeApp();
    const res = await app.request("/logs?level=error");
    const body = await res.text();
    expect(body).toContain('value="error" selected');
  });

  it("pre-fills the search query from the q param", async () => {
    const app = makeApp();
    const res = await app.request("/logs?q=payment");
    const body = await res.text();
    expect(body).toContain('value="payment"');
  });
});

describe("loadLogViewer — HTMX request", () => {
  it("returns a 200 text/html <tbody> fragment (no doctype) when HX-Request is true", async () => {
    const app = makeApp();
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("<tbody")).toBe(true);
    expect(body).not.toContain("<!DOCTYPE html>");
  });

  it("does not treat HX-Request: false as an HTMX request (renders the full page)", async () => {
    const app = makeApp();
    const res = await app.request("/logs", { headers: { "HX-Request": "false" } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("uses a custom basePath for the load-more action in the fragment", async () => {
    const channel: LogChannel = {
      write: () => {},
      read: () =>
        Promise.resolve({ rows: [{ key: "k", level: "info", prefix: "svc", message: "m", timestamp: "t" }], complete: false, cursor: "abc" }),
    };
    const app = makeApp({ basePath: "/dashboard/logs", channel: () => channel });
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    const body = await res.text();
    expect(body).toContain("/dashboard/logs?cursor=abc");
  });
});

describe("loadLogViewer — detail view", () => {
  function makeDetailApp(channel: LogChannel) {
    return makeApp({ channel: () => channel });
  }

  it("returns the detail fragment when ?detail= is present", async () => {
    const channel: LogChannel = {
      write: () => {},
      readEntry: () =>
        Promise.resolve({
          level: "error",
          prefix: "client",
          message: "uncaught",
          timestamp: "2026-05-31T10:00:00.000Z",
          data: { stack: "Error: boom\n  at main.ts:1" },
        }),
    };
    const app = makeDetailApp(channel);

    const res = await app.request(`/logs?detail=${encodeURIComponent("logs||2026-05-31T10:00:00.000Z||aaa")}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("<td")).toBe(true);
    expect(body).not.toContain("<!DOCTYPE html>");
    expect(body).toContain("uncaught");
    expect(body).toContain("main.ts:1");
  });

  it("passes the requested key through to readEntry", async () => {
    let requestedKey: string | undefined;
    const channel: LogChannel = {
      write: () => {},
      readEntry: (key) => {
        requestedKey = key;
        return Promise.resolve(null);
      },
    };
    const app = makeDetailApp(channel);

    await app.request(`/logs?detail=${encodeURIComponent("logs||2026-05-31T10:00:00.000Z||bbb")}`);

    expect(requestedKey).toBe("logs||2026-05-31T10:00:00.000Z||bbb");
  });

  it("renders not-found for a missing entry", async () => {
    const channel: LogChannel = { write: () => {}, readEntry: () => Promise.resolve(null) };
    const app = makeDetailApp(channel);

    const res = await app.request("/logs?detail=missing");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Log entry not found or expired.");
  });

  it("renders not-found when the channel has no readEntry", async () => {
    const app = makeDetailApp({ write: () => {} });

    const res = await app.request("/logs?detail=anything");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Log entry not found or expired.");
  });
});
