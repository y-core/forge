import { describe, expect, it } from "bun:test";

import { fakeDbIo } from "../test-support";
import { buildSchemaSnapshot, readSchemaSnapshot, SCHEMA_SNAPSHOT_VERSION, writeSchemaSnapshot } from "./snapshot";

describe("read and write", () => {
  it("round-trips, and leaves the bytes alone on a second write", () => {
    const io = fakeDbIo();
    const snapshot = buildSchemaSnapshot({ desired: { "config/schema.sql": "d", "node_modules/lib/schema.sql": "a" }, migrationsDigest: "m" });
    writeSchemaSnapshot(io, "/app/schema.snapshot.json", snapshot);
    const first = io.files.get("/app/schema.snapshot.json");
    writeSchemaSnapshot(io, "/app/schema.snapshot.json", snapshot);
    expect(io.files.get("/app/schema.snapshot.json")).toBe(first);
    expect(readSchemaSnapshot(io, "/app/schema.snapshot.json")).toEqual({
      version: SCHEMA_SNAPSHOT_VERSION,
      desired: { "config/schema.sql": "d", "node_modules/lib/schema.sql": "a" },
      migrationsDigest: "m",
    });
    expect(io.files.get("/app/schema.snapshot.json")?.endsWith("\n")).toBe(true);
  });

  it("is null when absent, and refuses another version or a broken file", () => {
    const io = fakeDbIo({ "/v.json": '{"version":99}', "/j.json": "{" });
    expect(readSchemaSnapshot(io, "/none.json")).toBeNull();
    expect(() => readSchemaSnapshot(io, "/v.json")).toThrow("was written under snapshot version 99");
    expect(() => readSchemaSnapshot(io, "/j.json")).toThrow("is not JSON");
  });
});
