import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadWranglerConfig, writeWranglerConfig } from "../../config/parse";
import type { D1DatabaseConfig, WranglerConfig } from "../../types";
import { syncBindings } from "../engine";
import { createD1Handler } from "./d1";
import { createD1EnvironmentPass } from "./d1-env";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };
const ACCOUNT = [
  { uuid: "db-prod", name: "app-db" },
  { uuid: "db-staging", name: "app-db-staging" },
  { uuid: "db-preview", name: "app-db-preview" },
];

function account(databases: Record<string, unknown>[] = ACCOUNT): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify({ success: true, errors: [], messages: [], result: databases }));
}

function ctx(dryRun: boolean, fetch = account()): HandlerContext {
  return { auth: AUTH, scriptName: "app", prefix: "", dryRun, rotate: new Set<string>(), fetch };
}

const TOP = { binding: "DB", database_name: "app-db", database_id: "db-prod" };

function config(env: Record<string, unknown>, top: D1DatabaseConfig[] = [TOP]): WranglerConfig {
  return { name: "app", d1_databases: top, env } as WranglerConfig;
}

const reconcileD1Environments = createD1EnvironmentPass();

const brief = (rows: { binding: string; action: string; detail?: string | undefined }[]) =>
  rows.map((row) => [row.binding, row.action, row.detail]);

describe("reconcileD1Environments()", () => {
  it("reports an environment that restates no D1 entry, since wrangler inherits none, and writes nothing", async () => {
    const pass = await reconcileD1Environments(config({ dev: { vars: {} } }), ctx(false));
    expect(brief(pass.results)).toEqual([
      [
        "env.dev",
        "drift",
        "declares no d1_databases, and wrangler gives an environment none it does not restate — `wrangler --env dev` runs without DB",
      ],
    ]);
    expect(pass.config.env).toEqual({ dev: { vars: {} } });
  });

  it("reports a binding the top level declares and an environment leaves out", async () => {
    const top = [TOP, { binding: "LOGS", database_name: "app-db", database_id: "db-prod" }];
    const pass = await reconcileD1Environments(
      config({ staging: { d1_databases: [{ ...TOP, database_id: "db-staging", database_name: "app-db-staging" }] } }, top),
      ctx(true),
    );
    expect(brief(pass.results)).toEqual([["env.staging", "drift", "has no LOGS entry, which the top level declares"]]);
  });

  it("resolves a missing database_id by the entry's own database_name: drift on a dry run, written back on --commit", async () => {
    const env = { staging: { d1_databases: [{ binding: "DB", database_name: "app-db-staging" }] } };
    const dry = await reconcileD1Environments(config(env), ctx(true));
    expect(brief(dry.results)).toEqual([
      ["env.staging.DB", "drift", "database_id is unset; app-db-staging is db-staging — --commit writes it back"],
    ]);
    expect((dry.config.env as typeof env).staging.d1_databases[0]).toEqual({ binding: "DB", database_name: "app-db-staging" });

    const committed = await reconcileD1Environments(config(env), ctx(false));
    expect(committed.results.map((row) => row.action)).toEqual(["updated"]);
    expect((committed.config.env as typeof env).staging.d1_databases[0]).toEqual({
      binding: "DB",
      database_name: "app-db-staging",
      database_id: "db-staging",
    });
  });

  it("reports an id that resolves to nothing and a name that matches nothing, without guessing", async () => {
    const env = { staging: { d1_databases: [{ binding: "DB", database_name: "nowhere", database_id: "db-gone" }] } };
    const pass = await reconcileD1Environments(config(env), ctx(false));
    expect(brief(pass.results)).toEqual([
      ["env.staging.DB", "unavailable", "database_id db-gone names no database on this account, and no database answers to its database_name"],
    ]);
    expect(pass.config.env).toEqual(env);
  });

  it("writes back an unresolved preview_database_id from <name>-preview, at the top level and in an environment", async () => {
    const top = [{ ...TOP, preview_database_id: "db-stale" }];
    const env = { dev: { d1_databases: [{ ...TOP, preview_database_id: "db-stale" }] } };
    const pass = await reconcileD1Environments(config(env, top), ctx(false));
    expect(brief(pass.results)).toEqual([
      ["DB", "updated", "preview_database_id db-stale names no database on this account; app-db-preview is db-preview"],
      ["env.dev.DB", "updated", "preview_database_id db-stale names no database on this account; app-db-preview is db-preview"],
    ]);
    expect(pass.config.d1_databases?.[0]?.preview_database_id).toBe("db-preview");
    expect((pass.config.env as typeof env).dev.d1_databases[0]?.preview_database_id).toBe("db-preview");
  });

  it("reports an unresolved preview_database_id with no <name>-preview to take", async () => {
    const top = [{ ...TOP, preview_database_id: "db-stale" }];
    const pass = await reconcileD1Environments(config({ dev: { d1_databases: [TOP] } }, top), ctx(true, account(ACCOUNT.slice(0, 2))));
    expect(brief(pass.results)).toEqual([["DB", "drift", "preview_database_id db-stale names no database on this account"]]);
  });

  it("does nothing, and asks nothing, for a config with no environment", async () => {
    let asked = false;
    const fetch: typeof globalThis.fetch = async () => {
      asked = true;
      return new Response("{}");
    };
    const pass = await reconcileD1Environments({ name: "app", d1_databases: [TOP] } as WranglerConfig, ctx(false, fetch));
    expect([pass.results, asked]).toEqual([[], false]);
  });
});

describe("cf sync over a config whose environments restate D1", () => {
  it("runs the environment pass after the top-level reconcile, and still runs it when only an environment declares D1", async () => {
    const env = { staging: { d1_databases: [{ binding: "DB", database_name: "app-db-staging" }] } };
    const output = await syncBindings(config(env, []), { auth: AUTH, dryRun: false }, [createD1Handler()], account());
    expect(brief(output.results)).toEqual([["env.staging.DB", "updated", "database_id is unset; app-db-staging is db-staging"]]);
    expect([
      output.configChanged,
      (output.updatedConfig.env as { staging: { d1_databases: D1DatabaseConfig[] } }).staging.d1_databases[0]?.database_id,
    ]).toEqual([true, "db-staging"]);
  });
});

describe("reconcileD1Environments() — a mismatched entry", () => {
  it("reports an entry whose database_id and database_name name two different databases, writing nothing", async () => {
    const env = { staging: { d1_databases: [{ binding: "DB", database_name: "app-db-staging", database_id: "db-prod" }] } };
    const pass = await reconcileD1Environments(config(env), ctx(false));
    expect(brief(pass.results)).toEqual([
      [
        "env.staging.DB",
        "drift",
        "database_id db-prod is app-db, but database_name says app-db-staging — one of them is wrong, and only you know which",
      ],
    ]);
    expect(pass.config.env).toEqual(env);
  });

  it("names a preview with no database_name by the prefixed rule", async () => {
    const env = { dev: { d1_databases: [{ binding: "DB", database_id: "db-prod", preview_database_id: "db-stale" }] } };
    const pass = await reconcileD1Environments(config(env), {
      ...ctx(false, account([...ACCOUNT, { uuid: "db-app-preview", name: "APP_DB-preview" }])),
      prefix: "APP",
    });
    expect((pass.config.env as typeof env).dev.d1_databases[0]?.preview_database_id).toBe("db-app-preview");
  });
});

describe("reconcileD1Environments() — a malformed env block", () => {
  for (const [env, path] of [
    [{ dev: { d1_databases: { binding: "DB" } } }, "env.dev.d1_databases must be an array of entries"],
    [{ dev: { d1_databases: [{ database_name: "app-db" }] } }, "env.dev.d1_databases[0] must be an entry with a string binding"],
    [{ dev: "DB" }, "env.dev must be an object"],
  ] as const) {
    it(`refuses by path: ${path}`, async () => {
      await expect(reconcileD1Environments(config(env as never), ctx(true))).rejects.toThrow(`wrangler config: ${path}`);
    });
  }
});

describe("cf sync --commit over a JSONC wrangler config", () => {
  it("writes the resolved id into env.staging and keeps every comment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-cf-env-"));
    try {
      const path = join(dir, "wrangler.jsonc");
      writeFileSync(
        path,
        `{
  // the app
  "name": "app",
  "d1_databases": [{ "binding": "DB", "database_name": "app-db", "database_id": "db-prod" }],
  "env": {
    // staging keeps its own database
    "staging": { "d1_databases": [{ "binding": "DB", "database_name": "app-db-staging" }] }
  }
}
`,
      );
      const loaded = loadWranglerConfig(path);
      const output = await syncBindings(loaded.config, { auth: AUTH, dryRun: false }, [createD1Handler()], account());
      const written = writeWranglerConfig(loaded, output.updatedConfig);

      expect(written.ok).toBe(true);
      const text = readFileSync(path, "utf-8");
      expect(text).toContain("// the app");
      expect(text).toContain("// staging keeps its own database");
      expect(loadWranglerConfig(path).config.env).toEqual({
        staging: { d1_databases: [{ binding: "DB", database_name: "app-db-staging", database_id: "db-staging" }] },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createD1Handler() with a declared preview and a stale id", () => {
  it("reports the stale preview once, from the placement pass, not again from the environment pass", async () => {
    const top = [{ ...TOP, preview_database_id: "db-stale" }];
    const output = await syncBindings(
      config({ dev: { d1_databases: [TOP] } }, top),
      { auth: AUTH, dryRun: true },
      [createD1Handler({ DB: { preview: true } })],
      account(),
    );
    expect(output.results.filter((row) => (row.detail ?? "").includes("db-stale"))).toHaveLength(1);
  });
});
