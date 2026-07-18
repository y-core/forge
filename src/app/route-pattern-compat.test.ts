import { describe, expect, it } from "bun:test";
import { createApp } from "./app";
import { mapHandler } from "./route-test-helper";

/**
 * Regression guard for the `@remix-run/route-pattern` 0.23.0 alignment.
 *
 * `createApp` wires a `createMultiMatcher()` from `@remix-run/route-pattern`, and `mapHandler`
 * registers through `app.map(routes, controller)` — the exact `map → mapController → registerRoute
 * → matcher.add → generateVariants` so future route-pattern shape change is caught by forge's own suite.
 */
describe("route-pattern registration compatibility", () => {
  it("registers path-only routes through the matcher and dispatches them", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/api/health", () => new Response("ok"));
    mapHandler(app, "GET", "/", () => new Response("home"));

    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const home = await app.request("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toBe("home");
  });

  it("registers a hostname-scoped route through the matcher and matches on host", async () => {
    const app = createApp();
    mapHandler(app, "GET", "https://api.example.com/data", () => new Response("scoped"));

    const matched = await app.request("https://api.example.com/data");
    expect(matched.status).toBe(200);
    expect(await matched.text()).toBe("scoped");
  });

  it("registers path-only and hostname routes side by side without throwing", () => {
    const app = createApp();
    expect(() => {
      mapHandler(app, "GET", "/", () => new Response("home"));
      mapHandler(app, "ANY", "*", () => new Response("catch-all"));
      mapHandler(app, "GET", "https://api.example.com/data", () => new Response("scoped"));
    }).not.toThrow();
  });
});
