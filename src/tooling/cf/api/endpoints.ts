import type { CfTokenPermission } from "./types";

const acct = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

/** Worker script settings — GET returns metadata and bindings; PATCH takes a multipart body. */
export const workerSettings = (accountId: string, scriptName: string) =>
  `${acct(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`;

/** The account's Worker scripts — GET lists each with its `id` (the script name) and `tag`. */
export const workerScripts = (accountId: string) => `${acct(accountId)}/workers/scripts`;

/** A Worker's Workers Builds settings, addressed by script tag — GET reads them; PATCH merges into them. */
export const workerBuildSettings = (accountId: string, tag: string) => `${acct(accountId)}/builds/workers/${encodeURIComponent(tag)}`;

/** Worker secrets — GET lists `{ name, type }`; PUT upserts one. Values are never returned. */
export const workerSecrets = (accountId: string, scriptName: string) =>
  `${acct(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`;

/** The account's D1 databases — GET lists them; POST creates one. */
export const d1Path = (accountId: string) => `${acct(accountId)}/d1/database`;

/** One D1 database by UUID — the base of its query, export and time_travel operations. */
export const d1DatabasePath = (accountId: string, databaseId: string) => `${d1Path(accountId)}/${encodeURIComponent(databaseId)}`;

/** One R2 bucket's object lifecycle rules — GET reads them; PUT replaces the whole list. */
export const r2LifecyclePath = (accountId: string, bucket: string) => `${acct(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`;

/** One R2 bucket's objects — GET lists them a page at a time, by prefix and cursor. */
export const r2ObjectsPath = (accountId: string, bucket: string) => `${acct(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects`;

/** One R2 object, each `/`-separated segment of its key encoded — GET streams its body; PUT replaces it. */
export const r2ObjectPath = (accountId: string, bucket: string, key: string) =>
  `${r2ObjectsPath(accountId, bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;

const zone = (zoneId: string) => `/zones/${encodeURIComponent(zoneId)}`;

/** The phase entry point ruleset for a zone — GET reads the latest version, PUT replaces it. */
export const zoneRulesetEntrypoint = (zoneId: string, phase: string) => `${zone(zoneId)}/rulesets/phases/${encodeURIComponent(phase)}/entrypoint`;

// `http_request_dynamic_redirect` is the first application-layer request phase and runs nine phases
// ahead of `http_request_firewall_custom`, so a terminating redirect answers before the WAF sees it.
/** The zone phases this tool writes. */
export const ZONE_PHASES = {
  /** Single Redirects. First application-layer request phase. */
  redirect: "http_request_dynamic_redirect",
  /** WAF custom rules. Runs after `ddos_l7`, before `http_ratelimit`. */
  firewall: "http_request_firewall_custom",
} as const;

// HTTP status is not a reliable discriminator here: an authentication failure arrives as 400 and a
// missing target as 404, so classification keys off the envelope `code` and treats status as a hint.
/** The Cloudflare error codes each failure class is recognised by. */
export const CF_ERROR_CODES = {
  /** The addressed object does not exist, or the path could not be routed to it. */
  notFound: [7000, 7003, 10009] as const,
  /** Credentials are missing, malformed, or lack the scope for this call. */
  auth: [9106, 9107, 9109, 10000] as const,
} as const;

/** The API-token permission a Worker's settings and secrets need. */
export const WORKER_PERMISSION: CfTokenPermission = { name: "Workers Scripts", grants: "Read to report, Edit to change" };

/** The API-token permission the Workers Builds API needs, which the dashboard labels "Workers Builds Configuration". */
export const WORKERS_CI_PERMISSION: CfTokenPermission = {
  name: "Workers CI",
  grants: "Read to report, Write to change, on a user-scoped token — an account-scoped one is refused as invalid",
};

/** The API-token permission an R2 object read or write needs, as the dashboard names it. */
export const R2_PERMISSION = "Account → Workers R2 Storage → Edit";

/** The API-token permission a D1 write needs, as the dashboard names it. */
export const D1_WRITE_PERMISSION = "Account → D1 → Edit";
