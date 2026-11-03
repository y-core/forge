import { describe, expect, it } from "bun:test";

import type { D1BackupSidecar, D1RestoreReport } from "../../../storage/backup/types";
import { describeRestore, describeSidecar } from "./describe";

const SIDECAR: D1BackupSidecar = {
  key: "d1-backups/0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a/2026-11-02T03:00:00.000Z-B1.sql",
  databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  bookmark: "B1",
  takenAt: "2026-11-02T03:00:00.000Z",
  size: 120,
  md5: "0".repeat(32),
  sha256: "1".repeat(64),
  schemaDigest: "2".repeat(64),
  migrationHead: "0002_users.sql",
  rows: { users: 2, notes: 0 },
  hazards: [],
};

describe("describeSidecar()", () => {
  it("names the key, size, bookmark, migration head and rows", () => {
    expect(describeSidecar(SIDECAR)).toEqual([
      `✓ ${SIDECAR.key}`,
      "  120 bytes at bookmark B1, migration head 0002_users.sql",
      "  rows: users 2, notes 0",
    ]);
  });

  it("warns of each hazard and names the exact restore Time Travel still offers", () => {
    const lines = describeSidecar({ ...SIDECAR, hazards: [{ table: "users", column: "bio", kind: "escape", count: 2 }] });
    expect(lines.slice(3)).toEqual([
      "  ! users.bio: 2 text value(s) holding a \\n or \\r escape beside a real newline or carriage return, which D1's dumper doubles",
      "  ! the dump will not reproduce these — forge db bookmark restore --bookmark B1 restores them exactly while Time Travel keeps that bookmark",
    ]);
  });

  it("says no exact restore exists for a local dump, which has no Time Travel", () => {
    const lines = describeSidecar({ ...SIDECAR, bookmark: "local-1", hazards: [{ table: "t", column: null, kind: "unscanned", count: 0 }] });
    expect(lines.slice(3)).toEqual([
      "  ! t: not scanned for hazards, because the scan failed",
      "  ! the dump will not reproduce these — local D1 keeps no Time Travel, so no exact restore exists",
    ]);
  });
});

const REPORT: D1RestoreReport = { databaseId: "uuid-r", name: "app-db-restore", key: SIDECAR.key, bookmark: "B9", queries: 4, mismatches: [] };

describe("describeRestore()", () => {
  it("says the restored database holds what the sidecar recorded, or lists each mismatch", () => {
    expect(describeRestore(REPORT)).toEqual([
      `✓ restored ${SIDECAR.key} into app-db-restore (uuid-r) at bookmark B9`,
      "  it holds what the dump's sidecar recorded",
    ]);
    expect(describeRestore({ ...REPORT, bookmark: null, mismatches: ["notes holds 1 rows, but the dump holds 2"] })).toEqual([
      `✗ restored ${SIDECAR.key} into app-db-restore (uuid-r), but it differs from the dump's sidecar:`,
      "  ! notes holds 1 rows, but the dump holds 2",
    ]);
  });
});
