import { CliError } from "../../cli/errors";
import { quoteSqlLiteral } from "../sql";
import type { Place, Seed, SeedPlan, SeedRecord } from "../types";

/** The key a seed is recorded and selected under: the directory that declared it and its name, never its name alone. @internal */
export function seedKey(source: string, name: string): string {
  return `${source}\0${name}`;
}

/** Whether a seed belongs in a run against `place`: one with no places line runs on `local` and `standby` only. @internal */
export function seedRunsOn(seed: Seed, place: Place): boolean {
  if (seed.places === null) return place === "local" || place === "standby";
  return seed.places.includes(place);
}

/** Sorts seeds into the ones to run, the ones already in, re-run only when `rerun` said so, the ones whose file changed since they ran, and the ones a deployed place left out for want of a places line. @internal */
export function planSeeds(
  seeds: readonly Seed[],
  history: readonly SeedRecord[],
  options: { only?: string | undefined; rerun: boolean; place?: Place | undefined },
): SeedPlan {
  const place = options.place;
  const here = place === undefined ? seeds : seeds.filter((seed) => seedRunsOn(seed, place));
  const excluded = place === undefined ? [] : seeds.filter((seed) => seed.places === null && !seedRunsOn(seed, place));
  const selected = options.only === undefined ? here : [findSeed(here, options.only, place, seeds)];
  const recorded = new Map(history.map((row) => [seedKey(row.source, row.name), row]));
  const apply: Seed[] = [];
  const skip: Seed[] = [];
  const changed: Seed[] = [];
  for (const seed of selected) {
    const record = recorded.get(seedKey(seed.source, seed.name));
    if (record === undefined) {
      apply.push(seed);
      continue;
    }
    if (record.sha256 !== seed.sha256) changed.push(seed);
    if (options.rerun) apply.push(seed);
    else if (record.sha256 === seed.sha256) skip.push(seed);
  }
  return { apply, skip, changed, excluded };
}

function findSeed(seeds: readonly Seed[], only: string, place: Place | undefined, all: readonly Seed[]): Seed {
  const separator = only.lastIndexOf(":");
  const source = separator === -1 ? null : only.slice(0, separator);
  const bare = separator === -1 ? only : only.slice(separator + 1);
  const wanted = bare.endsWith(".sql") ? bare.slice(0, -".sql".length) : bare;
  const matches = (seed: Seed) => seed.name === wanted && (source === null || seed.source === source);
  const found = seeds.filter(matches);

  if (found.length === 1) return found[0] as Seed;
  if (found.length > 1) {
    throw new CliError(
      "invalid-args",
      `"${only}" names a seed in ${found.map((seed) => seed.source).join(" and ")} — say which with --only <dir>:${wanted}`,
    );
  }
  if (place !== undefined && all.some(matches)) {
    throw new CliError("invalid-args", `${only} is excluded from ${place} — add a forge:places line naming it, and it runs there`);
  }
  const available =
    seeds.length === 0 ? "config/db.ts names no `seeds`" : `available: ${seeds.map((seed) => `${seed.source}:${seed.name}`).join(", ")}`;
  throw new CliError("invalid-args", `No seed named "${only}" — ${available}`);
}

/** The statement that records a seed as applied, replacing the row a re-run leaves behind. @internal */
export function recordSeedSql(seed: Seed, appliedAtMs: number): string {
  const values = [seed.source, seed.name, seed.sha256].map(quoteSqlLiteral).join(", ");
  return `INSERT OR REPLACE INTO forge_seed_history (source, name, sha256, applied_at) VALUES (${values}, ${quoteSqlLiteral(appliedAtMs)});`;
}
