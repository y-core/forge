import type { RedirectSpec, ZoneAction, ZoneRule, ZoneSurface } from "./types";

/** Path prefixes the platform reserves, unioned into every allow-list whether a caller asks for them or not. @public */
export const RESERVED_PREFIXES: readonly string[] = ["/cdn-cgi/", "/.well-known/"];

/** The per-rule expression ceiling Cloudflare enforces, on every plan. @public */
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

/** Builds the predicate that is true for every request the served surface accounts for. @public */
export function buildAllowExpression(surface: ZoneSurface): string {
  const exact = unique([...surface.paths, ...surface.files]);
  const prefixes = unique([...surface.prefixes, ...RESERVED_PREFIXES]);

  // The reserved prefixes are always present, so the clause list is never empty; an empty *caller*
  // surface is the real signal that the route table was never read.
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

/** Builds the WAF custom rule that actions everything the surface does *not* account for. @public */
export function buildAllowRule(surface: ZoneSurface, options: AllowRuleOptions): ZoneRule {
  const expression = `(http.host eq ${quote(surface.apex)} and not (${buildAllowExpression(surface)}))`;
  assertWithinLimit(expression, "buildAllowRule");
  return { action: options.action, expression, description: options.description ?? `Allow-list: ${surface.apex} served surface`, enabled: true };
}

/** Builds the single-redirect rule that sends every `from` host to the apex, preserving path and query string. @public */
export function buildRedirectRule(spec: RedirectSpec): ZoneRule {
  const hosts = unique(spec.from);
  if (hosts.length === 0) throw new Error("buildRedirectRule: no source host to redirect from.");

  for (const host of hosts) {
    if (host === spec.apex) throw new Error(`buildRedirectRule: "${host}" is the apex itself — that rule would redirect to itself.`);
    if (!host.endsWith(`.${spec.apex}`)) {
      throw new Error(
        `buildRedirectRule: "${host}" is not within "${spec.apex}". This rule consolidates a zone onto its apex, so every source must be a subdomain of it.`,
      );
    }
  }

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
