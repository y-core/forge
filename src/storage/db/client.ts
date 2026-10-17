import { createLogger } from "../../logging/logger";
import type { Logger } from "../../logging/types";
import { classifyD1Error, D1Failure } from "./failure";
import { D1_LIMITS } from "./limits";
import { D1_RETRY_POLICY, retryWithBackoff } from "./retry";
import { ROWS_WRITTEN_GUARD } from "./sql";
import type {
  D1Client,
  D1ClientOptions,
  D1Cost,
  D1Queryable,
  D1Outcome,
  D1Result,
  D1RetryPolicy,
  D1ServedBy,
  D1WriteOptions,
  SqlFragment,
} from "./types";

// `changes` first: it is the exact "did my write match a row" signal every guard rests on, and the
// one `ROWS_WRITTEN_GUARD` is built from. `rows_written` is an IO metric that counts index rows too.
/** The write count and last row id a D1 result carries, under the names forge reports. */
function writtenOf(meta: D1Result["meta"]): { rowsWritten: number; lastRowId?: number | null } {
  return { rowsWritten: meta.changes ?? meta.rows_written ?? 0, ...(meta.last_row_id !== undefined ? { lastRowId: meta.last_row_id } : {}) };
}

interface Answer<T> {
  data: T;
  metas: readonly D1Result["meta"][];
}

/** What D1 billed a call on, or `undefined` where it reported none of it — a fake binding, say. */
function costOf(metas: readonly D1Result["meta"][]): D1Cost | undefined {
  if (!metas.some((meta) => meta.rows_read !== undefined || meta.rows_written !== undefined || meta.duration !== undefined)) return undefined;
  const sum = (pick: (meta: D1Result["meta"]) => number | undefined) => metas.reduce((total, meta) => total + (pick(meta) ?? 0), 0);
  return { rowsRead: sum((meta) => meta.rows_read), rowsWritten: sum((meta) => meta.rows_written), durationMs: sum((meta) => meta.duration) };
}

/** Where the first statement that says so ran, or `undefined` where none does. */
function servedByOf(metas: readonly D1Result["meta"][]): D1ServedBy | undefined {
  const placed = metas.find((meta) => meta.served_by_region !== undefined || meta.served_by_primary !== undefined);
  return placed === undefined ? undefined : { region: placed.served_by_region ?? null, primary: placed.served_by_primary ?? null };
}

/** D1's own read retries for a call: the most any of its statements took. */
function totalAttemptsOf(metas: readonly D1Result["meta"][]): number {
  return Math.max(1, ...metas.map((meta) => meta.total_attempts ?? 1));
}

const encoder = new TextEncoder();

/** The limit failure for the first statement D1 would refuse for its size, or `null` when every one fits. */
function oversized(fragments: readonly SqlFragment[]): D1Failure | null {
  for (const [i, fragment] of fragments.entries()) {
    const at = fragments.length === 1 ? "the statement" : `statement ${i + 1}`;
    if (fragment.params.length > D1_LIMITS.boundParams) {
      return new D1Failure(
        "limit",
        `${at} binds ${fragment.params.length} parameters, over D1's ${D1_LIMITS.boundParams} — bind a list as one JSON array: IN (SELECT value FROM json_each(?))`,
        { attempts: 0 },
      );
    }
    const bytes = encoder.encode(fragment.text).length;
    if (bytes > D1_LIMITS.statementBytes) {
      return new D1Failure("limit", `${at} is ${bytes} bytes, over D1's ${D1_LIMITS.statementBytes}`, { attempts: 0 });
    }
  }
  return null;
}

type CallOp = "batch" | "execute" | "query" | "queryOne";

/** Runs one call, retrying a transient failure only when `retry` is set, classifies whatever it finally throws, and logs one `d1.query` record without any bound value; a statement over D1's limits fails unsent. */
async function call<T>(
  op: CallOp,
  fragments: readonly SqlFragment[],
  retry: boolean,
  context: { policy: D1RetryPolicy; logger: Logger; slowQueryMs: number | undefined },
  run: () => Promise<Answer<T>>,
): Promise<D1Outcome<T>> {
  const outcome = await dispatch(fragments, retry, context.policy, run);
  const { cost, servedBy } = outcome.meta;
  const record = {
    op,
    sql: fragments.length === 1 ? fragments[0]?.text : fragments.map((fragment) => fragment.text),
    attempts: outcome.meta.attempts,
    ...(outcome.ok ? {} : { failure: outcome.error.kind }),
    ...cost,
    ...(servedBy === undefined ? {} : { region: servedBy.region, primary: servedBy.primary }),
  };
  const slow = context.slowQueryMs !== undefined && cost !== undefined && cost.durationMs > context.slowQueryMs;
  context.logger[slow ? "warn" : "debug"]("d1.query", record);
  return outcome;
}

async function dispatch<T>(
  fragments: readonly SqlFragment[],
  retry: boolean,
  policy: D1RetryPolicy,
  run: () => Promise<Answer<T>>,
): Promise<D1Outcome<T>> {
  const refused = oversized(fragments);
  if (refused !== null) return { ok: false, error: refused, meta: { attempts: 0 } };
  const guarded = fragments.some((f) => f.text.includes(ROWS_WRITTEN_GUARD));
  let dispatches = 0;
  try {
    const answer = await retryWithBackoff(
      () => {
        dispatches += 1;
        return run();
      },
      (thrown) => retry && classifyD1Error(thrown, { guarded }).kind === "transient",
      policy,
    );
    const cost = costOf(answer.metas);
    const servedBy = servedByOf(answer.metas);
    const meta = {
      attempts: dispatches - 1 + totalAttemptsOf(answer.metas),
      ...(cost === undefined ? {} : { cost }),
      ...(servedBy === undefined ? {} : { servedBy }),
    };
    return { ok: true, data: answer.data, meta };
  } catch (thrown) {
    return { ok: false, error: classifyD1Error(thrown, { guarded, attempts: dispatches }), meta: { attempts: dispatches } };
  }
}

/** Creates a D1Client accepting only SqlFragment — raw string SQL is rejected by the type system, so bind parameters are enforced by construction. @public */
export function createD1Client(db: D1Queryable, options?: D1ClientOptions): D1Client {
  const context = {
    logger: options?.logger ?? createLogger("storage/db", { channels: [] }),
    policy: { ...D1_RETRY_POLICY, ...options?.retry },
    slowQueryMs: options?.slowQueryMs,
  };

  return {
    batch<T = unknown>(fragments: SqlFragment[], writeOptions?: D1WriteOptions) {
      return call("batch", fragments, writeOptions?.idempotent === true, context, async () => {
        const outcomes = await db.batch<T>(fragments.map((f) => db.prepare(f.text).bind(...f.params)));
        return { data: outcomes.map((res) => ({ results: res.results, ...writtenOf(res.meta) })), metas: outcomes.map((res) => res.meta) };
      });
    },

    execute(fragment: SqlFragment, writeOptions?: D1WriteOptions) {
      return call("execute", [fragment], writeOptions?.idempotent === true, context, async () => {
        const res = await db
          .prepare(fragment.text)
          .bind(...fragment.params)
          .run();
        return { data: writtenOf(res.meta), metas: [res.meta] };
      });
    },

    query<T = unknown>(fragment: SqlFragment) {
      return call("query", [fragment], false, context, async () => {
        const res = await db
          .prepare(fragment.text)
          .bind(...fragment.params)
          .all<T>();
        return { data: res.results, metas: [res.meta] };
      });
    },

    queryOne<T = unknown>(fragment: SqlFragment) {
      // `first()` returns the row alone, without the `meta` that carries D1's own read retries.
      return call("queryOne", [fragment], false, context, async () => {
        const res = await db
          .prepare(fragment.text)
          .bind(...fragment.params)
          .all<T>();
        return { data: res.results[0] ?? null, metas: [res.meta] };
      });
    },
  };
}
