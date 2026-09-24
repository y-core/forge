import { describe, expect, it } from "bun:test";

import { fakeDbIo } from "../db.fixture";
import { buildSchemaSnapshot, readSchemaSnapshot, SCHEMA_SNAPSHOT_VERSION, writeSchemaSnapshot } from "./snapshot";

describe("read and write", () => {
  it("round-trips, and leaves the bytes alone on a second write", () => {
    const io = fakeDbIo();
    const snapshot = buildSchemaSnapshot({
      desired: { "config/schema.sql": "d", "node_modules/lib/schema.sql": "a" },
      declared: { "config/schema.sql": ["notes"], "node_modules/lib/schema.sql": ["posts", "posts_user"] },
      migrationsDigest: "m",
    });
    writeSchemaSnapshot(io, "/app/schema.snapshot.json", snapshot);
    const first = io.files.get("/app/schema.snapshot.json");
    writeSchemaSnapshot(io, "/app/schema.snapshot.json", snapshot);
    expect(io.files.get("/app/schema.snapshot.json")).toBe(first);
    expect(readSchemaSnapshot(io, "/app/schema.snapshot.json")).toEqual({
      version: SCHEMA_SNAPSHOT_VERSION,
      desired: { "config/schema.sql": "d", "node_modules/lib/schema.sql": "a" },
      declared: { "config/schema.sql": ["notes"], "node_modules/lib/schema.sql": ["posts", "posts_user"] },
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

  it("refuses the version before this one, and this version written without the names it remembers", () => {
    const io = fakeDbIo({
      "/five.json": '{"version":5,"desired":{"schema.sql":"d"},"migrationsDigest":"m"}',
      "/six.json": `{"version":${SCHEMA_SNAPSHOT_VERSION},"desired":{"schema.sql":"d"},"migrationsDigest":"m"}`,
    });
    expect(() => readSchemaSnapshot(io, "/five.json")).toThrow(
      `/five.json was written under snapshot version 5, and this forge reads ${SCHEMA_SNAPSHOT_VERSION} — delete it and compose again`,
    );
    expect(() => readSchemaSnapshot(io, "/six.json")).toThrow("/six.json is missing a field a snapshot carries — delete it and compose again");
  });
});
