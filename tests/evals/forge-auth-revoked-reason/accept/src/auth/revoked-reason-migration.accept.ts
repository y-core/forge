import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { lintMigration } from "../tooling/db/migrate/lint";
import { diffSchemaModels } from "../tooling/db/schema/diff";
import { emitMigrationSql } from "../tooling/db/schema/emit";
import { formatComposeHeader } from "../tooling/db/schema/header";
import { assembleSchemaModel, schemaModelSelects } from "../tooling/db/schema/introspect";
import type { SchemaModel } from "../tooling/db/schema/types";

const BASELINE = new URL("../../tests/evals/forge-auth-revoked-reason/baseline.sql", import.meta.url);
const DESIRED = new URL("./schema.sql", import.meta.url);

function modelOf(ddl: string): SchemaModel {
  const sqlite = new Database(":memory:");
  try {
    sqlite.run(ddl);
    const selects = schemaModelSelects();
    const rows = (sql: string) => sqlite.query(sql).all() as Record<string, unknown>[];
    return assembleSchemaModel({
      inventory: rows(selects.inventory),
      columns: rows(selects.columns),
      indexList: rows(selects.indexList),
      indexColumns: rows(selects.indexColumns),
      foreignKeys: rows(selects.foreignKeys),
    });
  } finally {
    sqlite.close();
  }
}

describe("the migration an app composes for this schema change", () => {
  const baseline = modelOf(readFileSync(BASELINE, "utf-8"));
  const desired = modelOf(readFileSync(DESIRED, "utf-8"));
  const diff = diffSchemaModels(baseline, desired);

  it("is one the composer does not refuse", () => {
    expect(diff.refusals).toEqual([]);
  });

  it("adds revoked_reason to auth_access_tokens in place, with no rebuild and no other table touched", () => {
    expect(diff.tables.map((table) => [table.kind, table.name, "added" in table ? table.added.map((column) => column.name) : []])).toEqual([
      ["alter", "auth_access_tokens", ["revoked_reason"]],
    ]);
  });

  it("passes the migration lint that runs before every apply", () => {
    const body = emitMigrationSql(diff, baseline, desired);
    const sql = `${formatComposeHeader({ desired: {}, baseline: "", forge: "0.0.0" }, body)}${body}`;

    expect(lintMigration("<composed>", sql)).toEqual([]);
  });
});
