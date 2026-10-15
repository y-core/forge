import { describe, expect, it } from "bun:test";

import { harnessInput, withSiteOrigin } from "./harness";

const RAW = {
  name: "app",
  main: "src/worker.ts",
  compatibility_date: "2026-01-01",
  vars: { MODE: "config", KEPT: "yes" },
  d1_databases: [{ binding: "DB", database_name: "app", database_id: "app-local" }],
  env: { staging: { vars: { MODE: "staging" } } },
};

describe("harnessInput", () => {
  it("serves the config file itself when no entry replaces its main", () => {
    expect(harnessInput({ config: "/app/wrangler.jsonc" }, null)).toEqual({ workers: [{ configPath: "/app/wrangler.jsonc" }] });
  });

  it("hands vars and secrets to the config file's Worker as the harness's own overrides", () => {
    expect(harnessInput({ config: "/app/wrangler.jsonc", vars: { MODE: "test" }, secrets: { KEY: "k" } }, null)).toEqual({
      workers: [{ configPath: "/app/wrangler.jsonc", vars: { MODE: "test" }, secrets: { KEY: "k" } }],
    });
  });

  it("serves the raw config inline with main replaced by the absolute entry, resolving from the config's directory", () => {
    const input = harnessInput({ config: "/app/wrangler.jsonc", entry: "/app/tests/entry.ts" }, RAW);

    expect(input).toEqual({
      root: "/app",
      workers: [
        {
          config: {
            name: "app",
            main: "/app/tests/entry.ts",
            compatibility_date: "2026-01-01",
            vars: { MODE: "config", KEPT: "yes" },
            d1_databases: [{ binding: "DB", database_name: "app", database_id: "app-local" }],
          },
        },
      ],
    });
  });

  it("merges vars over the config's own and secrets over both, since an inline config has no secrets of its own", () => {
    const input = harnessInput(
      { config: "/app/wrangler.jsonc", entry: "/app/entry.ts", vars: { MODE: "test", ONLY: "var" }, secrets: { ONLY: "secret" } },
      RAW,
    );
    const [worker] = input.workers;

    expect(worker !== undefined && "config" in worker ? worker.config.vars : null).toEqual({ MODE: "test", KEPT: "yes", ONLY: "secret" });
  });
});

describe("withSiteOrigin", () => {
  it("sets SITE_ORIGIN over a caller's var of the same name on a config-file Worker", () => {
    const input = harnessInput({ config: "/app/wrangler.jsonc", vars: { SITE_ORIGIN: "https://stale.test", MODE: "test" } }, null);

    expect(withSiteOrigin(input, "http://127.0.0.1:8787")).toEqual({
      workers: [{ configPath: "/app/wrangler.jsonc", vars: { SITE_ORIGIN: "http://127.0.0.1:8787", MODE: "test" } }],
    });
  });

  it("sets SITE_ORIGIN inside an inline config, keeping its other vars", () => {
    const input = withSiteOrigin(harnessInput({ config: "/app/wrangler.jsonc", entry: "/app/entry.ts" }, RAW), "http://localhost:9000");
    const [worker] = input.workers;

    expect(worker !== undefined && "config" in worker ? worker.config.vars : null).toEqual({
      MODE: "config",
      KEPT: "yes",
      SITE_ORIGIN: "http://localhost:9000",
    });
  });

  it("leaves every Worker after the primary alone", () => {
    const second = { configPath: "/other/wrangler.jsonc" };
    const input = withSiteOrigin({ workers: [{ configPath: "/app/wrangler.jsonc" }, second] }, "http://127.0.0.1:1");

    expect(input.workers[1]).toBe(second);
  });
});
