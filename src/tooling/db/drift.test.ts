import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../cf/types";
import { CliError } from "../cli/errors";
import { PLAIN } from "../term/color";
import { fakeDbIo } from "./db.fixture";
import { refuseSchemaDrift, schemaDrift } from "./drift";
import { appHome } from "./home";
import { schemaFingerprint } from "./migrate/fingerprint";
import type { DbConfig, DbRunContext, FakeDbIo, RecordedChecksum, SchemaObject } from "./types";

const USERS_SQL = "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT";
const INVENTORY: readonly SchemaObject[] = [{ type: "table", name: "users", tblName: "users", sql: USERS_SQL }];
const ACTUAL = schemaFingerprint(INVENTORY);
const OTHER = "f".repeat(64);

function recorded(name: string, fingerprint: string | null): RecordedChecksum {
  return { appliedName: name, sha256: "a".repeat(64), appliedAt: 1_757_000_000_000, fingerprint };
}

function context(): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo();
  const config: DbConfig = {
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
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
  return { run, io };
}

describe("schemaDrift()", () => {
  it("matches when the newest certified fingerprint is the schema as it stands", () => {
    expect(schemaDrift([recorded("0001_init", ACTUAL)], INVENTORY)).toEqual({ state: "match", recorded: ACTUAL, actual: ACTUAL });
  });

  it("mismatches when a certified fingerprint is not the schema as it stands", () => {
    expect(schemaDrift([recorded("0001_init", OTHER)], INVENTORY)).toEqual({ state: "mismatch", recorded: OTHER, actual: ACTUAL });
  });

  it("reads past the uncertified rows a part-applied batch left, so an older certification still holds", () => {
    expect(schemaDrift([recorded("0001_init", OTHER), recorded("0002_add", null)], INVENTORY)).toEqual({
      state: "mismatch",
      recorded: OTHER,
      actual: ACTUAL,
    });
  });

  it("is unrecorded when rows exist and none of them ever certified one", () => {
    expect(schemaDrift([recorded("0001_init", null)], INVENTORY)).toEqual({ state: "unrecorded", recorded: null, actual: ACTUAL });
  });

  it("is unrecorded when there are no rows at all", () => {
    expect(schemaDrift([], INVENTORY).state).toBe("unrecorded");
  });

  it("is unavailable when the history table is absent", () => {
    expect(schemaDrift(null, INVENTORY)).toEqual({ state: "unavailable", recorded: null, actual: ACTUAL });
  });
});

describe("refuseSchemaDrift()", () => {
  const mismatch = { state: "mismatch" as const, recorded: OTHER, actual: ACTUAL };

  it("names both fingerprints, both causes and the restore that resolves it, offering no way past", () => {
    const { run } = context();

    expect(() => refuseSchemaDrift(run, mismatch)).toThrow(
      new CliError(
        "invalid-args",
        `app-db (local) schema fingerprint ${ACTUAL} is not the ${OTHER} the last apply certified — either the schema was changed outside the migrations, or an earlier batch part-applied and is being resumed. Inspect with \`forge db migrate status\`, then restore the database to the schema its migrations describe — \`forge db bookmark restore\` on a deployed one, \`forge db reset\` and \`forge db restore\` on a local one — and run again; nothing passes this check.`,
      ),
    );
  });

  it("refuses nothing on a state that is not a mismatch", () => {
    const { run } = context();

    for (const state of ["match", "unrecorded", "unavailable"] as const) {
      expect(() => refuseSchemaDrift(run, { state, recorded: null, actual: ACTUAL })).not.toThrow();
    }
  });
});
