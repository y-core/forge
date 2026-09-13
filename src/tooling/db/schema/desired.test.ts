import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { declaredPath } from "../declared";
import { sha256 } from "../digest";
import { appHome } from "../home";
import { fakeDbIo } from "../test-support";
import type { DbConfig, DbHostConfig, DbRunContext, FakeDbIo } from "../types";
import { readDesiredState } from "./desired";

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

function context(files: Record<string, string> = {}, host: DbHostConfig = {}): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo(files);
  const config = dbConfig();
  return { run: { config, home: appHome(config), io, host, json: false, yes: true, style: PLAIN, print: () => {} }, io };
}

describe("readDesiredState", () => {
  it("reads a single .sql file as its own text, keyed as it was declared", () => {
    const text = "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;\n";
    const { io } = context({ "/app/config/schema.sql": text });
    expect(readDesiredState(io, declaredPath("/app", "config/schema.sql"))).toEqual({
      source: "config/schema.sql",
      path: "/app/config/schema.sql",
      files: ["/app/config/schema.sql"],
      text,
      digest: sha256(text),
    });
  });

  it("concatenates a directory's .sql files in name order under a banner each", () => {
    const first = "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;\n";
    const second = "CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;\n";
    const { io } = context({ "/app/schema/002_notes.sql": second, "/app/schema/001_users.sql": first, "/app/schema/README.md": "ignored" });
    const state = readDesiredState(io, declaredPath("/app", "schema"));
    const text = `-- ---- schema/001_users.sql ----\n\n${first}\n-- ---- schema/002_notes.sql ----\n\n${second}`;
    expect(state).toEqual({
      source: "schema",
      path: "/app/schema",
      files: ["/app/schema/001_users.sql", "/app/schema/002_notes.sql"],
      text,
      digest: sha256(text),
    });
  });

  it("returns null when the declared path does not exist", () => {
    expect(readDesiredState(context().io, declaredPath("/app", "config/schema.sql"))).toBe(null);
  });
});
