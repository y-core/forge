import { CliError } from "../../cli/errors";
import type { ApplyPlan, Migration } from "../types";
import type { ApplyPlanRequest } from "./types";

/** The migration `--to` names, or a refusal listing what is on disk. */
function resolveCut(discovered: readonly Migration[], to: string): Migration {
  const byName = discovered.find((m) => m.name === to);
  if (byName !== undefined) return byName;
  const byVersion = /^\d+$/.test(to) ? discovered.find((m) => m.version === Number(to)) : undefined;
  if (byVersion !== undefined) return byVersion;
  const known = discovered.map((m) => m.name).join(", ");
  throw new CliError(
    "invalid-args",
    `--to ${to} names no migration${known === "" ? " — the migrations directory is empty" : ` — on disk: ${known}`}`,
  );
}

/** Refuses a pending migration numbered below one already applied, which is out of order. */
function refuseOutOfOrder(pending: readonly Migration[], applied: readonly Migration[]): void {
  const highest = applied.reduce<Migration | null>((best, m) => (best === null || m.version > best.version ? m : best), null);
  if (highest === null) return;
  const stale = pending.find((m) => m.version < highest.version);
  if (stale === undefined) return;
  throw new CliError(
    "invalid-args",
    `${stale.name} is pending while ${highest.name} is already applied — renumber ${stale.name} above ${highest.name}, because a migration cannot be applied out of order`,
  );
}

/** Works out which migrations an apply would run, which the `--to` cut leaves, and which applied names are gone from disk. @internal */
export function planApply(request: ApplyPlanRequest): ApplyPlan {
  const appliedNames = new Set(request.applied);
  const onDisk = new Set(request.discovered.map((m) => m.name));
  const pendingAll = request.discovered.filter((m) => !appliedNames.has(m.name));

  refuseOutOfOrder(
    pendingAll,
    request.discovered.filter((m) => appliedNames.has(m.name)),
  );

  const cut = request.to === undefined ? null : resolveCut(request.discovered, request.to);
  const cutAt = cut === null ? -1 : request.discovered.indexOf(cut);
  const positionOf = (migration: Migration) => request.discovered.indexOf(migration);
  return {
    pending: cut === null ? pendingAll : pendingAll.filter((m) => positionOf(m) <= cutAt),
    skipped: cut === null ? [] : pendingAll.filter((m) => positionOf(m) > cutAt),
    drift: request.applied.filter((name) => !onDisk.has(name)),
  };
}
