import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import type { Migration } from "../types";
import { planApply } from "./plan";

function migration(version: number, name: string): Migration {
  const file = `${String(version).padStart(4, "0")}_${name}`;
  return { name: file, version, path: `/m/${file}.sql`, sha256: `sha-${file}`, sql: `-- ${file}`, origin: "custom", stamp: null };
}

const discovered = [migration(1, "init"), migration(2, "users"), migration(3, "index")];
const names = (list: readonly Migration[]) => list.map((m) => m.name);

describe("planApply()", () => {
  it("makes every discovered migration pending on an empty database", () => {
    const plan = planApply({ discovered, applied: [] });
    expect(names(plan.pending)).toEqual(["0001_init", "0002_users", "0003_index"]);
    expect(plan.skipped).toEqual([]);
    expect(plan.drift).toEqual([]);
  });

  it("leaves only what the migrations table has not recorded, in order", () => {
    const plan = planApply({ discovered, applied: ["0001_init"] });
    expect(names(plan.pending)).toEqual(["0002_users", "0003_index"]);
  });

  it("has nothing pending when every migration is applied", () => {
    const plan = planApply({ discovered, applied: ["0001_init", "0002_users", "0003_index"] });
    expect(plan.pending).toEqual([]);
    expect(plan.drift).toEqual([]);
  });

  it("cuts at a bare number, skipping everything above it", () => {
    const plan = planApply({ discovered, applied: [], to: "0002" });
    expect(names(plan.pending)).toEqual(["0001_init", "0002_users"]);
    expect(names(plan.skipped)).toEqual(["0003_index"]);
  });

  it("cuts at a full migration name too", () => {
    const plan = planApply({ discovered, applied: [], to: "0002_users" });
    expect(names(plan.pending)).toEqual(["0001_init", "0002_users"]);
    expect(names(plan.skipped)).toEqual(["0003_index"]);
  });

  it("accepts an unpadded number, because the version is the number and not the text", () => {
    expect(names(planApply({ discovered, applied: [], to: "2" }).pending)).toEqual(["0001_init", "0002_users"]);
  });

  it("skips nothing when the cut is the last migration", () => {
    const plan = planApply({ discovered, applied: [], to: "0003_index" });
    expect(names(plan.pending)).toEqual(["0001_init", "0002_users", "0003_index"]);
    expect(plan.skipped).toEqual([]);
  });

  it("refuses a --to that names no migration, listing what is on disk", () => {
    expect(() => planApply({ discovered, applied: [], to: "0009_nope" })).toThrow(
      "--to 0009_nope names no migration — on disk: 0001_init, 0002_users, 0003_index",
    );
  });

  it("refuses a --to against an empty migrations directory", () => {
    expect(() => planApply({ discovered: [], applied: [], to: "0001" })).toThrow(
      "--to 0001 names no migration — the migrations directory is empty",
    );
    expect(() => planApply({ discovered: [], applied: [], to: "0001" })).toThrow(CliError);
  });

  it("reports an applied name that is no longer on disk as drift", () => {
    const plan = planApply({ discovered, applied: ["0001_init", "0002_gone"] });
    expect(plan.drift).toEqual(["0002_gone"]);
    expect(names(plan.pending)).toEqual(["0002_users", "0003_index"]);
  });

  it("refuses a pending migration numbered below one already applied, naming both", () => {
    expect(() => planApply({ discovered, applied: ["0002_users", "0003_index"] })).toThrow(
      "0001_init is pending while 0003_index is already applied — renumber 0001_init above 0003_index, because a migration cannot be applied out of order",
    );
  });

  it("does not read drift as an out-of-order apply, since drift has no version on disk", () => {
    expect(planApply({ discovered: [migration(1, "init")], applied: ["0009_gone"] }).drift).toEqual(["0009_gone"]);
  });

  it("refuses a pending migration numbered under one already applied, which no forward-only apply can reach", () => {
    const mixed = [migration(1, "early"), migration(2, "later")];
    expect(() => planApply({ discovered: mixed, applied: ["0002_later"] })).toThrow("0001_early is pending while 0002_later is already applied");
  });
});
