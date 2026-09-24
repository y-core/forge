---
title: Site Surface Derived From Routes
description: "robots.txt, sitemap.xml and an edge allow-list, all derived from the route map rather than hand-maintained beside it."
audience: consumer
---

# `@y-core/forge/site`

A route map already knows the entire served surface, so what sits downstream of it — what a crawler may index, what a sitemap advertises, and what
the edge lets through — should be **derived** from it rather than hand-maintained beside it.

Reach for it when you are about to write a `robots.txt` by hand, or paste a path list into a Cloudflare rule. Every function here is a pure string
or data transform — no `fs`, no `fetch` — so the same code serves a build step, a Worker route, or a CLI.

```ts
import { buildAllowRule, defineSiteConfig, renderRobotsTxt, renderSitemapXml } from "@y-core/forge/site";
```

---

## Getting started

Author a `site.config.ts` whose page list comes from the router, never from a literal.

```ts
import { routePaths } from "@y-core/forge/router";
import { defineSiteConfig } from "@y-core/forge/site";
import { routes } from "../src/routes";

export default defineSiteConfig({
  // A build-time artifact is generated once and uploaded, so the production origin is the correct
  // constant — a sitemap advertising a dev host would be wrong everywhere that matters.
  origin: "https://example.com",
  pages: routePaths(routes, { method: "GET" }),
  robots: { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/api/"] }], sitemap: true },
  sitemap: { exclude: ["/api/*"], entries: { "/": { changefreq: "monthly", priority: 1.0 } } },
});
```

`pages` is a plain `string[]`, which is what keeps this namespace a leaf and its schema validating plain data. `resolveSiteConfig` fills in every
optional block; `SiteConfigSchema` validates one that did not come through `defineSiteConfig`.

---

## Emitting robots.txt and sitemap.xml

```ts
const config = resolveSiteConfig(siteConfig);
await Bun.write("public/robots.txt", renderRobotsTxt(config));
await Bun.write("public/sitemap.xml", renderSitemapXml(config));
```

In practice you will not call these directly: the `site` block of an assets config makes [`@y-core/forge/tooling/assets`][assets-readme] emit both
files as a pipeline step.

**A parameterised or wildcard route is dropped from the sitemap**, because there is no single URL it stands for. What survives the filter is
decorated with its configured `changefreq`, `priority` and `lastmod`.

---

## Building the zone rules

`buildAllowRule` turns the served surface into a Cloudflare custom rule that actions everything the surface does _not_ account for.

```ts
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

**Start on `managed_challenge` rather than `block`.** A legitimate path caught by mistake then gets a challenge a human can pass. Cloudflare's `log`
action is Enterprise-only, so this is the available shakedown, and either action ends the request at the edge — the saved Worker invocation is
identical from day one.

---

## Gotchas

**Deploy order is asymmetric: sync the zone, then push, then deploy.** An allow-list needs no maintenance, but it carries the opposite failure mode
to a deny-list — it blocks a _real_ route the edge has not been told about, which is a 403 to a genuine user rather than a probe getting through.
Allowing a path that does not exist yet is harmless; deploying a path that is not yet allowed is an outage.

**`/cdn-cgi/` and `/.well-known/` are unioned into every allow-list whether you ask or not.** Neither is application surface, so neither appears in
a route table, which is exactly why forge supplies them. `/cdn-cgi/` is not optional cleanup: it is Cloudflare's own path, and **Turnstile's
challenge platform is served from it** — a rule that filters it takes down every form on the site.

**The apex is stated once.** `zone.apex` defaults to the origin's hostname, because stating the host twice is how the two drift and there is no case
for a zone whose apex is not the host the site declares itself served from. The redirect follows: **every `from` host must be a subdomain of the
apex.** `buildRedirectRule` consolidates a zone onto one hostname and is not a general URL forwarder — a source outside the apex could never fire,
since the rule is deployed to the apex's own zone, and a source equal to the apex is a loop. Both are refused at build time.

**The apex host clause in `buildAllowRule` is defence in depth, not load-bearing for the `www` redirect.** It scopes the expression to
`surface.apex` because that is the only host whose surface was enumerated. `http_request_dynamic_redirect` is the first application-layer phase and
`http_request_firewall_custom` runs nine phases later, so a `www` request is answered with its 301 and never reaches the WAF.

**Expression length is the ceiling that binds first.** Cloudflare caps a rule expression at 4096 characters on every plan, failing the write with
error 20127 rather than truncating. `buildAllowExpression` checks this before the request and names the ways out — collapse exact paths into a
prefix, or move the surface into a Cloudflare list. Rule _count_ (5 on Free, 20 on Pro, 100 on Business) is not the binding limit, since a generated
allow-list is a single rule.

---

## See also

- [`src/router/README.md`][router-readme] — `routePaths`, the source of every path list here
- [`src/tooling/assets/README.md`][assets-readme] — the pipeline step that emits both files for you
- [`docs/SOURCE_OF_TRUTH.md`][sot-2f] §2f — why this README, and not a `docs/` document, owns the rulings above

[assets-readme]: ../tooling/assets/README.md
[router-readme]: ../router/README.md
[sot-2f]: ../../docs/SOURCE_OF_TRUTH.md#2f-the-prose-rows
