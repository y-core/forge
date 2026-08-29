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
// Zone rulesets (Ruleset Engine)
// ---------------------------------------------------------------------------

const zone = (zoneId: string) => `/zones/${encodeURIComponent(zoneId)}`;

/**
 * The **phase entry point ruleset** for a zone. GET reads the latest version;
 * PUT replaces it.
 *
 * These are the only zone paths this tool addresses, and they are phase-addressed
 * rather than id-addressed — no `GET /rulesets` listing step is needed to resolve
 * an id, and an entry point ruleset that does not exist yet is created by the
 * first write.
 *
 * **PUT replaces the whole `rules` array.** Any rule omitted from the body is
 * deleted, which is exactly what makes reconciliation declarative and idempotent —
 * and exactly why a hand-authored dashboard rule in the same phase does not
 * survive a `--commit`. The additive `POST .../rulesets/{id}/rules` alternative is
 * deliberately not used. Send only `description` and `rules`: `name` and `type`
 * are not updatable and must be omitted.
 *
 * [D] developers.cloudflare.com/ruleset-engine/rulesets-api/update/ and
 *     /ruleset-engine/rulesets-api/endpoints/ (2026-08-29). Sourced from
 *     documentation, not from wrangler — wrangler does not speak to this API at
 *     all — so the shapes here carry less weight than the [W]-marked ones above
 *     and should be re-checked against a live response on first use.
 */
export const zoneRulesetEntrypoint = (zoneId: string, phase: string) => `${zone(zoneId)}/rulesets/phases/${encodeURIComponent(phase)}/entrypoint`;

/**
 * The two phases this tool writes, and the one fact about their order that
 * changes a design decision.
 *
 * **`http_request_dynamic_redirect` runs before `http_request_firewall_custom`** —
 * it is the *first* application-layer request phase, and custom rules sit nine
 * phases later, after `ddos_l7`. A redirect is a terminating action, so a `www`
 * request is answered with its 301 and never reaches the WAF at all.
 *
 * The consequence for the allow-list expression: the `http.host eq "<apex>"`
 * clause is **defence in depth, not load-bearing**. It was specified on the
 * assumption that the WAF might see `www` traffic first; it does not. Keep the
 * clause — it scopes the rule to the host whose surface was actually enumerated —
 * but do not treat its absence as an outage risk for the `www` redirect.
 *
 * `http_request_redirect` is a *different* phase (account-level Bulk Redirects)
 * and is not the one single redirects use.
 *
 * [D] developers.cloudflare.com/ruleset-engine/reference/phases-list/ and
 *     /waf/feature-interoperability/ (2026-08-29).
 */
export const ZONE_PHASES = {
  /** Single Redirects. First application-layer request phase. */
  redirect: "http_request_dynamic_redirect",
  /** WAF custom rules. Runs after `ddos_l7`, before `http_ratelimit`. */
  firewall: "http_request_firewall_custom",
} as const;

/**
 * Plan limits a route-derived expression can actually reach, and the token
 * permissions each phase needs.
 *
 * **Expression length is capped at 4096 characters per rule**, on every plan;
 * exceeding it fails the write with code 20127 rather than truncating. This is
 * the limit a generated allow-list grows into, so builders must check it before
 * the request rather than letting the API reject the deploy.
 *
 * **Rule count per phase** is plan-scoped: 5 on Free, 20 on Pro, 100 on Business.
 * A generated allow-list is one rule, so the ceiling that binds first is the
 * expression length, not the count.
 *
 * **Token permissions** are per-phase and no single one covers both: the firewall
 * phase needs Zone → *Zone WAF: Edit*, the redirect phase needs Zone →
 * *Dynamic Redirect: Edit*. Both also need Zone → *Zone: Read*. One token may of
 * course carry all three.
 *
 * [D] developers.cloudflare.com/waf/custom-rules/ and
 *     /rules/url-forwarding/single-redirects/create-api/ (2026-08-29).
 */
export const ZONE_EXPRESSION_MAX_CHARS = 4096;

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
