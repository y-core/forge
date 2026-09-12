import { describe, expect, it } from "bun:test";

import type { SchemaObject } from "../types";
import { schemaFingerprint } from "./fingerprint";

function object(type: string, name: string, sql: string | null = `CREATE ${type} ${name}`): SchemaObject {
  return { type, name, tblName: name, sql };
}

describe("schemaFingerprint()", () => {
  it("hashes with node's createHash to the vectors storage/db reaches under WebCrypto", () => {
    expect(schemaFingerprint([object("table", "users", "CREATE TABLE users (id)")])).toBe(
      "046121e94a6c7bc85d1b4f8a42890e238cd64a5ed53cf02e1e108c876021940e",
    );
    expect(schemaFingerprint([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(schemaFingerprint([object("table", "a", "A"), object("index", "z", "Z")])).toBe(
      "8359743d2b2518c82a9856ec61e6821c385420a9cee8dd08edb8803618724054",
    );
  });

  it("excludes the migrations table the config names", () => {
    const objects = [object("table", "users", "U"), object("table", "app_migrations")];
    expect(schemaFingerprint(objects, "app_migrations")).toBe(schemaFingerprint([object("table", "users", "U")]));
    expect(schemaFingerprint(objects, "d1_migrations")).not.toBe(schemaFingerprint([object("table", "users", "U")]));
  });
});
