import { describe, expect, it } from "bun:test";

import { createLogger } from "../../logging/logger";
import type { LogRecord } from "../../logging/types";
import { countQuery, createQueryTally } from "./budget";

function recording(): { logger: ReturnType<typeof createLogger>; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { logger: createLogger("storage/db", { channels: [{ write: (record) => void records.push(record) }] }), records };
}

const warned = (records: readonly LogRecord[]) =>
  records.map((record) => [record.level, record.message, record.data?.reason, record.data?.sql ?? null, record.data?.runs ?? null]);

describe("countQuery()", () => {
  it("warns once, on the run past `repeats`, naming the statement", () => {
    const { logger, records } = recording();
    const tally = createQueryTally();
    for (let i = 0; i < 6; i += 1) countQuery(tally, "SELECT * FROM t WHERE id = ?", { repeats: 3, queries: 100 }, logger);
    expect(warned(records)).toEqual([["warn", "d1.request.budget", "repeats", "SELECT * FROM t WHERE id = ?", 4]]);
  });

  it("counts each statement text apart", () => {
    const { logger, records } = recording();
    const tally = createQueryTally();
    for (const sql of ["SELECT a", "SELECT b", "SELECT a", "SELECT b"]) countQuery(tally, sql, { repeats: 2, queries: 100 }, logger);
    expect(records).toEqual([]);
  });

  it("warns once when the request's calls reach `queries`, batches included", () => {
    const { logger, records } = recording();
    const tally = createQueryTally();
    for (let i = 0; i < 5; i += 1) countQuery(tally, i % 2 === 0 ? null : `SELECT ${i}`, { repeats: 10, queries: 3 }, logger);
    expect([warned(records), records[0]?.data?.queries, tally.queries]).toEqual([[["warn", "d1.request.budget", "queries", null, null]], 3, 5]);
  });

  it("never counts a batch as a repeat of itself", () => {
    const { logger, records } = recording();
    const tally = createQueryTally();
    for (let i = 0; i < 5; i += 1) countQuery(tally, null, { repeats: 1, queries: 100 }, logger);
    expect([records, tally.runs.size]).toEqual([[], 0]);
  });
});
