import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { WranglerConfig } from "../cf/types";
import { checkConfigFiles } from "../gate/checks/config-files";
import { PLAIN } from "../term/color";
import { fakeDbIo } from "./db.fixture";
import {
  DEFAULT_DB_CONFIG,
  declaredMigrations,
  declaredPath,
  declaredSchemas,
  declaredSeeds,
  defineDbConfig,
  forgeSchema,
  migrationsDirRefusal,
  NO_SCHEMAS,
  snapshotPath,
} from "./declared";
import { appHome } from "./home";
import type { DbConfig, DbHostConfig, DbRunContext } from "./types";

function dbConfig(over: Partial<DbConfig> = {}): DbConfig {
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
    ...over,
  };
}

function context(host: DbHostConfig = {}, over: Partial<DbConfig> = {}): DbRunContext {
  const config = dbConfig(over);
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
  it("defaults to config/db/schema.snapshot.json under the root", () => {
    expect(snapshotPath(context())).toBe("/app/config/db/schema.snapshot.json");
  });

  it("takes the host config's own position when it names one", () => {
    expect(snapshotPath(context({ snapshot: "src/auth/schema.snapshot.json" }))).toBe("/app/src/auth/schema.snapshot.json");
  });
});

describe("declaredMigrations()", () => {
  it("defaults to config/db/migrations under the root when the host config names none", () => {
    expect(declaredMigrations(context())).toEqual({ path: "/app/config/db/migrations", declared: "config/db/migrations" });
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

describe("forgeSchema()", () => {
  const FORGE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

  it("names forge's schema by package specifier, so the declared text carries no node_modules segment", () => {
    expect(forgeSchema("auth")).toBe("@y-core/forge/auth/schema.sql");
  });

  it("resolves through the package's exports from the app root, keeping the specifier as the declared text", () => {
    expect(declaredPath(FORGE_ROOT, forgeSchema("auth"))).toEqual({
      path: fileURLToPath(new URL("../../auth/schema.sql", import.meta.url)),
      declared: "@y-core/forge/auth/schema.sql",
    });
  });

  it("keeps the specifier as the schema's key in what compose records", () => {
    const run = context({ schemas: [forgeSchema("auth"), "config/db/schema.sql"] });
    const keys = declaredSchemas({ ...run, config: { ...run.config, root: FORGE_ROOT } }).map((source) => source.declared);
    expect([keys, keys.some((key) => key.includes("node_modules"))]).toEqual([["@y-core/forge/auth/schema.sql", "config/db/schema.sql"], false]);
  });
});

describe("declaredPath() — a package specifier", () => {
  it("resolves a package the app installed, through its exports, from the app root rather than from forge", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-declared-"));
    try {
      const pkg = join(root, "node_modules", "@acme", "auth");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@acme/auth", exports: { "./schema.sql": "./ddl/schema.sql" } }));
      mkdirSync(join(pkg, "ddl"));
      writeFileSync(join(pkg, "ddl", "schema.sql"), "CREATE TABLE a (id INTEGER);");
      writeFileSync(join(root, "package.json"), "{}");
      expect(realpathSync(declaredPath(root, "@acme/auth/schema.sql").path)).toBe(realpathSync(join(pkg, "ddl", "schema.sql")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a specifier nothing under the root exports, naming config/db.config.ts and the entry", () => {
    expect(() => declaredPath("/app", "@acme/missing/schema.sql")).toThrow(
      "@acme/missing/schema.sql names a module which no package installed under /app exports — install the package, or name the file by its path",
    );
  });
});

describe("migrationsDirRefusal()", () => {
  it("accepts a wrangler migrations_dir naming the directory forge applies from", () => {
    expect(migrationsDirRefusal(context(), "config/db/migrations")).toBeNull();
    expect(migrationsDirRefusal(context({ migrations: "db/m" }), "./db/m")).toBeNull();
  });

  it("refuses an unset migrations_dir, which wrangler reads as migrations, naming the key to set", () => {
    expect(migrationsDirRefusal(context(), undefined)).toBe(
      '/app/wrangler.jsonc: the DB entry\'s migrations_dir is unset, so wrangler reads `migrations`, but forge applies from config/db/migrations — set "migrations_dir": "config/db/migrations" on that entry, so `wrangler d1 migrations` and forge read one directory',
    );
  });

  it("refuses a migrations_dir that names another directory", () => {
    expect(migrationsDirRefusal(context(), "migrations")).toContain('migrations_dir is "migrations", but forge applies from config/db/migrations');
  });

  it("suggests a migrations_dir from a nested config's directory, which wrangler then accepts", () => {
    const nested = context({}, { configPath: "/app/apps/api/wrangler.jsonc" });
    expect(migrationsDirRefusal(nested, "config/db/migrations")).toBe(
      '/app/apps/api/wrangler.jsonc: the DB entry\'s migrations_dir is "config/db/migrations", but forge applies from config/db/migrations — set "migrations_dir": "../../config/db/migrations" on that entry, so `wrangler d1 migrations` and forge read one directory',
    );
    expect(migrationsDirRefusal(nested, "../../config/db/migrations")).toBeNull();
  });

  it("suggests a relative migrations_dir under a filesystem-root project, which wrangler then accepts", () => {
    const atRoot = context({}, { root: "/", configPath: "/wrangler.jsonc" });
    expect(migrationsDirRefusal(atRoot, undefined)).toBe(
      '/wrangler.jsonc: the DB entry\'s migrations_dir is unset, so wrangler reads `migrations`, but forge applies from config/db/migrations — set "migrations_dir": "config/db/migrations" on that entry, so `wrangler d1 migrations` and forge read one directory',
    );
    expect(migrationsDirRefusal(atRoot, "config/db/migrations")).toBeNull();
  });

  it("accepts an absent migrations_pattern, and one selecting the migrations_dir's top-level .sql files", () => {
    expect(migrationsDirRefusal(context(), "config/db/migrations", undefined)).toBeNull();
    expect(migrationsDirRefusal(context(), "config/db/migrations", "config/db/migrations/*.sql")).toBeNull();
  });

  it("refuses a migrations_pattern reaching below the directory, naming the key and the pattern that agrees", () => {
    expect(migrationsDirRefusal(context(), "config/db/migrations", "config/db/migrations/**/*.sql")).toBe(
      '/app/wrangler.jsonc: the DB entry\'s migrations_pattern is "config/db/migrations/**/*.sql", but forge applies only the top-level .sql files of config/db/migrations — remove "migrations_pattern" from that entry, or set it to "config/db/migrations/*.sql", so `wrangler d1 migrations` and forge apply one set of files',
    );
  });
});

describe("DEFAULT_DB_CONFIG", () => {
  it("is the path an app puts its db host config at", () => {
    expect(DEFAULT_DB_CONFIG).toBe("config/db.config.ts");
  });
});

describe("defineDbConfig()", () => {
  it("returns its argument unchanged", () => {
    const config: DbHostConfig = { schemas: ["schema.sql"] };

    expect(defineDbConfig(config)).toBe(config);
  });
});

describe("NO_SCHEMAS", () => {
  it("suggests a host config the config-files gate passes", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-declared-"));
    try {
      const suggested = NO_SCHEMAS.split("\n").find((line) => line.trimStart().startsWith("export default")) ?? "";
      mkdirSync(join(root, "config"));
      writeFileSync(
        join(root, DEFAULT_DB_CONFIG),
        `import { defineDbConfig, forgeSchema } from "@y-core/forge/tooling/db/host";\n\n${suggested.trim()}\n`,
      );

      expect(checkConfigFiles({ root }).findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
