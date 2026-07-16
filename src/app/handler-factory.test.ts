import { describe, expect, it } from "bun:test";
import type { AppContext } from "../context/types";
import { Forge } from "./forge-app";
import { createHandlerFactory } from "./handler-factory";
import { mapHandler } from "./route-test-helper";

interface TestEnv {
  SITE_NAME: string;
  [key: string]: unknown;
}

const { definePage, defineAction } = createHandlerFactory<TestEnv>();

describe("createHandlerFactory — definePage", () => {
  it("produces a working page handler with Bindings pre-bound", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage({
      loader: (c) => ({ greeting: `Hello from ${c.env.SITE_NAME}` }),
      view: (_c, _config, state) => new Response(state.data.greeting),
    });
    mapHandler(app, "GET", "/", page);
    const res = await app.request("/", {}, { SITE_NAME: "forge" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello from forge");
  });

  it("still applies page-level cache directives", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage({ cache: "no-store", view: () => new Response("ok") });
    mapHandler(app, "GET", "/", page);
    const res = await app.request("/", {}, { SITE_NAME: "x" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("createHandlerFactory — defineAction", () => {
  it("produces a working parse → validate → handle pipeline with Bindings pre-bound", async () => {
    const app = new Forge<TestEnv>();
    const action = defineAction({
      parse: (formData) => ({ name: String(formData.get("name") ?? "") }),
      validate: (data) => (data.name.length > 0 ? { ok: true, data } : { ok: false, error: ["name is required"] }),
      handle: async (data, c) => new Response(`${data.name}@${c.env.SITE_NAME}`),
    });
    mapHandler(app, "POST", "/submit", action);
    const res = await app.request(
      "/submit",
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Jane" }) },
      { SITE_NAME: "forge" },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Jane@forge");
  });

  it("keeps the automatic validation-error fragment for invalid input", async () => {
    const app = new Forge<TestEnv>();
    const action = defineAction({
      parse: (formData) => ({ name: String(formData.get("name") ?? "") }),
      validate: (data) => (data.name.length > 0 ? { ok: true, data } : { ok: false, error: ["name is required"] }),
      handle: async (data) => new Response(data.name),
    });
    mapHandler(app, "POST", "/submit", action);
    const res = await app.request(
      "/submit",
      // name is present but empty — fails validation. (A fully empty URLSearchParams body hits a
      // Bun stream quirk in the body-size counter unrelated to this factory.)
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "" }) },
      { SITE_NAME: "forge" },
    );
    const html = await res.text();
    expect(html).toBe(
      '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5"><li>name is required</li></ul></div>',
    );
  });
});

describe("createHandlerFactory — type binding", () => {
  it("pre-binds Bindings/ConfigData while leaving per-call generics free", () => {
    const factory = createHandlerFactory<TestEnv, { debug: boolean }>();

    // Compile-level contract: loader's context is typed to TestEnv, config to { debug: boolean },
    // and LoaderData is inferred from the loader's return type into the view's state.
    const handler = factory.definePage({
      loader: (c: AppContext<TestEnv>, config: { debug: boolean }) => ({ site: c.env.SITE_NAME, debug: config.debug }),
      view: (_c, _config, state) => new Response(`${state.data.site}:${state.data.debug}`),
    });

    expect(typeof handler).toBe("function");
  });
});
