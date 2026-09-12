import { describe, expect, it } from "bun:test";

import { bytesToHex, sha256 } from "../../crypto/mod";
import {
  DEFAULT_MIGRATIONS_TABLE,
  INVENTORY_SELECT,
  isManagedObject,
  MANAGED_TABLE_PREFIXES,
  MIGRATIONS_DIGEST_KEY,
  SCHEMA_FINGERPRINT_KEY,
  SCHEMA_META_SELECT,
  schemaFingerprintInput,
  toSchemaMeta,
  toSchemaObjects,
} from "./schema";
import type { SchemaObject } from "./types";

function object(type: string, name: string, sql: string | null = `CREATE ${type} ${name}`): SchemaObject {
  return { type, name, tblName: name, sql };
}

describe("constants", () => {
  it("spell the migrations table, the meta keys and the two statements exactly", () => {
    expect(DEFAULT_MIGRATIONS_TABLE).toBe("d1_migrations");
    expect(MIGRATIONS_DIGEST_KEY).toBe("migrations_digest");
    expect(SCHEMA_FINGERPRINT_KEY).toBe("schema_fingerprint");
    expect(SCHEMA_META_SELECT).toBe("SELECT key, value FROM forge_schema_meta");
  });
});

describe("MANAGED_TABLE_PREFIXES", () => {
  it("names forge's, SQLite's and the platform's own tables", () => {
    expect([...MANAGED_TABLE_PREFIXES]).toEqual(["forge_", "sqlite_", "_cf_"]);
  });
});

describe("isManagedObject()", () => {
  const cases: [string, string, boolean][] = [
    ["users", "d1_migrations", false],
    ["forge_migrations", "d1_migrations", true],
    ["sqlite_sequence", "d1_migrations", true],
    ["_cf_METADATA", "d1_migrations", true],
    ["d1_migrations", "d1_migrations", true],
    ["d1_migrations", "app_migrations", false],
    ["app_migrations", "app_migrations", true],
  ];

  for (const [name, table, expected] of cases) {
    it(`says ${name} against ${table} is ${expected ? "managed" : "the app's"}`, () => {
      expect(isManagedObject(name, table)).toBe(expected);
    });
  }

  it("defaults the migrations table to wrangler's", () => {
    expect(isManagedObject("d1_migrations")).toBe(true);
  });
});

describe("schemaFingerprintInput()", () => {
  it("writes type, name, tbl_name and sql, tab separated and newline joined", () => {
    expect(schemaFingerprintInput([object("table", "users", "CREATE TABLE users (id)")])).toBe("table\tusers\tusers\tCREATE TABLE users (id)");
  });

  it("writes an absent sql as the empty string", () => {
    expect(schemaFingerprintInput([object("index", "auto_users_1", null)])).toBe("index\tauto_users_1\tauto_users_1\t");
  });

  it("does not depend on the order the rows arrived in", () => {
    const a = [object("table", "users"), object("index", "users_email"), object("table", "notes")];
    const b = [object("table", "notes"), object("table", "users"), object("index", "users_email")];
    expect(schemaFingerprintInput(a)).toBe(schemaFingerprintInput(b));
  });

  it("sorts by type before name", () => {
    const objects = [object("table", "a", "A"), object("index", "z", "Z")];
    expect(schemaFingerprintInput(objects)).toBe("index\tz\tz\tZ\ntable\ta\ta\tA");
  });

  it("orders names by code point, not by locale", () => {
    expect(schemaFingerprintInput([object("table", "a", "A"), object("table", "Z", "Z")])).toBe("table\tZ\tZ\tZ\ntable\ta\ta\tA");
    const bmp = object("table", "￿", "B");
    const astral = object("table", "\u{1F600}", "S");
    expect(schemaFingerprintInput([astral, bmp])).toBe("table\t￿\t￿\tB\ntable\t\u{1F600}\t\u{1F600}\tS");
  });

  it("excludes forge's, SQLite's, the platform's and the migrations table", () => {
    const managed = [
      object("table", "forge_migrations"),
      object("table", "forge_schema_meta"),
      object("table", "sqlite_sequence"),
      object("table", "_cf_KV"),
      object("table", "d1_migrations"),
    ];
    expect(schemaFingerprintInput([object("table", "users", "U"), ...managed])).toBe("table\tusers\tusers\tU");
  });

  it("excludes the migrations table the config names, not only wrangler's default", () => {
    const objects = [object("table", "users", "U"), object("table", "app_migrations")];
    expect(schemaFingerprintInput(objects, "app_migrations")).toBe("table\tusers\tusers\tU");
    expect(schemaFingerprintInput(objects, "d1_migrations")).toBe(
      "table\tapp_migrations\tapp_migrations\tCREATE table app_migrations\ntable\tusers\tusers\tU",
    );
  });

  it("is empty for a database with nothing of the app's in it", () => {
    expect(schemaFingerprintInput([])).toBe("");
    expect(schemaFingerprintInput([object("table", "sqlite_sequence")])).toBe("");
  });

  it("hashes under WebCrypto to the vectors the CLI's node hash must also reach", async () => {
    const digest = async (objects: SchemaObject[]) => bytesToHex(await sha256(schemaFingerprintInput(objects)));
    expect(await digest([object("table", "users", "CREATE TABLE users (id)")])).toBe(
      "046121e94a6c7bc85d1b4f8a42890e238cd64a5ed53cf02e1e108c876021940e",
    );
    expect(await digest([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await digest([object("table", "a", "A"), object("index", "z", "Z")])).toBe(
      "8359743d2b2518c82a9856ec61e6821c385420a9cee8dd08edb8803618724054",
    );
  });
});

describe("INVENTORY_SELECT", () => {
  it("excludes the engine's and the platform's own objects with an escaped underscore", () => {
    expect(INVENTORY_SELECT).toBe(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name",
    );
  });
});

describe("toSchemaObjects()", () => {
  it("renames tbl_name and keeps a null sql as null", () => {
    expect(toSchemaObjects([{ type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id)" }])).toEqual([
      { type: "table", name: "users", tblName: "users", sql: "CREATE TABLE users (id)" },
    ]);
    expect(toSchemaObjects([{ type: "index", name: "auto", tbl_name: "users", sql: null }])).toEqual([
      { type: "index", name: "auto", tblName: "users", sql: null },
    ]);
  });

  it("is empty for no rows", () => {
    expect(toSchemaObjects([])).toEqual([]);
  });
});

describe("toSchemaMeta()", () => {
  it("collapses the key-value rows into a map", () => {
    expect(
      toSchemaMeta([
        { key: "schema_fingerprint", value: "ff" },
        { key: "migrations_digest", value: "dd" },
      ]),
    ).toEqual({ schema_fingerprint: "ff", migrations_digest: "dd" });
    expect(toSchemaMeta([])).toEqual({});
  });
});
