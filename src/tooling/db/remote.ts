import { createCfClient } from "../cf/api/client";
import { D1_WRITE_PERMISSION, d1DatabasePath } from "../cf/api/endpoints";
import { classifyCfError } from "../cf/api/errors";
import { CF_OPERATIONS } from "../cf/api/operations";
import type { CfApiClientError, CfClient } from "../cf/api/types";
import { readCfAuth } from "../cf/auth";
import { CliError } from "../cli/errors";
import type { D1ExportPart, DbIo, Home } from "./types";

/** How long one D1 REST request may take, an export poll included. @internal */
export const D1_REQUEST_TIMEOUT_MS = 120_000;

function reachDeployed(io: DbIo, home: Home): { client: CfClient; base: string } {
  if (home.databaseId === null) throw new CliError("invalid-args", `${home.label} (${home.database}) has no D1 id to address`);
  const auth = home.auth ?? readCfAuth({});
  return { client: createCfClient(auth, io.fetch, D1_REQUEST_TIMEOUT_MS), base: d1DatabasePath(auth.accountId, home.databaseId) };
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

/** Statements against a deployed home as one batch request, answering each statement's rows in order. @internal */
export async function queryDeployed(io: DbIo, home: Home, statements: readonly string[], what: string): Promise<Record<string, unknown>[][]> {
  const { client, base } = reachDeployed(io, home);
  const answered = await client.post(`${base}/query`, { batch: statements.map((sql) => ({ sql })) }, CF_OPERATIONS.queryD1Database);
  if (!answered.ok) throw failedDeployed(what, home, answered.error);
  const unsuccessful = answered.data.findIndex((statement) => !statement.success);
  if (unsuccessful !== -1) throw refusedDeployed(what, home, `D1 reported statement ${unsuccessful + 1} unsuccessful`);
  return answered.data.map((statement) => statement.results);
}

/** One body of SQL, however many statements it holds, sent to a deployed home as one request. @internal */
export async function executeDeployed(io: DbIo, home: Home, sql: string, what: string): Promise<void> {
  const { client, base } = reachDeployed(io, home);
  const answered = await client.post(`${base}/query`, { sql }, CF_OPERATIONS.queryD1Database);
  if (!answered.ok) throw failedDeployed(what, home, answered.error);
  const unsuccessful = answered.data.findIndex((statement) => !statement.success);
  if (unsuccessful !== -1) throw refusedDeployed(what, home, `D1 reported statement ${unsuccessful + 1} unsuccessful`);
}

/** Exports a deployed home's schema or data to `output` through D1's polled export, answering the bookmark it was taken at. @internal */
export async function exportDeployed(io: DbIo, home: Home, output: string, part: D1ExportPart): Promise<string | null> {
  const { client, base } = reachDeployed(io, home);
  const dumpOptions = part === "schema" ? { no_data: true } : { no_schema: true };
  let current: string | undefined;
  for (;;) {
    const body = { output_format: "polling", dump_options: dumpOptions, ...(current === undefined ? {} : { current_bookmark: current }) };
    const answered = await client.post(`${base}/export`, body, CF_OPERATIONS.exportD1Database);
    if (!answered.ok) throw failedDeployed("export", home, answered.error);
    const reply = answered.data;
    if (reply.status === "error") throw refusedDeployed("export", home, reply.error || "D1 reported an error and no detail");
    if (reply.status === "active") {
      if (current !== undefined && reply.at_bookmark !== current) {
        throw refusedDeployed("export", home, "D1 moved the export's bookmark while it was being polled");
      }
      current = reply.at_bookmark;
      continue;
    }
    await downloadExport(io, home, reply.result.signed_url, output);
    return reply.at_bookmark ?? current ?? null;
  }
}

// A signed URL is a bearer credential: it is never quoted, logged or carried as a cause, and it is fetched without the API token.
async function downloadExport(io: DbIo, home: Home, signedUrl: string, output: string): Promise<void> {
  const what = `downloading the export of ${where(home)}`;
  if (!signedUrl.startsWith("https://")) throw new CliError("external", `${what} was refused: D1 answered a signed URL that is not HTTPS`);
  let res: Response;
  try {
    res = await io.fetch(signedUrl);
  } catch {
    throw new CliError("external", `${what} failed: network error`);
  }
  if (!res.ok) throw new CliError("external", `${what} failed (HTTP ${res.status})`);
  io.writeText(output, await res.text());
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

/** Restores a deployed home to a bookmark or a timestamp, answering the bookmark it held before. @internal */
export async function restoreDeployedBookmark(io: DbIo, home: Home, point: { bookmark: string } | { timestamp: string }): Promise<string> {
  const { client, base } = reachDeployed(io, home);
  const query = new URLSearchParams("bookmark" in point ? { bookmark: point.bookmark } : { timestamp: toIsoInstant(point.timestamp) });
  const answered = await client.post(`${base}/time_travel/restore?${query.toString()}`, undefined, CF_OPERATIONS.restoreD1Bookmark);
  if (!answered.ok) throw failedDeployed("time-travel restore", home, answered.error);
  return answered.data.previous_bookmark;
}
