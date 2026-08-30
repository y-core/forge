# `@y-core/forge/site`

Everything downstream of the route table: what a crawler may index, and what the edge may let
through. A route map already knows the entire served surface, so `robots.txt`, `sitemap.xml` and a
Cloudflare WAF allow-list are all **derived** from it rather than hand-maintained beside it.

Every function here is a pure string or data transform — no `fs`, no `fetch`. The same code serves
a build step, a Worker route, or a CLI.

```typescript
import { defineSiteConfig, renderRobotsTxt, renderSitemapXml } from "@y-core/forge/site";
```

---

## Features

- **Config as data.** `defineSiteConfig` types the default export of a `site.config.ts`;
  `SiteConfigSchema` validates it; `resolveSiteConfig` fills in every optional block.
- **Route-derived sitemaps.** `resolveSitemapEntries` filters a path list down to the URLs a
  sitemap can actually carry — parameterised and wildcard patterns are dropped, because there is
  no single URL they stand for — then decorates each with its configured `changefreq`, `priority`
  and `lastmod`.
- **Plain `string[]` in, no router dependency.** The caller passes
  `routePaths(routes, { method: "GET" })` from [`@y-core/forge/router`](../router/README.md). That
  keeps this namespace a leaf and keeps its schema validating plain data.
- **Zone expression builders.** `buildAllowRule` turns a served surface into the Cloudflare custom
  rule that actions everything the surface does *not* account for; `buildRedirectRule` emits a
  host-to-apex single redirect.
- **Reserved paths forge supplies, not the consumer.** `/cdn-cgi/` and `/.well-known/` are unioned
  into every allow-list whether asked for or not (see [Reserved prefixes](#reserved-prefixes)).

---

## Usage

### Author a site config

```typescript
import { routePaths } from "@y-core/forge/router";
import { defineSiteConfig } from "@y-core/forge/site";
import { routes } from "../src/routes";

export default defineSiteConfig({
  // A build-time artifact is generated once and uploaded. The production origin is the correct
  // constant — a sitemap advertising a dev host would be wrong everywhere that matters.
  origin: "https://example.com",
  pages: routePaths(routes, { method: "GET" }),
  robots: { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/api/"] }], sitemap: true },
  sitemap: {
    exclude: ["/api/*"],
    entries: { "/": { changefreq: "monthly", priority: 1.0 } },
  },
});
```

### Render the two files

```typescript
import { renderRobotsTxt, renderSitemapXml, resolveSiteConfig } from "@y-core/forge/site";

const config = resolveSiteConfig(siteConfig);
await Bun.write("public/robots.txt", renderRobotsTxt(config));
await Bun.write("public/sitemap.xml", renderSitemapXml(config));
```

In practice a consumer does not call these directly: the `site` block of an assets config makes
[`@y-core/forge/assets/build`](../assets/README.md) emit both files as a pipeline step.

### Build the zone rules

```typescript
import { buildAllowRule, buildRedirectRule } from "@y-core/forge/site";

const rule = buildAllowRule(
  {
    apex: "example.com", // in a config, omit `zone.apex` — it defaults to the origin's hostname
    paths: routePaths(routes), // every method — a POST endpoint must not be filtered by a GET-only view
    prefixes: ["/assets/"],
    files: ["/favicon.ico", "/robots.txt", "/sitemap.xml"],
  },
  { action: "managed_challenge" },
);

const redirect = buildRedirectRule({ from: ["www.example.com"], apex: "example.com" });
```

---

## Notes

### Reserved prefixes

`RESERVED_PREFIXES` — `/cdn-cgi/` and `/.well-known/` — are unioned into every allow-list
regardless of what the caller passes. Neither is application surface, so neither appears in a route
table, which is exactly why forge supplies them.

`/cdn-cgi/` is not optional cleanup. It is Cloudflare's own path, and **Turnstile's challenge
platform is served from it** — a rule that filters it takes down every form on the site.

### Why an allow-list, and which direction is safe

A deny-list is a list of substrings a human extends forever. An allow-list is derived from the
route table and needs no maintenance — but it carries the opposite failure mode: it blocks a *real*
route the edge has not been told about, which is a 403 to a genuine user rather than a probe
getting through.

That makes the ordering asymmetric. Allowing a path that does not exist yet is harmless; deploying
a path that is not yet allowed is an outage. **Sync the zone, then push, then deploy** — never the
reverse.

Start the rollout on `managed_challenge` rather than `block`: a legitimate path caught by mistake
gets a challenge a human can pass. Cloudflare's `log` action is Enterprise-only, so this is the
available shakedown. Either action ends the request at the edge, so the saved Worker invocation is
identical from day one.

### The apex is stated once

`zone.apex` is optional and defaults to the origin's hostname. Stating the host twice is how the two
drift, and there is no case for a zone whose apex is not the host the site declares itself served
from.

The redirect follows from the same idea: **every `from` host must be a subdomain of the apex.**
`buildRedirectRule` consolidates a zone onto one hostname — it is not a general URL forwarder. A
source outside the apex could never fire, since the rule is deployed to the apex's own zone, and a
source equal to the apex is a loop. Both are refused when the rule is built.

### The apex host clause is defence in depth

`buildAllowRule` scopes its expression to `surface.apex`, because that is the only host whose
surface was enumerated. It is *not* load-bearing for the `www` redirect:
`http_request_dynamic_redirect` is the first application-layer phase and `http_request_firewall_custom`
runs nine phases later, so a `www` request is answered with its 301 and never reaches the WAF.

### Expression length is the ceiling that binds first

Cloudflare caps a rule expression at 4096 characters on every plan, failing the write with error
20127 rather than truncating. `buildAllowExpression` checks this before the request and names the
two ways out — collapse exact paths into a prefix, or move the surface into a Cloudflare list. Rule
*count* (5 on Free, 20 on Pro, 100 on Business) is not the binding limit, since a generated
allow-list is a single rule.
