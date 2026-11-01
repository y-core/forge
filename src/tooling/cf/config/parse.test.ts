import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeWranglerSource, loadWranglerConfig, parseWranglerConfig, validateWranglerConfig } from "./parse";

const ORIGIN = "/project/wrangler.jsonc";
const PREFIX = `malformed wrangler config at ${ORIGIN}: `;

function refusal(tree: unknown): string {
  try {
    validateWranglerConfig(tree, ORIGIN);
  } catch (thrown) {
    return (thrown as Error).message;
  }
  throw new Error("expected the config to be refused");
}

function issuePaths(message: string): string[] {
  expect(message.startsWith(PREFIX)).toBe(true);
  return message
    .slice(PREFIX.length)
    .split("; ")
    .map((issue) => issue.slice(0, issue.indexOf(": ")));
}

describe("validateWranglerConfig()", () => {
  const block = {
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: true,
    routes: [{ pattern: "example.test/*", zone_name: "example.test" }],
    route: "example.test/*",
    d1_databases: [
      {
        binding: "DB",
        database_name: "main",
        database_id: "id-1",
        preview_database_id: "id-2",
        migrations_dir: "migrations",
        migrations_pattern: "migrations/*.sql",
        migrations_table: "d1_migrations",
        remote: true,
      },
    ],
  };

  it("accepts every typed key at the top level and in an environment, returning the input itself", () => {
    const tree = {
      ...block,
      name: "w",
      main: "src/worker.ts",
      compatibility_date: "2026-01-01",
      account_id: "acc",
      pages_build_output_dir: "dist",
      assets: { directory: "public", binding: "ASSETS", run_worker_first: ["/api/*", "!/api/docs"] },
      env: { staging: { ...block, vars: { A: "1" } } },
      observability: { enabled: true },
    };
    expect(validateWranglerConfig(tree, ORIGIN)).toBe(tree as never);
  });

  it("keeps keys the schema does not name, and extra fields on a D1 entry", () => {
    const tree = { name: "w", unknown_key: 1, d1_databases: [{ binding: "DB", extra: "kept" }] };
    expect(validateWranglerConfig(tree, ORIGIN)).toEqual(tree as never);
  });

  it("accepts `run_worker_first` as a boolean", () => {
    const tree = { name: "w", assets: { run_worker_first: true } };
    expect(validateWranglerConfig(tree, ORIGIN)).toBe(tree as never);
  });

  it("accepts an empty env table", () => {
    const tree = { name: "w", env: {} };
    expect(validateWranglerConfig(tree, ORIGIN)).toBe(tree as never);
  });

  it("accepts an env decoded from JSON whose environments carry ordinary names", () => {
    const tree = { name: "w", env: JSON.parse(`{ "proto": { "workers_dev": true } }`) as unknown };
    expect(validateWranglerConfig(tree, ORIGIN)).toBe(tree as never);
  });

  const refused: [string, unknown, string][] = [
    ["a flag list that is a string", { compatibility_flags: "x" }, "compatibility_flags"],
    ["a flag list holding a number", { compatibility_flags: ["a", 7] }, "compatibility_flags[1]"],
    ["an environment's flag list that is a string", { env: { dev: { compatibility_flags: "x" } } }, "env.dev.compatibility_flags"],
    ["an environment's flag list holding a number", { env: { dev: { compatibility_flags: ["a", 7] } } }, "env.dev.compatibility_flags[1]"],
    ["an env that is a string", { env: "staging" }, "env"],
    ["an env that is null", { env: null }, "env"],
    ["an environment that is a boolean", { env: { dev: true } }, "env.dev"],
    ["an environment that is a string", { env: { dev: "DB" } }, "env.dev"],
    ["an environment's string workers_dev", { env: { dev: { workers_dev: "false" } } }, "env.dev.workers_dev"],
    ["a D1 list that is a table", { d1_databases: { binding: "DB" } }, "d1_databases"],
    ["an environment's D1 list that is a table", { env: { dev: { d1_databases: { binding: "DB" } } } }, "env.dev.d1_databases"],
    ["an environment's D1 entry without a binding", { env: { dev: { d1_databases: [{}] } } }, "env.dev.d1_databases[0].binding"],
    ["a numeric database_name", { d1_databases: [{ binding: "DB", database_name: 5 }] }, "d1_databases[0].database_name"],
    ["a numeric database_id", { d1_databases: [{ binding: "DB", database_id: 5 }] }, "d1_databases[0].database_id"],
    ["a numeric preview_database_id", { d1_databases: [{ binding: "DB", preview_database_id: 5 }] }, "d1_databases[0].preview_database_id"],
    ["a numeric migrations_dir", { d1_databases: [{ binding: "DB", migrations_dir: 5 }] }, "d1_databases[0].migrations_dir"],
    ["a numeric migrations_pattern", { d1_databases: [{ binding: "DB", migrations_pattern: 5 }] }, "d1_databases[0].migrations_pattern"],
    ["a numeric migrations_table", { d1_databases: [{ binding: "DB", migrations_table: 5 }] }, "d1_databases[0].migrations_table"],
    ["a numeric main", { main: 7 }, "main"],
    ["a numeric account_id", { account_id: 7 }, "account_id"],
    ["a numeric compatibility_date", { compatibility_date: 7 }, "compatibility_date"],
    ["a numeric pages_build_output_dir", { pages_build_output_dir: 7 }, "pages_build_output_dir"],
    ["a string workers_dev", { workers_dev: "false" }, "workers_dev"],
    ["a string preview_urls", { preview_urls: "false" }, "preview_urls"],
    ["a string routes", { routes: "x" }, "routes"],
    ["a numeric assets directory", { assets: { directory: 5 } }, "assets.directory"],
    ["a numeric assets binding", { assets: { binding: 5 } }, "assets.binding"],
    ["a run_worker_first list holding a number", { assets: { run_worker_first: [7] } }, "assets.run_worker_first"],
    ["a string run_worker_first", { assets: { run_worker_first: "x" } }, "assets.run_worker_first"],
    ["an environment's numeric main", { env: { staging: { main: 7 } } }, "env.staging.main"],
    ["an environment's assets that is a list", { env: { staging: { assets: [] } } }, "env.staging.assets"],
    ["an environment's numeric assets directory", { env: { staging: { assets: { directory: 5 } } } }, "env.staging.assets.directory"],
    ["an environment's numeric account_id", { env: { staging: { account_id: 7 } } }, "env.staging.account_id"],
    ["an environment's numeric compatibility_date", { env: { staging: { compatibility_date: 7 } } }, "env.staging.compatibility_date"],
    ["an environment's numeric name", { env: { staging: { name: 7 } } }, "env.staging.name"],
  ];

  for (const [label, fields, path] of refused) {
    it(`refuses ${label}, naming its path`, () => {
      expect(issuePaths(refusal({ name: "w", ...(fields as object) }))).toEqual([path]);
    });
  }

  it("refuses an env that is a list", () => {
    expect(refusal({ name: "w", env: [] })).toBe(`${PREFIX}env: must be a table of named environments`);
  });

  it("refuses an environment that is a list", () => {
    expect(refusal({ name: "w", env: { dev: [] } })).toBe(`${PREFIX}env.dev: must be an environment table`);
  });

  it("refuses an assets block that is a list", () => {
    expect(refusal({ name: "w", assets: [] })).toBe(`${PREFIX}assets: must be a table`);
  });

  it("refuses an env that holds an own `__proto__`", () => {
    // JSON.parse makes `__proto__` an own key, where an object literal would set the prototype.
    const env = JSON.parse(`{ "__proto__": { "workers_dev": true } }`) as unknown;
    expect(refusal({ name: "w", env })).toBe(`${PREFIX}env: must be a table of named environments`);
  });

  it("names every bad field, joined by a semicolon", () => {
    expect(issuePaths(refusal({ name: "w", main: 7, workers_dev: "no" })).sort()).toEqual(["main", "workers_dev"]);
  });
});

describe("decodeWranglerSource()", () => {
  it("decodes comments and trailing commas", () => {
    expect(decodeWranglerSource(`{\n  // note\n  "name": "w", /* x */\n  "a": [1,],\n}`, ORIGIN)).toEqual({ name: "w", a: [1] });
  });

  it("throws the invalid-JSON error naming the origin", () => {
    expect(() => decodeWranglerSource(`{ "name": }`, ORIGIN)).toThrow(`${PREFIX}invalid JSON — `);
  });
});

describe("parseWranglerConfig()", () => {
  let dir = "";
  let counter = 0;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "forge-wrangler-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeTemp(contents: string): string {
    counter += 1;
    const path = join(dir, `${counter}.jsonc`);
    writeFileSync(path, contents, "utf-8");
    return path;
  }

  it("parses a valid config and exposes name", () => {
    const path = writeTemp(`{ "name": "my-worker", "vars": { "A": "1" } }`);
    expect(parseWranglerConfig(path).name).toBe("my-worker");
  });

  it("throws a clear error when name is missing", () => {
    const path = writeTemp(`{ "vars": { "A": "1" } }`);
    expect(() => parseWranglerConfig(path)).toThrow('name: wrangler config must define a string "name"');
  });

  it("throws the same error when name is not a string", () => {
    const path = writeTemp(`{ "name": 1 }`);
    expect(() => parseWranglerConfig(path)).toThrow('name: wrangler config must define a string "name"');
  });

  it("keeps the type error for a config that is not an object", () => {
    const path = writeTemp(`"my-worker"`);
    expect(() => parseWranglerConfig(path)).toThrow('(root): Invalid type: Expected Object but received "my-worker"');
  });

  it("throws when the JSON is syntactically invalid", () => {
    const path = writeTemp(`{ "name": }`);
    expect(() => parseWranglerConfig(path)).toThrow(`malformed wrangler config at ${path}: invalid JSON — `);
  });

  it("refuses a field at the wrong type with the absolute path of the file", () => {
    const path = writeTemp(`{ "name": "w", "env": { "dev": { "d1_databases": [{}] } } }`);
    expect(() => parseWranglerConfig(path)).toThrow(`malformed wrangler config at ${path}: env.dev.d1_databases[0].binding: `);
  });

  it("parses JSONC with comments and trailing commas into the exact object", () => {
    const path = writeTemp(`{
      // worker name
      "name": "demo", /* inline */
      "vars": { "BASE_URL": "https://example.com", },
      "kv_namespaces": [ { "binding": "LOGS", "id": "1" }, ],
    }`);
    expect(parseWranglerConfig(path)).toEqual({
      name: "demo",
      vars: { BASE_URL: "https://example.com" },
      kv_namespaces: [{ binding: "LOGS", id: "1" }],
    });
  });

  it("returns the decoded object with keys the schema does not name, alongside the source", () => {
    const source = `{ "name": "w", "observability": { "enabled": true } }`;
    const path = writeTemp(source);
    expect(loadWranglerConfig(path)).toEqual({ path, source, config: { name: "w", observability: { enabled: true } } });
  });

  it("throws when the file does not exist", () => {
    expect(() => parseWranglerConfig(join(dir, "absent.jsonc"))).toThrow();
  });
});
