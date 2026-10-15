import { describe, expect, it } from "bun:test";

import { derivedConfig, harnessInput, withSiteOrigin } from "./harness";

const RAW = {
  name: "app",
  main: "src/worker.ts",
  compatibility_date: "2026-01-01",
  vars: { MODE: "config" },
  secrets: { required: ["SITE_ORIGIN", "KEY"] },
  env: { staging: { vars: { MODE: "staging" } } },
};

describe("derivedConfig", () => {
  it("keeps the config whole, main included, when no entry replaces it", () => {
    expect(derivedConfig(RAW)).toEqual(RAW);
  });

  it("replaces main with the absolute entry and keeps the declared secrets, which a path input's secrets satisfy", () => {
    expect(derivedConfig(RAW, "/app/tests/entry.ts")).toEqual({ ...RAW, main: "/app/tests/entry.ts" });
  });

  it("drops local_protocol and keeps every other dev key", () => {
    expect(derivedConfig({ ...RAW, dev: { local_protocol: "https", port: 8787 } }).dev).toEqual({ port: 8787 });
  });

  it("drops a dev block that held only local_protocol", () => {
    expect("dev" in derivedConfig({ ...RAW, dev: { local_protocol: "https" } })).toBe(false);
  });
});

describe("harnessInput", () => {
  it("serves the derived config by path alone when the caller binds nothing", () => {
    expect(harnessInput({ config: "/app/wrangler.jsonc" }, "/app/.derived.json")).toEqual({ workers: [{ configPath: "/app/.derived.json" }] });
  });

  it("binds vars and secrets on the path input, where they override .dev.vars, entry or not", () => {
    const options = { config: "/app/wrangler.jsonc", vars: { MODE: "test" }, secrets: { KEY: "k" } };

    expect([harnessInput(options, "/app/.derived.json"), harnessInput({ ...options, entry: "/app/entry.ts" }, "/app/.derived.json")]).toEqual([
      { workers: [{ configPath: "/app/.derived.json", vars: { MODE: "test" }, secrets: { KEY: "k" } }] },
      { workers: [{ configPath: "/app/.derived.json", vars: { MODE: "test" }, secrets: { KEY: "k" } }] },
    ]);
  });
});

describe("withSiteOrigin", () => {
  it("sets SITE_ORIGIN over a caller's var of the same name", () => {
    const input = harnessInput({ config: "/app/wrangler.jsonc", vars: { SITE_ORIGIN: "https://stale.test", MODE: "test" } }, "/app/.derived.json");

    expect(withSiteOrigin(input, "http://127.0.0.1:8787")).toEqual({
      workers: [{ configPath: "/app/.derived.json", vars: { SITE_ORIGIN: "http://127.0.0.1:8787", MODE: "test" } }],
    });
  });

  it("leaves every Worker after the primary alone", () => {
    const second = { configPath: "/other/wrangler.jsonc" };
    const input = withSiteOrigin({ workers: [{ configPath: "/app/wrangler.jsonc" }, second] }, "http://127.0.0.1:1");

    expect(input.workers[1]).toBe(second);
  });
});
