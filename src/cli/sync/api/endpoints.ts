// Verified Cloudflare API surface.
//
// Every claim below was checked against one of two primary sources rather than
// against prose documentation, which is stale for several of these shapes:
//
//   [W] wrangler 4.124.0, bundled at
//       node_modules/wrangler/wrangler-dist/cli.js — this is the client Cloudflare
//       itself ships, so its request shapes are the ones the API actually accepts.
//   [P] a live unauthenticated probe of https://api.cloudflare.com/client/v4
//       (2026-08-26), used only to characterise error envelopes.
//
// Handlers should import the path builders here rather than interpolating their
// own, so that a future correction lands in exactly one place.

const acct = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

/**
 * Worker script settings — metadata and bindings.
 *
 * GET returns `{ bindings: CfWorkerBinding[], ... }`; PATCH takes a multipart
 * body whose `settings` part is JSON. [W] `getSettings()`, and the embedded
 * cloudflare-typescript SDK's `workers.scripts.scriptAndVersionSettings`.
 *
 * The binding list is the union of every binding type, discriminated by `type`
 * — `plain_text`, `secret_text`, `ratelimit`, `kv_namespace`, and so on.
 */
export const workerSettings = (accountId: string, scriptName: string) =>
  `${acct(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`;

/** Worker secrets — GET lists `{ name, type }`; PUT upserts one. Values are never returned. */
export const workerSecrets = (accountId: string, scriptName: string) =>
  `${acct(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * A Pages project. Both GET and PATCH address this same path. [W] the Pages
 * `secret put` / `secret bulk` / `secret delete` / `download-config` commands
 * all use `/accounts/${accountId}/pages/projects/${projectName}`.
 *
 * GET yields `{ name, production_branch, deployment_configs: { production, preview }, ... }`.
 *
 * `deployment_configs[env].env_vars` is an **object keyed by variable name**, not
 * an array — each value is `{ value: string; type: "plain_text" | "secret_text" }`.
 *
 * PATCH is a **partial merge**: only the names present in the body are upserted,
 * and a name mapped to `null` is deleted. Variables absent from the body are left
 * alone, so — unlike the Worker settings PATCH — there is no risk of dropping
 * remote variables that the local config does not declare. [W] `pages secret put`
 * sends exactly one key and wrangler documents no read-modify-write around it.
 *
 * `wrangler_config_hash` must be echoed back from the GET alongside `env_vars`;
 * wrangler includes it on every one of these PATCHes.
 */
export const pagesProject = (accountId: string, projectName: string) => `${acct(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;

/**
 * A `secret_text` value is **not readable**. [W] `pages secret list` filters
 * `env_vars` to `type === "secret_text"` and prints the literal string
 * "Value Encrypted" for each; `toEnvironment()` in `pages download-config` reads
 * `envVar.value` only under `type == "plain_text"`.
 *
 * Consequence: for a Pages target, a secret can be compared by name only. Drift
 * detection on the value is not possible, and a row claiming `exists` must say
 * that it means name-only.
 */
export const PAGES_SECRET_VALUE_READABLE = false;

/**
 * Pages `deployment_configs` carries **no rate-limit binding**. [W]
 * `toEnvironment()` enumerates exactly `env_vars`, `kv_namespaces`,
 * `durable_object_namespaces`, `d1_databases`, `r2_buckets`, `services`,
 * `queue_producers`, `analytics_engine_datasets` and `ai_bindings` — there is no
 * `ratelimits` case, whereas the Worker-side `mapWorkerMetadataBindings()` does
 * have `case "ratelimit"`.
 */
export const PAGES_EXPOSES_RATELIMITS = false;

/**
 * The config keys wrangler accepts for a Pages project. [W] `supportedPagesConfigFields`;
 * anything else makes `validateUnsupportedFields()` emit
 * `Configuration file for Pages projects does not support "<field>"`.
 *
 * Notably absent: `ratelimits`. A Pages config declaring a rate limiter is not
 * merely unverifiable — it is rejected by wrangler and binds nothing.
 */
export const PAGES_SUPPORTED_CONFIG_FIELDS = [
  "pages_build_output_dir",
  "name",
  "compatibility_date",
  "compatibility_flags",
  "send_metrics",
  "no_bundle",
  "limits",
  "placement",
  "vars",
  "durable_objects",
  "kv_namespaces",
  "queues", // producers only
  "r2_buckets",
  "d1_databases",
  "vectorize",
  "hyperdrive",
  "services",
  "analytics_engine_datasets",
  "ai",
  "version_metadata",
  "dev",
  "mtls_certificates",
  "browser",
  "upload_source_maps",
] as const;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * There is **no account-level rate-limit namespace API** — nothing to list, and
 * nothing to create.
 *
 * `namespace_id` is not the id of a remote resource. It is an identifier the
 * developer picks: "A string containing a positive integer that uniquely defines
 * this rate limiting namespace within your Cloudflare account (for example,
 * "1001")" — developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/.
 * [W] `validateRateLimitBinding()` only type-checks `name`, `namespace_id` and
 * `simple.{limit,period}` (period restricted to 10 or 60); it performs no lookup.
 *
 * `/zones/{zone_id}/rate_limits` exists but is the deprecated *zone* WAF rate
 * limiting product, superseded by the Ruleset Engine. It is unrelated to the
 * Workers `ratelimits` binding and must not be used for it.
 *
 * A rate-limit binding *is* observable on a deployed **Worker**, as a
 * `{ type: "ratelimit", name, namespace_id, simple: { limit, period } }` entry in
 * {@link workerSettings}. That is the only remote statement about a rate limiter
 * this tool can make, and it is available for Worker targets only.
 */
export const RATELIMIT_NAMESPACE_API = null;

// ---------------------------------------------------------------------------
// Error envelopes
// ---------------------------------------------------------------------------

/**
 * HTTP status is **not** a reliable discriminator; the envelope's error `code` is.
 * Probed live [P]:
 *
 *   - missing credentials      → HTTP 403, code 9106 "Missing X-Auth-Email header"
 *   - malformed bearer token   → HTTP 400, code 9106 "Authentication failed (status: 400)"
 *   - unroutable path          → HTTP 400, code 7000 "No route for that URI"
 *   - unknown object in path   → HTTP 404, code 7003 "Could not route to <path>,
 *                                perhaps your object identifier is invalid?"
 *
 * An authentication failure therefore arrives as HTTP 400, and a missing target as
 * HTTP 404 — so classification keys off `code` first and treats status as a weak
 * fallback only.
 */
export const CF_ERROR_CODES = {
  /** The addressed object does not exist, or the path could not be routed to it. */
  notFound: [7000, 7003, 10009] as const,
  /**
   * Credentials are missing, malformed, or lack the scope for this call.
   *
   * Cloudflare does not separate the two: 10000 "Authentication error" is what an
   * account-scoped endpoint returns both for a token it rejects and for a valid
   * token without the permission that endpoint needs. So a row built from these
   * codes must name both possibilities rather than assert one.
   */
  auth: [9106, 9107, 9109, 10000] as const,
} as const;

/**
 * The API-token permission each deployment surface needs.
 *
 * Named in the failure row because "check your scopes" is not a fix: the Workers
 * token templates do not grant Pages, so a token that reads a Worker's settings
 * fails on a Pages project — which is the common way this error is met.
 */
export const SURFACE_PERMISSIONS = { worker: "Workers Scripts", pages: "Cloudflare Pages" } as const;

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/**
 * `main` and `pages_build_output_dir` are **mutually exclusive** — neither "wins".
 * [W] `validateMainField()` pushes a hard error when a config carrying
 * `pages_build_output_dir` also sets `main`: "Configuration file cannot contain
 * both both "main" and "pages_build_output_dir" configuration keys."
 *
 * So a config with both is already invalid to wrangler. `detectTarget` treats it
 * as a Worker, matching wrangler's own advice to "use `main` if you are deploying
 * a Worker".
 */
export const MAIN_AND_PAGES_OUTPUT_DIR_ARE_EXCLUSIVE = true;
