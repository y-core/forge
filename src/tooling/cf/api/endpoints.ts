const acct = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

/** Worker script settings — GET returns metadata and bindings; PATCH takes a multipart body. */
export const workerSettings = (accountId: string, scriptName: string) =>
  `${acct(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`;

/** Worker secrets — GET lists `{ name, type }`; PUT upserts one. Values are never returned. */
export const workerSecrets = (accountId: string, scriptName: string) =>
  `${acct(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`;

/** The account's D1 databases — GET lists them; POST creates one. */
export const d1Path = (accountId: string) => `${acct(accountId)}/d1/database`;

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
export const WORKER_PERMISSION = "Workers Scripts";

/** The API-token permission a D1 write needs, as the dashboard names it. */
export const D1_WRITE_PERMISSION = "Account → D1 → Edit";
