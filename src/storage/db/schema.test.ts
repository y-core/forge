import { describe, expect, it } from "bun:test";

import { bytesToHex, sha256 } from "../../crypto/mod";
import {
  compareCodePoints,
  INVENTORY_SELECT,
  isManagedObject,
  MANAGED_TABLE_PREFIXES,
  RECORDED_FINGERPRINT_SELECT,
  schemaFingerprintInput,
  toSchemaObjects,
} from "./schema";
import type { SchemaObject } from "./types";

function object(type: string, name: string, sql: string | null = `CREATE ${type} ${name}`): SchemaObject {
  return { type, name, tblName: name, sql };
}

describe("MANAGED_TABLE_PREFIXES", () => {
  it("names forge's, SQLite's and the platform's own tables", () => {
    expect([...MANAGED_TABLE_PREFIXES]).toEqual(["_forge_", "sqlite_", "_cf_"]);
  });
});

describe("isManagedObject()", () => {
  const cases: [string, boolean][] = [
    ["users", false],
    ["_forge_migrations", true],
    ["sqlite_sequence", true],
    ["_cf_METADATA", true],
    ["d1_migrations", false],
  ];

  for (const [name, expected] of cases) {
    it(`says ${name} is ${expected ? "managed" : "the app's"}`, () => {
      expect(isManagedObject(name)).toBe(expected);
    });
  }
});

describe("compareCodePoints()", () => {
  it("orders an astral character above every BMP one, which a UTF-16 code-unit compare does not", () => {
    expect(compareCodePoints("\u{1F600}", "￿")).toBe(1);
    expect(compareCodePoints("￿", "\u{1F600}")).toBe(-1);
  });

  it("orders an upper-case letter before a lower-case one, and a prefix before what extends it", () => {
    expect(compareCodePoints("Z", "a")).toBe(-1);
    expect(compareCodePoints("user", "users")).toBe(-1);
    expect(compareCodePoints("users", "user")).toBe(1);
  });

  it("is zero for two equal strings, including two empty ones", () => {
    expect(compareCodePoints("users", "users")).toBe(0);
    expect(compareCodePoints("", "")).toBe(0);
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

  it("excludes forge's, SQLite's and the platform's own tables", () => {
    const managed = [object("table", "_forge_migrations"), object("table", "sqlite_sequence"), object("table", "_cf_KV")];
    expect(schemaFingerprintInput([object("table", "users", "U"), ...managed])).toBe("table\tusers\tusers\tU");
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

describe("RECORDED_FINGERPRINT_SELECT", () => {
  it("reads the newest certified fingerprint, skipping a row a part-applied batch left uncertified", () => {
    expect(RECORDED_FINGERPRINT_SELECT).toBe("SELECT fingerprint FROM _forge_migrations WHERE fingerprint IS NOT NULL ORDER BY id DESC LIMIT 1");
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
