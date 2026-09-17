import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { D1DatabaseConfig, WranglerConfig } from "../cf/types";
import { resolveDbConfig, selectD1Entry, sharedD1Databases, toD1Entry } from "./config";
import { minimalWranglerConfig } from "./db.fixture";

const roots: string[] = [];

/** A temp application root holding a `wrangler.jsonc` built from `over`. */
function appRoot(over: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-config-"));
  roots.push(root);
  const { path, text } = minimalWranglerConfig(root, over);
  writeFileSync(path, text, "utf-8");
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CONFIG_PATH = "/app/wrangler.jsonc";

const DB: D1DatabaseConfig = { binding: "DB", database_name: "app-db", database_id: "id-1" };
const REPORTS: D1DatabaseConfig = { binding: "REPORTS", database_name: "reports-db", database_id: "id-2" };

describe("selectD1Entry()", () => {
  it("takes the only entry when the caller named none", () => {
    expect(selectD1Entry([DB], null, CONFIG_PATH)).toEqual(DB);
  });

  it("refuses a config with no d1_databases", () => {
    expect(() => selectD1Entry([], null, CONFIG_PATH)).toThrow("/app/wrangler.jsonc declares no d1_databases — nothing for forge db to manage");
  });

  it("refuses an ambiguous choice rather than taking the first, listing what --db accepts", () => {
    expect(() => selectD1Entry([DB, REPORTS], null, CONFIG_PATH)).toThrow(
      "/app/wrangler.jsonc declares 2 d1_databases — name one with --db <binding|database_name>: DB (app-db), REPORTS (reports-db)",
    );
  });

  it("lists a bare binding without parentheses when the entry has no database_name", () => {
    expect(() => selectD1Entry([{ binding: "DB" }, REPORTS], null, CONFIG_PATH)).toThrow(
      "/app/wrangler.jsonc declares 2 d1_databases — name one with --db <binding|database_name>: DB, REPORTS (reports-db)",
    );
  });

  it("matches --db against the binding and against the database_name", () => {
    expect(selectD1Entry([DB, REPORTS], "REPORTS", CONFIG_PATH)).toEqual(REPORTS);
    expect(selectD1Entry([DB, REPORTS], "reports-db", CONFIG_PATH)).toEqual(REPORTS);
  });

  it("refuses a --db that matches neither field", () => {
    expect(() => selectD1Entry([DB, REPORTS], "ledger", CONFIG_PATH)).toThrow(
      "--db ledger matches no d1_databases binding or database_name in /app/wrangler.jsonc",
    );
  });
});

describe("sharedD1Databases()", () => {
  it("gathers the top level and every environment, since one local state directory holds them all", () => {
    const config = {
      name: "app",
      d1_databases: [DB],
      env: { staging: { d1_databases: [{ binding: "DB", database_name: "app-db-staging" }] }, prod: { vars: { TIER: "prod" } } },
    } as unknown as WranglerConfig;
    expect(sharedD1Databases(config)).toEqual(["app-db", "app-db-staging"]);
  });

  it("reads an env-only declaration, and names a bare binding after itself", () => {
    const config = { name: "app", env: { staging: { d1_databases: [{ binding: "DB" }, REPORTS] } } } as unknown as WranglerConfig;
    expect(sharedD1Databases(config)).toEqual(["DB", "reports-db"]);
  });

  it("counts the same database_name once however many environments declare it", () => {
    const config = {
      name: "app",
      d1_databases: [DB],
      env: { staging: { d1_databases: [{ ...DB, database_id: "id-staging" }] }, prod: { d1_databases: [DB] } },
    } as unknown as WranglerConfig;
    expect(sharedD1Databases(config)).toEqual(["app-db"]);
  });

  it("is empty for a config declaring no database anywhere", () => {
    expect(sharedD1Databases({ name: "app" } as unknown as WranglerConfig)).toEqual([]);
  });
});

describe("toD1Entry()", () => {
  it("names the database after the binding and nulls both ids when the config gives none", () => {
    expect(toD1Entry({ binding: "DB" }, CONFIG_PATH)).toEqual({ binding: "DB", databaseName: "DB", databaseId: null, previewDatabaseId: null });
  });

  it("refuses a database_name that is not one, naming the config and the binding", () => {
    const refused = ["--remote", "a b", "", "-leading", "x".repeat(65), "app/db", "app;drop"];
    for (const name of refused) {
      expect(() => toD1Entry({ binding: "DB", database_name: name }, CONFIG_PATH)).toThrow(
        `/app/wrangler.jsonc declares database_name ${JSON.stringify(name)} on binding DB, which is not a database name`,
      );
    }
  });

  it("refuses a field of the wrong type by name, at the top level and inside an env block", () => {
    const root = appRoot({ d1_databases: [{ binding: "DB", database_name: 5 }] });
    expect(() => resolveDbConfig({ root, config: "wrangler.jsonc", target: "local" })).toThrow(
      `${join(root, "wrangler.jsonc")}: d1_databases[0].database_name: Invalid type: Expected string but received 5`,
    );

    const scoped = appRoot({ env: { staging: { d1_databases: [{ binding: "DB", database_name: "app-db", database_id: 7 }] } } });
    expect(() => resolveDbConfig({ root: scoped, config: "wrangler.jsonc", env: "staging", target: "local" })).toThrow(
      `${join(scoped, "wrangler.jsonc")}: env.staging.d1_databases[0].database_id: Invalid type: Expected string but received 7`,
    );
  });

  it("refuses a binding that is not a database name either, since the binding is the fallback", () => {
    expect(() => toD1Entry({ binding: "-DB" }, CONFIG_PATH)).toThrow('declares database_name "-DB" on binding -DB');
  });

  it("accepts the names a D1 database may carry", () => {
    for (const name of ["app-db", "app_db", "APPDB", "0db", "x".repeat(64)]) {
      expect(toD1Entry({ binding: "DB", database_name: name }, CONFIG_PATH).databaseName).toBe(name);
    }
  });

  it("carries both database ids through", () => {
    expect(toD1Entry({ binding: "DB", database_name: "app-db", database_id: "id-1", preview_database_id: "id-2" }, CONFIG_PATH)).toEqual({
      binding: "DB",
      databaseName: "app-db",
      databaseId: "id-1",
      previewDatabaseId: "id-2",
    });
  });
});

describe("resolveDbConfig()", () => {
  it("resolves the root, the config path, the entry and the target", () => {
    const root = appRoot();
    const resolved = resolveDbConfig({ root, config: "wrangler.jsonc", target: "local" });
    expect({ root: resolved.root, configPath: resolved.configPath, env: resolved.env, target: resolved.target, entry: resolved.entry }).toEqual({
      root,
      configPath: join(root, "wrangler.jsonc"),
      env: null,
      target: { place: "local", database: null },
      entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    });
  });

  it("refuses a target spec that is not one, naming the grammar", () => {
    expect(() => resolveDbConfig({ root: appRoot(), config: "wrangler.jsonc", target: "prod" })).toThrow(
      "--target prod is not a target — use place[:database], place being local, standby, remote, preview",
    );
  });

  it("refuses an --env that names no env block", () => {
    expect(() => resolveDbConfig({ root: appRoot(), config: "wrangler.jsonc", env: "staging", target: "local" })).toThrow(
      "--env staging names no `env.staging` block in the wrangler config",
    );
  });

  it("refuses an --env naming a prototype member rather than falling through to the top-level entry", () => {
    const root = appRoot({ env: { staging: { vars: { TIER: "staging" } } } });
    for (const name of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      expect(() => resolveDbConfig({ root, config: "wrangler.jsonc", env: name, target: "remote" })).toThrow(
        `--env ${name} names no \`env.${name}\` block in the wrangler config`,
      );
    }
  });

  it("reads the env block's own d1_databases when it declares them", () => {
    const root = appRoot({ env: { staging: { d1_databases: [{ binding: "DB", database_name: "app-db-staging", database_id: "id-staging" }] } } });
    const resolved = resolveDbConfig({ root, config: "wrangler.jsonc", env: "staging", target: "local" });
    expect([resolved.env, resolved.entry.databaseName, resolved.entry.databaseId]).toEqual(["staging", "app-db-staging", "id-staging"]);
  });

  it("falls back to the top-level d1_databases for an env block that declares none", () => {
    const root = appRoot({ env: { staging: { vars: { TIER: "staging" } } } });
    expect(resolveDbConfig({ root, config: "wrangler.jsonc", env: "staging", target: "local" }).entry.databaseName).toBe("app-db");
  });

  it("refuses a remote target while the id is a placeholder, and allows it on a D1 id", () => {
    const placeholder = appRoot({ d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "app-db-local" }] });
    expect(() => resolveDbConfig({ root: placeholder, config: "wrangler.jsonc", target: "remote" })).toThrow(
      "remote is refused while wrangler.jsonc's database_id is the placeholder app-db-local — run `forge cf sync --commit` to provision it, then retry",
    );
    expect(resolveDbConfig({ root: appRoot(), config: "wrangler.jsonc", target: "remote" }).target).toEqual({ place: "remote", database: null });
  });

  it("judges a preview target by preview_database_id, which the local entry does not carry", () => {
    expect(() => resolveDbConfig({ root: appRoot(), config: "wrangler.jsonc", target: "preview" })).toThrow(
      "preview is refused while wrangler.jsonc has no preview_database_id — run `forge cf sync --commit` to provision it, then retry",
    );
  });

  it("takes the database named in the target when the config declares more than one", () => {
    const root = appRoot({ d1_databases: [{ binding: "DB", database_name: "app-db" }, REPORTS] });
    expect(resolveDbConfig({ root, config: "wrangler.jsonc", target: "local:reports-db" }).entry.binding).toBe("REPORTS");
    expect(() => resolveDbConfig({ root, config: "wrangler.jsonc", target: "local" })).toThrow(
      "declares 2 d1_databases — name one with --db <binding|database_name>: DB (app-db), REPORTS (reports-db)",
    );
  });

  it("lets --db override the database the target names", () => {
    const root = appRoot({ d1_databases: [DB, REPORTS] });
    expect(resolveDbConfig({ root, config: "wrangler.jsonc", db: "DB", target: "local:reports-db" }).entry.binding).toBe("DB");
  });
});

describe("resolveDbConfig() — standby", () => {
  it("reads standby:<name> as the standby database's name, not as a config entry", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-db-config-"));
    const { path, text } = minimalWranglerConfig(root);
    writeFileSync(path, text);
    const resolved = resolveDbConfig({ root, config: "wrangler.jsonc", target: "standby:ledger-copy" });
    expect([resolved.entry.binding, resolved.target]).toEqual(["DB", { place: "standby", database: "ledger-copy" }]);
  });
});
