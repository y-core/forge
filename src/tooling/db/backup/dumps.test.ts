import { describe, expect, it } from "bun:test";

import type { D1BackupSidecar } from "../../../storage/backup/types";
import type { WranglerConfig } from "../../cf/types";
import type { DbConfig, Home } from "../types";
import { compareRowCounts, resolveDumpSource } from "./dumps";

function config(r2: unknown[] | undefined, env: string | null = null, envR2?: unknown[], databaseId: string | null = "db-id"): DbConfig {
  return {
    configPath: "/app/wrangler.jsonc",
    env,
    config: { name: "app", r2_buckets: r2, env: envR2 === undefined ? {} : { staging: { r2_buckets: envR2 } } } as unknown as WranglerConfig,
    entry: { binding: "DB", databaseName: "app-db", databaseId, previewDatabaseId: null },
  } as unknown as DbConfig;
}

/** A local run over `c`, whose home carries no deployed id. */
const at = (c: DbConfig) => ({ config: c, home: { databaseId: null } as unknown as Home });

const bucket = (binding: string) => ({ binding, bucket_name: binding.toLowerCase() });

describe("resolveDumpSource()", () => {
  it("takes BACKUPS among several, the only bucket otherwise, and --bucket over either", () => {
    expect(resolveDumpSource(at(config([bucket("MEDIA"), bucket("BACKUPS")])), {}).binding).toBe("BACKUPS");
    expect(resolveDumpSource(at(config([bucket("ARCHIVE")])), {}).binding).toBe("ARCHIVE");
    expect(resolveDumpSource(at(config([bucket("ARCHIVE")])), { bucket: "OTHER" }).binding).toBe("OTHER");
  });

  it("reads an environment's own buckets, which wrangler does not inherit", () => {
    expect(resolveDumpSource(at(config([bucket("BACKUPS")], "staging", [bucket("STAGING_DUMPS")])), {}).binding).toBe("STAGING_DUMPS");
  });

  it("keys the dumps by the binding's database_id, else its name, under d1-backups unless --prefix says otherwise", () => {
    expect(resolveDumpSource(at(config([bucket("BACKUPS")])), {})).toEqual({
      binding: "BACKUPS",
      bucketName: "backups",
      prefix: "d1-backups",
      databaseId: "db-id",
    });
    expect(resolveDumpSource(at(config([bucket("BACKUPS")], null, undefined, null)), { prefix: "ops" })).toEqual({
      binding: "BACKUPS",
      bucketName: "backups",
      prefix: "ops",
      databaseId: "app-db",
    });
  });

  it("drops a --prefix's trailing slashes, as listD1Backups does, so a push checks its key against the prefix the listing reads", () => {
    expect(resolveDumpSource(at(config([bucket("BACKUPS")])), { prefix: "ops//" }).prefix).toBe("ops");
  });

  it("refuses no bucket, and several with none named BACKUPS, naming --bucket", () => {
    expect(() => resolveDumpSource(at(config(undefined)), {})).toThrow("binds no R2 bucket and none named BACKUPS — pass --bucket");
    expect(() => resolveDumpSource(at(config([bucket("A"), bucket("B")])), {})).toThrow(
      "binds several R2 buckets (A, B) and none named BACKUPS — pass --bucket",
    );
  });
});

describe("resolveDumpSource() — the bucket and the database", () => {
  it("names the bucket the binding declares, and a --bucket no binding declares as the bucket itself", () => {
    expect(resolveDumpSource(at(config([{ binding: "BACKUPS", bucket_name: "app-backups" }])), {}).bucketName).toBe("app-backups");
    expect(resolveDumpSource(at(config([bucket("BACKUPS")])), { bucket: "loose-bucket" }).bucketName).toBe("loose-bucket");
  });

  it("keys a deployed target's dumps by the id its home addresses, a preview's own included", () => {
    const preview = { config: config([bucket("BACKUPS")]), home: { databaseId: "preview-id" } as unknown as Home };
    expect(resolveDumpSource(preview, {}).databaseId).toBe("preview-id");
  });
});

describe("compareRowCounts()", () => {
  const sidecar = { rows: { tasks: 2, gone: 1 } } as unknown as D1BackupSidecar;

  it("names each table whose count moved and each the database no longer declares, an empty table matching an absent count", () => {
    expect(
      compareRowCounts(
        sidecar,
        new Map([
          ["tasks", 3],
          ["empty", 0],
        ]),
      ),
    ).toEqual(["gone is in the dump and this database no longer declares it", "tasks: the dump holds 2 row(s) and the database now holds 3"]);
  });

  it("finds nothing when every count agrees", () => {
    expect(
      compareRowCounts(
        sidecar,
        new Map([
          ["tasks", 2],
          ["gone", 1],
        ]),
      ),
    ).toEqual([]);
  });
});
