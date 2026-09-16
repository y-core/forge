---
title: Forge Library Overview
description: "What @y-core/forge is, the design principles every namespace is written against, and the catalogue of namespaces a consumer imports."
---

# `@y-core/forge` — Reusable Component Library

A collection of namespaced TypeScript modules for building server-rendered web applications on **`@remix-run/fetch-router` + Cloudflare Workers**,
with HTMX for progressive enhancement and Tailwind CSS for styling. Each namespace is independently useful and carries no dependency on any other
namespace in this library.

---

## Design Principles

**Build on Web APIs.** All modules are written against the standard Web Platform (`Request`, `Response`, `FormData`, `Headers`). The only framework
layer is `@remix-run/fetch-router`, whose `RequestContext` is itself a thin wrapper over `Request`.

**Religiously Runtime.** No module assumes static analysis or a build step beyond TypeScript/JSX erasure. All tests run directly under `bun test`
without a bundler.

**Avoid Dependencies.** External dependencies are minimised and wrapped completely so they can be replaced without touching call sites. Each
dependency is a deliberate, contained choice.

**Demand Composition.** Every namespace is single-purpose and independently useful. Tightly coupled modules that always change together live in the
same namespace rather than forcing cross-namespace imports.

---

## Supported Environments

forge ships its TypeScript/TSX **source** directly — there is no build step and no emitted `.d.ts`. Consuming it therefore requires a
**TypeScript-aware bundler** that resolves `.ts`/`.tsx` and is configured with `jsxImportSource: "@y-core/forge/jsx"` (e.g. esbuild, Bun, Vite, or
Wrangler). A plain-JavaScript consumer, or one relying on `tsc`-style resolution of compiled `.js`, cannot import forge.

---

## Namespace Overview

See [NAMESPACES.md][namespaces] for the authoritative namespace catalog. Each namespace has its own `README.md` with full API documentation — click
a namespace to open it.

| Import path | Concern | Docs |
| --- | --- | --- |
| `@y-core/forge/app` | App bootstrap & lifecycle | [src/app/README.md][app-readme] |
| `@y-core/forge/assets` | Manifest & sprite registry (runtime) | [src/assets/README.md][assets-readme] |
| `@y-core/forge/auth` | Identity — credentials, factors & stores (domain only) | [src/auth/README.md][auth-readme] |
| `@y-core/forge/auth/client` | Browser island for the passkey ceremony scope (side-effect) | [src/auth/README.md][auth-readme] |
| `@y-core/forge/auth/web` | Auth routes, paths, guards, form schemas & the page render seam | [src/auth/README.md][auth-readme] |
| `@y-core/forge/auth/schema.sql` | The identity tables' desired state, for a consumer's `config/db.ts` | [src/auth/README.md][auth-readme] |
| `@y-core/forge/tooling/assets` | Asset config, build pipeline & `forge assets` | [src/tooling/assets/README.md][tooling-assets-readme] |
| `@y-core/forge/tooling/cli` | CLI command framework | [src/tooling/cli/README.md][cli-readme] |
| `@y-core/forge/tooling/gate` | Verification gate — steps, presets & checks (Node/Bun only) | [src/tooling/gate/README.md][gate-readme] |
| `@y-core/forge/tooling/gate/chromium` | Chromium resolution prebuilt — the spelling `playwright.config.ts` imports | [src/tooling/gate/README.md][gate-readme] |
| `@y-core/forge/tooling/release` | Release workflow — version, changelog & surface guard | [src/tooling/release/README.md][release-readme] |
| `@y-core/forge/tooling/lint` | forge's oxlint rules, and the two rule catalogs the gate reads | [src/tooling/lint/README.md][lint-readme] |
| `@y-core/forge/tooling/lint/plugin` | The same plugin prebuilt — the spelling `.oxlintrc.json` names | [src/tooling/lint/README.md][lint-readme] |
| `@y-core/forge/tooling/cf` | Cloudflare — account bindings, zone rules, env schema (`forge cf`) | [src/tooling/cf/README.md][cf-readme] |
| `@y-core/forge/tooling/db` | D1 — migrations, backup, seeds, sync & Time Travel (`forge db`) | [src/tooling/db/README.md][db-readme] |
| `@y-core/forge/tooling/term` | Terminal rendering — width, wrapping, grids & colour | [src/tooling/term/README.md][term-readme] |
| `@y-core/forge/warden` | The fleet corpus and `warden sync` (Node/Bun only) | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/checks` | The documentation, README-export, changelog & design corpus checks | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/steps` | The gate steps for those checks — `docsStep`, `changelogStep`, … | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/knowledge` | BM25 retrieval over the corpus — index, search, read, related | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/mcp` | The MCP server behind `warden serve` — its tools and resources | [warden/README.md][warden-readme] |
| `@y-core/forge/config` | Environment config | [src/config/README.md][config-readme] |
| `@y-core/forge/context` | `RequestContext`, `AppContext` | [src/context/README.md][context-readme] |
| `@y-core/forge/dev` | The development allowance — the token every dev-only relaxation takes | [src/dev/README.md][dev-readme] |
| `@y-core/forge/form` | Form parsing, CSRF & bot detection | [src/form/README.md][form-readme] |
| `@y-core/forge/html/htmx` | HTMX server-side helpers | [src/html/README.md][html-readme] |
| `@y-core/forge/http` | HTTP output — responses, headers, fragments | [src/http/README.md][http-readme] |
| `@y-core/forge/jsx` | JSX runtime (`jsxImportSource`); JSX → `HtmlResponse` (`renderPage`) | [src/jsx/README.md][jsx-readme] |
| `@y-core/forge/jsx/jsx-runtime` | Automatic JSX transform runtime | [src/jsx/README.md][jsx-readme] |
| `@y-core/forge/jsx/register` | Classic-mode JSX runtime registration | [src/jsx/README.md][jsx-readme] |
| `@y-core/forge/logging` | Structured logging | [src/logging/README.md][logging-readme] |
| `@y-core/forge/logging/show` | Log viewer UI & reader | [src/logging/README.md][logging-readme] |
| `@y-core/forge/result` | Result monad | [src/result/README.md][result-readme] |
| `@y-core/forge/router` | Declarative route config | [src/router/README.md][router-readme] |
| `@y-core/forge/security` | Transport-layer hardening | [src/security/README.md][security-readme] |
| `@y-core/forge/session` | Session + cookie management | [src/session/README.md][session-readme] |
| `@y-core/forge/site` | Robots, sitemap & zone rules | [src/site/README.md][site-readme] |
| `@y-core/forge/storage/db` | D1 database client | [src/storage/README.md][storage-readme] |
| `@y-core/forge/storage/kv` | Workers KV typed store | [src/storage/README.md][storage-readme] |
| `@y-core/forge/storage/r2` | R2 object storage | [src/storage/README.md][storage-readme] |
| `@y-core/forge/testing` | Test fixtures & fakes | [src/testing/README.md][testing-readme] |
| `@y-core/forge/testing/workerd` | `wrangler dev` fixture server (node-only, off the barrel) | [src/testing/README.md][testing-readme] |
| `@y-core/forge/testing/node` | Types only: the node surface `testing/workerd` reaches, referenced per file | [src/testing/README.md][testing-readme] |
| `@y-core/forge/ui/contracts` | Shared SSR/browser DOM contract as pure data | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/contracts/theme` | Colour-scheme generation and the audited contrast pairs | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/core` | Server-side JSX component library | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/core/client` | Browser island for ui/core scopes (side-effect) | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/controls` | Pre-bound signal-binding wrappers | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets` | Forge icon glyph names and sprite file map | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets/build` | Build-time glyph, colour, cursor and token computation | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets/glyphs` | Browser-safe sprite glyph parser | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets/css/*.css` | Forge stylesheets by filename — `forge.css` is the entry point | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/design/*.md` | The design corpus as markdown, by filename | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/client` | Browser-side UI scripts | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/client/htmx` | HTMX bundle (side-effect) | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/chrome` | SSR app chrome: Navbar, Toolbar, ThemeToggle | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/chrome/client` | Browser island for chrome scopes (side-effect) | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/server` | SSR-only: Flash, Resumable | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/show` | Component showcase route helpers | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/show/client` | Showcase filter island (side-effect) | [src/ui/README.md][ui-readme] |
| `@y-core/forge/validation` | Schema validation (valibot) | [src/validation/README.md][validation-readme] |

> **There is no aggregate `storage` or `ui` barrel** — each client and each UI surface is imported from its own subpath above.
>
> **Internal only:** `src/crypto/` is not a public namespace — it has no export path and its symbols are `@internal`. See
> [src/crypto/README.md][crypto-readme].

---

## The Request Context

Handlers and middleware receive a `RequestContext` from `@remix-run/fetch-router`. forge extends it at runtime with the Workers `env` and
`executionCtx`, exposed as the `AppContext<Bindings>` type:

```ts
import { getAppContext, type AppContext } from "@y-core/forge/context";

// Inside any handler/middleware: narrow the RequestContext to an AppContext.
// `getAppContext` asserts the Forge router has injected per-request state and throws a clear
// error if not (e.g. the handler ran outside the Forge chain), instead of yielding `undefined env`.
const c = getAppContext<Bindings>(context);
c.env.CSRF_SECRET; // typed Workers bindings
c.executionCtx.waitUntil(promise);
c.request; // the standard Request
c.url.pathname; // parsed URL
```

Custom per-request variables use typed accessors instead of stringly-keyed `get`/`set`:

```ts
import { contextVar } from "@y-core/forge/context";

const userCtx = contextVar<User>("user");
userCtx.set(context, user);
const user = userCtx.get(context); // throws if unset
const maybe = userCtx.getOptional(context); // undefined if unset
```

See [src/context/README.md][context-readme] for the full API.

---

## Testing

All tests live alongside the source they test (`*.test.ts` / `*.test.tsx`) and run directly under Bun with no bundler. `Forge` provides a
`request()` helper that builds a `Request` and dispatches it through the full middleware chain:

```ts
import { Forge } from "@y-core/forge/app";

const res = await app.request(
  "/api/contact",
  { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: token, name: "Jane" }) },
  MINIMUM_ENV,
);

expect(res.status).toBe(200);
```

```bash
bun test                    # all tests
bun test src/form           # one namespace
bun run verify              # the gate — typecheck (tsc), lint (oxlint), format (oxfmt), tests, and every validator
```

Type checking uses `tsc` (`typescript` 7, the native compiler). `validate-exports` verifies, in both directions, that every barrel export resolves
at runtime **and** that every `@public`-tagged source symbol is re-exported from its namespace barrel.

---

## License

MIT — see [LICENSE](LICENSE). This covers everything the package ships, including the design corpus in `src/ui/design/`.

[app-readme]: src/app/README.md
[assets-readme]: src/assets/README.md
[auth-readme]: src/auth/README.md
[cf-readme]: src/tooling/cf/README.md
[cli-readme]: src/tooling/cli/README.md
[config-readme]: src/config/README.md
[context-readme]: src/context/README.md
[crypto-readme]: src/crypto/README.md
[db-readme]: src/tooling/db/README.md
[dev-readme]: src/dev/README.md
[form-readme]: src/form/README.md
[gate-readme]: src/tooling/gate/README.md
[html-readme]: src/html/README.md
[http-readme]: src/http/README.md
[jsx-readme]: src/jsx/README.md
[lint-readme]: src/tooling/lint/README.md
[logging-readme]: src/logging/README.md
[namespaces]: docs/NAMESPACES.md
[release-readme]: src/tooling/release/README.md
[result-readme]: src/result/README.md
[router-readme]: src/router/README.md
[security-readme]: src/security/README.md
[session-readme]: src/session/README.md
[site-readme]: src/site/README.md
[storage-readme]: src/storage/README.md
[term-readme]: src/tooling/term/README.md
[testing-readme]: src/testing/README.md
[tooling-assets-readme]: src/tooling/assets/README.md
[ui-readme]: src/ui/README.md
[validation-readme]: src/validation/README.md
[warden-readme]: warden/README.md
