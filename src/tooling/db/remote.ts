import { createCfClient, readRetryAfterMs } from "../cf/api/client";
import { D1_WRITE_PERMISSION, d1DatabasePath } from "../cf/api/endpoints";
import { classifyCfError } from "../cf/api/errors";
import { CF_OPERATIONS } from "../cf/api/operations";
import { CfApiClientError } from "../cf/api/types";
import type { CfClient } from "../cf/api/types";
import { readCfAuth } from "../cf/auth";
import { CliError } from "../cli/errors";
import { isReadOnlyBatch } from "./sql";
import type { D1RestoreAnswer, DbIo, Home } from "./types";

/** How long one D1 REST request may take. @internal */
export const D1_REQUEST_TIMEOUT_MS = 120_000;

/** The longest statement D1 accepts, in UTF-8 bytes. @internal */
export const D1_STATEMENT_MAX_BYTES = 100_000;

/** The largest `/query` body, in UTF-8 bytes, that a batch packs several statements into. @internal */
export const D1_BATCH_MAX_BYTES = 64_000;

/** The most statements a batch packs into one request. @internal */
export const D1_BATCH_MAX_STATEMENTS = 100;

const D1_RESULT_OVER_CAP = /\bresult\b.*\b(?:size|too large)\b.*\b(?:limit|exceed)/i;

const EMPTY_BATCH_BYTES = JSON.stringify({ batch: [] }).length;

function reachDeployed(io: DbIo, home: Home): { client: CfClient; base: string } {
  if (home.databaseId === null) throw new CliError("invalid-args", `${home.label} (${home.database}) has no D1 id to address`);
  const auth = home.auth ?? readCfAuth({});
  return {
    client: createCfClient(auth, io.fetch, D1_REQUEST_TIMEOUT_MS, (ms) => io.sleep(ms)),
    base: d1DatabasePath(auth.accountId, home.databaseId),
  };
}

function where(home: Home): string {
  return `${home.label} (${home.database})`;
}

function refusedDeployed(what: string, home: Home, reason: string): CliError {
  return new CliError("external", `${what} against ${where(home)} failed: ${reason}`);
}

function failedDeployed(what: string, home: Home, e: CfApiClientError): CliError {
  return new CliError("external", `${what} against ${where(home)} failed: ${describeD1Failure(e, home)}`, { cause: e });
}

/** A detail string for a failed D1 REST call against `home`, naming the variable or the config field to check. @internal */
export function describeD1Failure(e: CfApiClientError, home: Home): string {
  const code = e.cfErrors?.[0]?.code;
  switch (classifyCfError(e)) {
    case "auth":
      return `Cloudflare refused the --api-token — it is invalid, or lacks ${D1_WRITE_PERMISSION}${code === undefined ? "" : ` · code ${code}`}`;
    case "not-found":
      return `no D1 database ${home.databaseId} in the account --account-id names — check ${home.place === "preview" ? "preview_database_id" : "database_id"}`;
    case "network":
      return `network error — ${e.message}`;
    case "other":
      return `${e.message}${code === undefined ? "" : ` (Cloudflare error ${code})`}`;
  }
}

function packD1Batches(statements: readonly string[]): string[][] {
  const encoder = new TextEncoder();
  const chunks: string[][] = [];
  let bytes = EMPTY_BATCH_BYTES;
  for (const sql of statements) {
    const entryBytes = encoder.encode(JSON.stringify({ sql })).length;
    const open = chunks[chunks.length - 1];
    if (open !== undefined && open.length < D1_BATCH_MAX_STATEMENTS && bytes + 1 + entryBytes <= D1_BATCH_MAX_BYTES) {
      open.push(sql);
      bytes += 1 + entryBytes;
      continue;
    }
    chunks.push([sql]);
    bytes = EMPTY_BATCH_BYTES + entryBytes;
  }
  return chunks;
}

/** Statements against a deployed home in as few batch requests as D1's limits allow, answering each statement's rows in order. @internal */
export async function queryDeployed(io: DbIo, home: Home, statements: readonly string[], what: string): Promise<Record<string, unknown>[][]> {
  const encoder = new TextEncoder();
  const oversized = statements.findIndex((sql) => encoder.encode(sql).length > D1_STATEMENT_MAX_BYTES);
  if (oversized !== -1) {
    const bytes = encoder.encode(statements[oversized] ?? "").length;
    throw refusedDeployed(what, home, `statement ${oversized + 1} is ${bytes} bytes, over D1's ${D1_STATEMENT_MAX_BYTES}-byte statement limit`);
  }
  const readOnly = isReadOnlyBatch(statements);
  const chunks = packD1Batches(statements);
  if (!readOnly && chunks.length > 1) {
    throw refusedDeployed(what, home, `a batch holding a write has to go as one request, and these ${statements.length} statements exceed one`);
  }
  const { client, base } = reachDeployed(io, home);
  const operation = readOnly ? CF_OPERATIONS.readD1Database : CF_OPERATIONS.queryD1Database;
  const answers: Record<string, unknown>[][] = [];
  for (const chunk of chunks) {
    const answered = await client.post(`${base}/query`, { batch: chunk.map((sql) => ({ sql })) }, operation);
    if (!answered.ok) throw failedDeployed(what, home, answered.error);
    const unsuccessful = answered.data.findIndex((statement) => !statement.success);
    if (unsuccessful !== -1) throw refusedDeployed(what, home, `D1 reported statement ${answers.length + unsuccessful + 1} unsuccessful`);
    answers.push(...answered.data.map((statement) => statement.results));
  }
  return answers;
}

/** Whether `error` is D1 refusing a query whose result exceeds its result size cap. @internal */
export function isD1ResultOverCap(error: unknown): boolean {
  if (!(error instanceof CliError) || !(error.cause instanceof CfApiClientError) || error.cause.kind !== "api") return false;
  return (error.cause.cfErrors ?? []).some((cfError) => D1_RESULT_OVER_CAP.test(cfError.message));
}

/** One body of SQL, however many statements it holds, sent to a deployed home as one request. @internal */
export async function executeDeployed(io: DbIo, home: Home, sql: string, what: string): Promise<void> {
  const { client, base } = reachDeployed(io, home);
  const answered = await client.post(`${base}/query`, { sql }, CF_OPERATIONS.queryD1Database);
  if (!answered.ok) throw failedDeployed(what, home, answered.error);
  const unsuccessful = answered.data.findIndex((statement) => !statement.success);
  if (unsuccessful !== -1) throw refusedDeployed(what, home, `D1 reported statement ${unsuccessful + 1} unsuccessful`);
}

const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function zoneOffsetMinutes(zone: string): number {
  if (zone === "Z") return 0;
  const digits = zone.replace(":", "");
  const minutes = Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5));
  return digits.startsWith("-") ? -minutes : minutes;
}

// `Date` rolls a field that does not exist over into the next one, so 2026-02-30 would restore 2 March.
function holdsTypedFields(text: string, instant: Date): boolean {
  const typed = CALENDAR.exec(text);
  if (typed === null) return true;
  const [, year, month, day, hours, minutes, seconds, zone] = typed;
  const inZone = hours === undefined || zone !== undefined;
  const at = zone === undefined ? instant : new Date(instant.getTime() + zoneOffsetMinutes(zone) * 60_000);
  const read = inZone
    ? [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()]
    : [at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()];
  return [year, month, day, hours, minutes, seconds].every((field, index) => field === undefined || Number(field) === read[index]);
}

function toIsoInstant(text: string): string {
  const instant = /^\d{1,10}$/.test(text) ? new Date(Number(text) * 1000) : new Date(text);
  if (Number.isNaN(instant.getTime()) || !holdsTypedFields(text, instant)) {
    throw new CliError("invalid-args", `--timestamp ${JSON.stringify(text)} is not a date-time`);
  }
  return instant.toISOString();
}

/** The Time Travel bookmark of a deployed home for now, or for `timestamp`. @internal */
export async function readDeployedBookmark(io: DbIo, home: Home, timestamp?: string): Promise<string> {
  const { client, base } = reachDeployed(io, home);
  const query = timestamp === undefined ? "" : `?${new URLSearchParams({ timestamp: toIsoInstant(timestamp) }).toString()}`;
  const answered = await client.get(`${base}/time_travel/bookmark${query}`, CF_OPERATIONS.getD1Bookmark);
  if (!answered.ok) throw failedDeployed("time-travel info", home, answered.error);
  return answered.data.bookmark;
}

function describeRateLimit(io: DbIo, retryAfter: string | undefined): string {
  const now = io.now().getTime();
  const waitMs = readRetryAfterMs(retryAfter ?? null, now);
  const next = waitMs === undefined ? "try again in a few minutes" : `the next is allowed after ${new Date(now + waitMs).toISOString()}`;
  return `not restored — D1 rate-limited the restore; ${next}`;
}

function readRestoreFailure(io: DbIo, home: Home, e: CfApiClientError): D1RestoreAnswer {
  if (e.kind === "network") return { kind: "unknown", reason: e.message };
  const accepted = e.statusCode !== undefined && e.statusCode >= 200 && e.statusCode < 300;
  if (accepted && (e.kind === "parse" || e.kind === "schema")) return { kind: "unreadable" };
  if (accepted) return { kind: "unknown", reason: `D1 answered HTTP ${e.statusCode} with a failure envelope` };
  if (e.statusCode === 429) throw refusedDeployed("time-travel restore", home, describeRateLimit(io, e.retryAfter));
  if (e.statusCode !== undefined && e.statusCode >= 500) return { kind: "unknown", reason: `D1 answered HTTP ${e.statusCode}` };
  throw failedDeployed("time-travel restore", home, e);
}

/** Sends a deployed home's restore to a bookmark or a timestamp once, answering what D1 replied unless it refused. @internal */
export async function restoreDeployedBookmark(io: DbIo, home: Home, point: { bookmark: string } | { timestamp: string }): Promise<D1RestoreAnswer> {
  const { client, base } = reachDeployed(io, home);
  const query = new URLSearchParams("bookmark" in point ? { bookmark: point.bookmark } : { timestamp: toIsoInstant(point.timestamp) });
  const answered = await client.post(`${base}/time_travel/restore?${query.toString()}`, undefined, CF_OPERATIONS.restoreD1Bookmark);
  if (!answered.ok) return readRestoreFailure(io, home, answered.error);
  return { kind: "restored", previousBookmark: answered.data.previous_bookmark ?? null };
}
