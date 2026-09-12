import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import type { Place, Seed, SeedRecord } from "../types";
import { planSeeds, recordSeedSql, seedKey, seedRunsOn } from "./plan";

const seed = (name: string, hash: string, source = "config/seeds"): Seed => ({
  source,
  name,
  path: `/s/${name}.sql`,
  sha256: hash,
  sql: `-- ${name}`,
  places: null,
});

const seeds = [seed("001_a", "aaa"), seed("002_b", "bbb"), seed("003_c", "ccc")];
const history: SeedRecord[] = [
  { source: "config/seeds", name: "001_a", sha256: "aaa", appliedAt: 1 },
  { source: "config/seeds", name: "002_b", sha256: "old", appliedAt: 2 },
];

describe("planSeeds()", () => {
  it("applies the unrecorded, skips the unchanged, and reports the edited one without applying it", () => {
    const plan = planSeeds(seeds, history, { rerun: false });
    expect(plan.apply.map((s) => s.name)).toEqual(["003_c"]);
    expect(plan.skip.map((s) => s.name)).toEqual(["001_a"]);
    expect(plan.changed.map((s) => s.name)).toEqual(["002_b"]);
  });

  it("applies everything under rerun, the edited seed included", () => {
    const plan = planSeeds(seeds, history, { rerun: true });
    expect(plan.apply.map((s) => s.name)).toEqual(["001_a", "002_b", "003_c"]);
    expect(plan.skip).toEqual([]);
    expect(plan.changed.map((s) => s.name)).toEqual(["002_b"]);
  });

  it("narrows to one seed with `only`, accepting the file name too", () => {
    expect(planSeeds(seeds, history, { only: "003_c", rerun: false }).apply.map((s) => s.name)).toEqual(["003_c"]);
    expect(planSeeds(seeds, history, { only: "003_c.sql", rerun: false }).apply.map((s) => s.name)).toEqual(["003_c"]);
  });

  it("refuses an unknown `only`, naming every seed there is by its directory", () => {
    expect(() => planSeeds(seeds, history, { only: "004_d", rerun: false })).toThrow(
      'No seed named "004_d" — available: config/seeds:001_a, config/seeds:002_b, config/seeds:003_c',
    );
    expect(() => planSeeds([], history, { only: "004_d", rerun: false })).toThrow('No seed named "004_d" — config/db.ts names no `seeds`');
  });

  it("takes `<dir>:<name>`, and refuses a bare name two directories both hold", () => {
    const both = [seed("001_a", "aaa"), seed("001_a", "zzz", "node_modules/lib/seeds")];
    expect(planSeeds(both, [], { only: "node_modules/lib/seeds:001_a", rerun: false }).apply.map((s) => s.source)).toEqual([
      "node_modules/lib/seeds",
    ]);
    expect(() => planSeeds(both, [], { only: "001_a", rerun: false })).toThrow(
      '"001_a" names a seed in config/seeds and node_modules/lib/seeds — say which with --only <dir>:001_a',
    );
  });

  it("keys a record by its directory and its name, so two directories may ship one name", () => {
    const both = [seed("001_a", "aaa"), seed("001_a", "zzz", "node_modules/lib/seeds")];
    const plan = planSeeds(both, [{ source: "config/seeds", name: "001_a", sha256: "aaa", appliedAt: 1 }], { rerun: false });
    expect(plan.skip.map((s) => s.source)).toEqual(["config/seeds"]);
    expect(plan.apply.map((s) => s.source)).toEqual(["node_modules/lib/seeds"]);
    expect(seedKey("config/seeds", "001_a")).not.toBe(seedKey("node_modules/lib/seeds", "001_a"));
  });
});

describe("planSeeds() places", () => {
  const placed = (name: string, places: readonly Place[] | null): Seed => ({ ...seed(name, name), places });
  const everywhere = placed("001_a", null);
  const localOnly = placed("002_b", ["local"]);
  const remoteOnly = placed("003_c", ["remote", "preview"]);
  const here = [everywhere, localOnly, remoteOnly];

  it("leaves a seed whose places exclude the run's out of apply, skip and changed alike", () => {
    const recorded: SeedRecord[] = [
      { source: "config/seeds", name: "003_c", sha256: "stale", appliedAt: 1 },
      { source: "config/seeds", name: "002_b", sha256: "002_b", appliedAt: 2 },
    ];
    const plan = planSeeds(here, recorded, { rerun: false, place: "local" });

    expect(plan.apply.map((s) => s.name)).toEqual(["001_a"]);
    expect(plan.skip.map((s) => s.name)).toEqual(["002_b"]);
    expect(plan.changed).toEqual([]);
  });

  it("keeps a seed with no places line on local and standby", () => {
    for (const place of ["local", "standby"] as const) {
      const plan = planSeeds([everywhere], [], { rerun: false, place });
      expect(plan.apply.map((s) => s.name)).toEqual(["001_a"]);
      expect(plan.excluded).toEqual([]);
    }
  });

  it("moves a seed with no places line to excluded on a deployed place", () => {
    for (const place of ["remote", "preview"] as const) {
      const plan = planSeeds([everywhere], [], { rerun: false, place });
      expect(plan.apply).toEqual([]);
      expect(plan.excluded.map((s) => s.name)).toEqual(["001_a"]);
    }
  });

  it("neither applies nor excludes a seed whose explicit places name other places — it opted out", () => {
    const plan = planSeeds([localOnly], [], { rerun: false, place: "remote" });
    expect(plan.apply).toEqual([]);
    expect(plan.excluded).toEqual([]);
  });

  it("answers seedRunsOn() for each place", () => {
    expect(["local", "standby", "remote", "preview"].map((place) => seedRunsOn(everywhere, place as Place))).toEqual([true, true, false, false]);
    expect(["local", "standby", "remote", "preview"].map((place) => seedRunsOn(remoteOnly, place as Place))).toEqual([false, false, true, true]);
  });

  it("keeps a seed on each place it names, and drops it on the others", () => {
    expect(planSeeds([remoteOnly], [], { rerun: false, place: "remote" }).apply.map((s) => s.name)).toEqual(["003_c"]);
    expect(planSeeds([remoteOnly], [], { rerun: false, place: "preview" }).apply.map((s) => s.name)).toEqual(["003_c"]);
    expect(planSeeds([remoteOnly], [], { rerun: false, place: "standby" }).apply).toEqual([]);
  });

  it("applies every seed when the run names no place", () => {
    expect(planSeeds(here, [], { rerun: false }).apply.map((s) => s.name)).toEqual(["001_a", "002_b", "003_c"]);
  });

  it("does not reach an excluded seed through --only, even under rerun, and says what would include it", () => {
    expect(() => planSeeds(here, [], { only: "003_c", rerun: true, place: "local" })).toThrow(
      "003_c is excluded from local — add a forge:places line naming it, and it runs there",
    );
    expect(() => planSeeds(here, [], { only: "009_z", rerun: true, place: "local" })).toThrow(
      'No seed named "009_z" — available: config/seeds:001_a, config/seeds:002_b',
    );
  });

  it("refuses as a CliError, which the CLI prints as one line", () => {
    expect(() => planSeeds([], [], { only: "004_d", rerun: false })).toThrow(CliError);
  });
});

describe("recordSeedSql()", () => {
  it("writes one INSERT OR REPLACE carrying the name, the hash and the instant", () => {
    expect(recordSeedSql(seeds[0] as Seed, 1757584800000)).toBe(
      "INSERT OR REPLACE INTO forge_seed_history (source, name, sha256, applied_at) VALUES ('config/seeds', '001_a', 'aaa', 1757584800000);",
    );
  });

  it("doubles a single quote in the name", () => {
    expect(recordSeedSql(seed("o'hara", "aaa"), 1)).toBe(
      "INSERT OR REPLACE INTO forge_seed_history (source, name, sha256, applied_at) VALUES ('config/seeds', 'o''hara', 'aaa', 1);",
    );
  });

  it("refuses a NUL byte rather than truncating the statement", () => {
    expect(() => recordSeedSql(seed("a\0b", "aaa"), 1)).toThrow("a NUL byte cannot appear in a SQL string literal");
  });
});
