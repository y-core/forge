import { isDynamicRoute } from "./dynamic-route";
import type { RedirectSpec, ZonePatternRefusal, ZoneRule, ZoneSurface } from "./types";
import type { AllowRuleOptions } from "./types";

/** Path prefixes the platform reserves, unioned into every allow-list whether a caller asks for them or not. @public */
export const RESERVED_PREFIXES: readonly string[] = ["/cdn-cgi/", "/.well-known/"];

/** The per-rule expression ceiling Cloudflare enforces, on every plan. @public */
export const EXPRESSION_MAX_CHARS = 4096;

const REFUSAL_MESSAGES: Record<ZonePatternRefusal, string> = {
  "catch-all":
    "the route's first segment is dynamic, so it would match nearly every path; give it a static first segment or leave it out of `paths`",
  host: "the route names a host; the allow-list matches paths on the apex only",
  search: "the route carries a search constraint; the allow-list matches paths only",
  malformed: "not a route pattern",
  encoding:
    'holds a space, a non-ASCII character or one of " # < > ? ` { }, which a browser percent-encodes before the edge sees it; keep the path ASCII or write it percent-encoded',
};

const ROUTE_PARAM_NAME = /^[a-zA-Z_$][a-zA-Z_$0-9]*/;

/** Thrown when a route source or path cannot be expressed as a zone allow-list clause without opening the zone or misreading it. @public */
export class ZonePatternError extends Error {
  readonly source: string;
  readonly reason: ZonePatternRefusal;

  constructor(source: string, reason: ZonePatternRefusal) {
    super(`buildAllowExpression: "${source}" ${REFUSAL_MESSAGES[reason]}`);
    this.name = "ZonePatternError";
    this.source = source;
    this.reason = reason;
  }
}

type RouteToken = { text: string } | "*";

const STATIC_FIRST_SEGMENT = /^\/[^/]+\//;

const BROWSER_ENCODED = /[^\x21-\x7e]|["#<>?`{}]/u;

/** @internal */
function assertVerbatimPath(path: string): string {
  if (BROWSER_ENCODED.test(path)) throw new ZonePatternError(path, "encoding");
  return path;
}

/** @internal */
function appendRouteToken(variant: readonly RouteToken[], token: RouteToken): RouteToken[] {
  if (token === "*" && variant.at(-1) === "*") return [...variant];
  return [...variant, token];
}

/** @internal */
function joinRouteVariants(head: readonly RouteToken[], tail: readonly RouteToken[]): RouteToken[] {
  return tail.reduce<RouteToken[]>(appendRouteToken, [...head]);
}

/** Expands one route source, up to its closing `)` when nested, into every token sequence its optionals allow. @internal */
function expandRouteSource(source: string, start: number, nested: boolean): { variants: RouteToken[][]; next: number } {
  let variants: RouteToken[][] = [[]];
  const append = (token: RouteToken): void => {
    variants = variants.map((variant) => appendRouteToken(variant, token));
  };

  let i = start;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === "\\") {
      if (i + 1 >= source.length) throw new ZonePatternError(source, "malformed");
      append({ text: source.charAt(i + 1) });
      i += 2;
    } else if (char === ":") {
      const name = ROUTE_PARAM_NAME.exec(source.slice(i + 1));
      if (name === null) throw new ZonePatternError(source, "malformed");
      append("*");
      i += 1 + name[0].length;
    } else if (char === "*") {
      const name = ROUTE_PARAM_NAME.exec(source.slice(i + 1));
      append("*");
      i += 1 + (name?.[0].length ?? 0);
    } else if (char === "(") {
      const inner = expandRouteSource(source, i + 1, true);
      variants = [...variants, ...variants.flatMap((variant) => inner.variants.map((tail) => joinRouteVariants(variant, tail)))];
      i = inner.next;
    } else if (char === ")") {
      if (!nested) throw new ZonePatternError(source, "malformed");
      return { variants, next: i + 1 };
    } else {
      append({ text: char });
      i += 1;
    }
  }

  if (nested) throw new ZonePatternError(source, "malformed");
  return { variants, next: i };
}

/** @internal */
function routeLiteralText(variant: readonly RouteToken[]): string {
  return variant.map((token) => (token === "*" ? "" : token.text)).join("");
}

/** @internal */
function renderStrictWildcard(variant: readonly RouteToken[]): string {
  return variant.map((token) => (token === "*" ? "*" : token.text.replace(/[\\*]/g, "\\$&"))).join("");
}

/** Splits a dynamic route source into the exact paths and `strict wildcard` patterns that match it. @internal */
function routeWildcards(source: string): { exact: string[]; wildcards: string[] } {
  if (source.includes("://")) throw new ZonePatternError(source, "host");
  if (source.includes("?")) throw new ZonePatternError(source, "search");
  assertVerbatimPath(source);

  const exact: string[] = [];
  const wildcards: string[] = [];
  for (const variant of expandRouteSource(source, 0, false).variants) {
    if (variant.length === 0) {
      exact.push("/");
    } else if (!variant.includes("*")) {
      exact.push(routeLiteralText(variant));
    } else {
      if (!STATIC_FIRST_SEGMENT.test(routeLiteralText(variant.slice(0, variant.indexOf("*"))))) throw new ZonePatternError(source, "catch-all");
      wildcards.push(renderStrictWildcard(variant));
    }
  }
  return { exact, wildcards };
}

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
  const expanded = surface.paths.filter(isDynamicRoute).map(routeWildcards);
  const staticPaths = surface.paths.filter((path) => !isDynamicRoute(path));
  const exact = unique([...[...staticPaths, ...surface.files].map(assertVerbatimPath), ...expanded.flatMap((route) => route.exact)]);
  const wildcards = unique(expanded.flatMap((route) => route.wildcards));
  const prefixes = unique([...surface.prefixes.map(assertVerbatimPath), ...RESERVED_PREFIXES]);

  if (exact.length === 0 && wildcards.length === 0 && surface.prefixes.length === 0) {
    throw new Error("buildAllowExpression: the served surface is empty — the resulting rule would action every real request.");
  }

  const clauses: string[] = [];
  if (exact.length > 0) clauses.push(`http.request.uri.path in {${exact.map(quote).join(" ")}}`);
  for (const wildcard of wildcards) clauses.push(`http.request.uri.path strict wildcard ${quote(wildcard)}`);
  for (const prefix of prefixes) clauses.push(`starts_with(http.request.uri.path, ${quote(prefix)})`);

  const expression = clauses.join(" or ");
  assertWithinLimit(expression, "buildAllowExpression");
  return expression;
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
  // The apex is quoted as part of the whole literal rather than inside one: a `"` in the apex
  // would otherwise close the string and let the rest of it run as Ruleset Engine expression.
  const target = `concat(${quote(`https://${spec.apex}`)}, http.request.uri.path)`;
  assertWithinLimit(target, "buildRedirectRule");
  return {
    action: "redirect",
    expression,
    description: `Redirect ${hosts.join(", ")} to ${spec.apex}`,
    enabled: true,
    action_parameters: { from_value: { status_code: spec.statusCode ?? 301, target_url: { expression: target }, preserve_query_string: true } },
  };
}
