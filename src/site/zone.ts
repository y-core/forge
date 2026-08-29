import type { RedirectSpec, ZoneAction, ZoneRule, ZoneSurface } from "./types";

/**
 * Path prefixes the platform reserves, unioned into every allow-list whether a caller asks for
 * them or not.
 *
 * `/cdn-cgi/` is Cloudflare's own path, and Turnstile's challenge platform is served from it — a
 * rule that filters it takes down every form on the site. `/.well-known/` carries ACME/DCV and
 * the protocol paths that keep arriving. Neither is application surface, so neither shows up in
 * a route table, which is exactly why forge supplies them rather than trusting a consumer to.
 *
 * @public
 */
export const RESERVED_PREFIXES: readonly string[] = ["/cdn-cgi/", "/.well-known/"];

/**
 * The per-rule expression ceiling, on every Cloudflare plan. Exceeding it fails the write with
 * error 20127 rather than truncating, so a generated expression is checked here — before the
 * request — instead of at the API.
 *
 * @public
 */
export const EXPRESSION_MAX_CHARS = 4096;

/** @internal */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** @internal */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** @internal */
function assertWithinLimit(expression: string, what: string): void {
  if (expression.length > EXPRESSION_MAX_CHARS) {
    throw new Error(
      `${what}: expression is ${expression.length} characters, over Cloudflare's per-rule limit of ${EXPRESSION_MAX_CHARS}. ` +
        `Collapse exact paths into a prefix, or move the surface into a Cloudflare list.`,
    );
  }
}

/**
 * Builds the predicate that is true for every request the served surface accounts for: an exact
 * application path, an exact asset-root file, or anything under an allowed prefix.
 *
 * The {@link RESERVED_PREFIXES} are always included. The expression is *not* scoped to a host —
 * that is the caller's clause, since a host predicate belongs to the rule rather than to the
 * surface.
 *
 * @public
 */
export function buildAllowExpression(surface: ZoneSurface): string {
  const exact = unique([...surface.paths, ...surface.files]);
  const prefixes = unique([...surface.prefixes, ...RESERVED_PREFIXES]);

  // The reserved prefixes are always present, so a clause list is never empty — but a surface with
  // no application paths, files or prefixes of its own means the route table was not read, and the
  // resulting rule would action every real request on the site.
  if (exact.length === 0 && surface.prefixes.length === 0) {
    throw new Error("buildAllowExpression: the served surface is empty — the resulting rule would action every real request.");
  }

  const clauses: string[] = [];
  if (exact.length > 0) clauses.push(`http.request.uri.path in {${exact.map(quote).join(" ")}}`);
  for (const prefix of prefixes) clauses.push(`starts_with(http.request.uri.path, ${quote(prefix)})`);

  const expression = clauses.join(" or ");
  assertWithinLimit(expression, "buildAllowExpression");
  return expression;
}

/** What {@link buildAllowRule} needs beyond the surface itself. @public */
export interface AllowRuleOptions {
  /** The terminating action taken on traffic the surface does not account for. */
  action: ZoneAction;
  description?: string;
}

/**
 * Builds the WAF custom rule that actions everything the surface does *not* account for.
 *
 * The rule is scoped to `surface.apex` because that is the only host whose surface was
 * enumerated. That clause is defence in depth rather than load-bearing: `http_request_dynamic_redirect`
 * runs before `http_request_firewall_custom`, so a `www` request is answered with its 301 and
 * never reaches this phase at all.
 *
 * @public
 */
export function buildAllowRule(surface: ZoneSurface, options: AllowRuleOptions): ZoneRule {
  const expression = `(http.host eq ${quote(surface.apex)} and not (${buildAllowExpression(surface)}))`;
  assertWithinLimit(expression, "buildAllowRule");
  return { action: options.action, expression, description: options.description ?? `Allow-list: ${surface.apex} served surface`, enabled: true };
}

/**
 * Builds the single-redirect rule that sends every `from` host to the apex, preserving the path
 * and query string.
 *
 * @public
 */
export function buildRedirectRule(spec: RedirectSpec): ZoneRule {
  const hosts = unique(spec.from);
  if (hosts.length === 0) throw new Error("buildRedirectRule: no source host to redirect from.");

  const expression = `(http.host in {${hosts.map(quote).join(" ")}})`;
  assertWithinLimit(expression, "buildRedirectRule");
  return {
    action: "redirect",
    expression,
    description: `Redirect ${hosts.join(", ")} to ${spec.apex}`,
    enabled: true,
    action_parameters: {
      from_value: {
        status_code: spec.statusCode ?? 301,
        target_url: { expression: `concat("https://${spec.apex}", http.request.uri.path)` },
        preserve_query_string: true,
      },
    },
  };
}
