import { describe, expect, it } from "bun:test";

import { renderTable } from "../../cf/table";
import { PLAIN } from "../../term/color";
import type { Migration, StatusReport } from "../types";
import { migrationStatusExitCode, formatStatus, statusRows } from "./status";

function migration(name: string): Migration {
  const version = Number(name.slice(0, 4));
  return { name, version, path: `/m/${name}.sql`, sha256: `sha-${name}`, sql: "", origin: "custom", stamp: null };
}

const discovered = [migration("0001_init"), migration("0002_next")];

function report(over: Partial<StatusReport> = {}): StatusReport {
  return {
    target: "local",
    database: "app-db",
    rows: [],
    pending: 0,
    checksums: { mismatched: [] },
    drift: [],
    fingerprint: { recorded: "ff", actual: "ff", matches: true },
    ...over,
  };
}

describe("statusRows()", () => {
  it("marks an applied migration applied, with the instant it went in", () => {
    expect(statusRows({ discovered, applied: [{ name: "0001_init", appliedAt: "2026-01-01" }], mismatched: [] })).toEqual([
      { name: "0001_init", state: "applied", appliedAt: "2026-01-01" },
      { name: "0002_next", state: "pending", appliedAt: null },
    ]);
  });

  it("marks an edited file mismatch, in preference to applied", () => {
    expect(statusRows({ discovered, applied: [{ name: "0001_init", appliedAt: "t" }], mismatched: ["0001_init"] })[0]).toEqual({
      name: "0001_init",
      state: "mismatch",
      appliedAt: "t",
    });
  });

  it("appends an applied name with no file as drift, after the rows on disk", () => {
    expect(statusRows({ discovered: [migration("0001_init")], applied: [{ name: "0009_gone", appliedAt: "t" }], mismatched: [] })).toEqual([
      { name: "0001_init", state: "pending", appliedAt: null },
      { name: "0009_gone", state: "drift", appliedAt: "t" },
    ]);
  });

  it("has no rows for an empty directory and an empty database", () => {
    expect(statusRows({ discovered: [], applied: [], mismatched: [] })).toEqual([]);
  });
});

describe("migrationStatusExitCode()", () => {
  it("is 0 when nothing is outstanding", () => {
    expect(migrationStatusExitCode(report())).toBe(0);
  });

  const failing: [string, Partial<StatusReport>][] = [
    ["a pending migration", { pending: 1 }],
    ["a mismatched checksum", { checksums: { mismatched: ["0001_init"] } }],
    ["drift", { drift: ["0009_gone"] }],
    ["a fingerprint that moved", { fingerprint: { recorded: "ff", actual: "gg", matches: false } }],
  ];

  for (const [name, over] of failing) {
    it(`is 1 for ${name}`, () => {
      expect(migrationStatusExitCode(report(over))).toBe(1);
    });
  }

  it("is 0 when nothing is applied and no fingerprint was ever certified, since there is nothing to disagree with", () => {
    expect(migrationStatusExitCode(report({ fingerprint: { recorded: null, actual: "gg", matches: false } }))).toBe(0);
  });

  it("is 1 when something is applied and no fingerprint was ever certified, which is what the note asks the reader to fix", () => {
    const rows = [{ name: "0001_init", state: "applied" as const, appliedAt: "t" }];

    expect(migrationStatusExitCode(report({ rows, fingerprint: { recorded: null, actual: "gg", matches: true } }))).toBe(1);
  });
});

describe("formatStatus()", () => {
  it("prints the heading, the table and `up to date` when nothing is outstanding", () => {
    const rows = [{ name: "0001_init", state: "applied" as const, appliedAt: "2026-01-01" }];
    expect(formatStatus(report({ rows }), PLAIN)).toBe(
      ["app-db (local)", renderTable([{ Migration: "0001_init", State: "applied", Applied: "2026-01-01" }]), "up to date"].join("\n"),
    );
  });

  it("says so plainly when there is nothing on disk and nothing recorded", () => {
    expect(formatStatus(report(), PLAIN)).toBe(["app-db (local)", "no migrations on disk and none recorded", "up to date"].join("\n"));
  });

  it("lists every anomaly under the table, in the order a reader would act on them", () => {
    const rows = [{ name: "0001_init", state: "mismatch" as const, appliedAt: "t" }];
    const outcome = report({
      rows,
      pending: 1,
      checksums: { mismatched: ["0001_init"] },
      drift: ["0009_gone"],
      fingerprint: { recorded: "ff", actual: "gg", matches: false },
    });
    expect(formatStatus(outcome, PLAIN).split("\n").slice(-4)).toEqual([
      "1 pending — apply with `forge db migrate`",
      "edited since it was applied: 0001_init",
      "applied but no longer on disk: 0009_gone",
      "schema fingerprint gg does not match the certified ff",
    ]);
  });

  it("says nothing about a fingerprint that was never recorded when nothing is applied", () => {
    const outcome = report({ fingerprint: { recorded: null, actual: "gg", matches: false } });
    expect(formatStatus(outcome, PLAIN).split("\n").slice(2)).toEqual(["up to date"]);
  });

  it("flags an applied row with no certified fingerprint", () => {
    const rows = [{ name: "0001_init", state: "applied" as const, appliedAt: "t" }];
    const outcome = report({ rows, fingerprint: { recorded: null, actual: "gg", matches: false } });
    expect(formatStatus(outcome, PLAIN).split("\n").slice(-1)).toEqual([
      "applied, but no schema fingerprint was ever certified — the next apply certifies one",
    ]);
  });

  it("writes an absent applied instant as an empty cell", () => {
    const rows = [{ name: "0001_init", state: "pending" as const, appliedAt: null }];
    expect(formatStatus(report({ rows, pending: 1 }), PLAIN)).toBe(
      [
        "app-db (local)",
        renderTable([{ Migration: "0001_init", State: "pending", Applied: "" }]),
        "1 pending — apply with `forge db migrate`",
      ].join("\n"),
    );
  });
});
