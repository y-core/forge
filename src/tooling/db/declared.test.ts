import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../cf/types";
import { PLAIN } from "../term/color";
import { fakeDbIo } from "./db.fixture";
import { declaredMigrations, declaredPath, declaredSchemas, declaredSeeds, snapshotPath } from "./declared";
import { appHome } from "./home";
import type { DbConfig, DbHostConfig, DbRunContext } from "./types";

function dbConfig(): DbConfig {
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: {
      name: "app",
      compatibility_date: "2026-01-01",
      d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
    } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place: "local", database: null },
  };
}

function context(host: DbHostConfig = {}): DbRunContext {
  const config = dbConfig();
  return { config, home: appHome(config), io: fakeDbIo(), host, json: false, yes: true, style: PLAIN, print: () => {} };
}

describe("declaredPath()", () => {
  it("resolves against the root and keeps the text it was written as", () => {
    expect(declaredPath("/app", "config/schema.sql")).toEqual({ path: "/app/config/schema.sql", declared: "config/schema.sql" });
  });

  it("leaves an absolute declaration alone", () => {
    expect(declaredPath("/app", "/elsewhere/ddl/schema.sql").path).toBe("/elsewhere/ddl/schema.sql");
  });
});

describe("declaredSchemas()", () => {
  it("is every position the host config names, in that order", () => {
    const host = { schemas: ["node_modules/@acme/auth/schema.sql", "config/schema.sql"] };
    expect(declaredSchemas(context(host)).map((source) => source.declared)).toEqual(["node_modules/@acme/auth/schema.sql", "config/schema.sql"]);
  });

  it("is empty when the host config names none, because nothing is read that is not declared", () => {
    expect(declaredSchemas(context())).toEqual([]);
  });
});

describe("declaredSeeds()", () => {
  it("is every seeds directory the host config names, resolved against the root", () => {
    expect(declaredSeeds(context({ seeds: ["config/seeds"] }))).toEqual([{ path: "/app/config/seeds", declared: "config/seeds" }]);
    expect(declaredSeeds(context())).toEqual([]);
  });
});

describe("snapshotPath()", () => {
  it("defaults to schema.snapshot.json under the root", () => {
    expect(snapshotPath(context())).toBe("/app/schema.snapshot.json");
  });

  it("takes the host config's own position when it names one", () => {
    expect(snapshotPath(context({ snapshot: "src/auth/schema.snapshot.json" }))).toBe("/app/src/auth/schema.snapshot.json");
  });
});

describe("declaredMigrations()", () => {
  it("defaults to migrations under the root when the host config names none", () => {
    expect(declaredMigrations(context())).toEqual({ path: "/app/migrations", declared: "migrations" });
  });

  it("resolves a relative host value against the root", () => {
    expect(declaredMigrations(context({ migrations: "db/migrations" }))).toEqual({ path: "/app/db/migrations", declared: "db/migrations" });
  });

  it("keeps an absolute host value unchanged", () => {
    expect(declaredMigrations(context({ migrations: "/elsewhere/migrations" }))).toEqual({
      path: "/elsewhere/migrations",
      declared: "/elsewhere/migrations",
    });
  });
});
