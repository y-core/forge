import type { RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../../context/accessor";
import type { Logger } from "../../logging/types";
import type { D1QueryBudget, D1QueryTally } from "./types";

/** Warns at the eleventh run of one statement, and at 900 calls — before D1's 1,000-query paid-plan cap on one invocation. @internal */
export const D1_QUERY_BUDGET: D1QueryBudget = { repeats: 10, queries: 900 };

const tallyCtx = contextVar<D1QueryTally>("__d1QueryTally");

/** A fresh count of one request's D1 calls. @internal */
export function createQueryTally(): D1QueryTally {
  return { queries: 0, runs: new Map() };
}

/** The tally every client resolved within this request shares, opened on the first. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant to which request a tally belongs to
export function queryTallyFor(c: RequestContext<any, any>): D1QueryTally {
  const held = tallyCtx.getOptional(c);
  if (held !== undefined) return held;
  const tally = createQueryTally();
  tallyCtx.set(c, tally);
  return tally;
}

/** Counts one call, logging `d1.request.budget` at `warn` the once a statement's runs pass `repeats` and the once the request's calls reach `queries`; `sql` is `null` for a batch, which has no single statement to repeat. @internal */
export function countQuery(tally: D1QueryTally, sql: string | null, budget: D1QueryBudget, logger: Logger): void {
  tally.queries += 1;
  if (tally.queries === budget.queries) logger.warn("d1.request.budget", { reason: "queries", queries: tally.queries });
  if (sql === null) return;
  const runs = (tally.runs.get(sql) ?? 0) + 1;
  tally.runs.set(sql, runs);
  if (runs === budget.repeats + 1) logger.warn("d1.request.budget", { reason: "repeats", sql, runs, queries: tally.queries });
}
