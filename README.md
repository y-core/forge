# `@y-core/forge` — Reusable Component Library

A collection of namespaced TypeScript modules for building server-rendered web applications on **`@remix-run/fetch-router` + Cloudflare Workers**, with HTMX for progressive enhancement and Tailwind CSS for styling. Each namespace is independently useful and carries no dependency on any other namespace in this library.

---

## Design Principles

**Build on Web APIs.**  
All modules are written against the standard Web Platform (`Request`, `Response`, `FormData`, `Headers`). The only framework layer is `@remix-run/fetch-router`, whose `RequestContext` is itself a thin wrapper over `Request`.

**Religiously Runtime.**  
No module assumes static analysis or a build step beyond TypeScript/JSX erasure. All tests run directly under `bun test` without a bundler.

**Avoid Dependencies.**  
External dependencies are minimised and wrapped completely so they can be replaced without touching call sites. Each dependency is a deliberate, contained choice.

**Demand Composition.**  
Every namespace is single-purpose and independently useful. Tightly coupled modules that always change together live in the same namespace rather than forcing cross-namespace imports.

---

## Supported Environments

forge ships its TypeScript/TSX **source** directly — there is no build step and no emitted `.d.ts`. Consuming it therefore requires a **TypeScript-aware bundler** that resolves `.ts`/`.tsx` and is configured with `jsxImportSource: "@y-core/forge/jsx"` (e.g. esbuild, Bun, Vite, or Wrangler). A plain-JavaScript consumer, or one relying on `tsc`-style resolution of compiled `.js`, cannot import forge.

---

## Namespace Overview

See [NAMESPACE_DESIGN.md](.decisions/NAMESPACE_DESIGN.md) for the authoritative namespace catalog.
Each namespace has its own `README.md` with full API documentation — click a namespace to open it.

| Import path | Concern | Docs |
|---|---|---|
| `@y-core/forge/app` | App bootstrap & lifecycle | [src/app/README.md](src/app/README.md) |
| `@y-core/forge/assets` | Asset config & metadata | [src/assets/README.md](src/assets/README.md) |
| `@y-core/forge/assets/build` | Asset build pipeline | [src/assets/README.md](src/assets/README.md) |
| `@y-core/forge/assets/manifest` | Manifest & sprite registry | [src/assets/README.md](src/assets/README.md) |
| `@y-core/forge/cli` | CLI command framework | [src/cli/README.md](src/cli/README.md) |
| `@y-core/forge/config` | Environment config | [src/config/README.md](src/config/README.md) |
| `@y-core/forge/context` | `RequestContext`, `AppContext` | [src/context/README.md](src/context/README.md) |
| `@y-core/forge/form` | Form parsing, CSRF & bot detection | [src/form/README.md](src/form/README.md) |
| `@y-core/forge/html/htmx` | HTMX server-side helpers | [src/html/README.md](src/html/README.md) |
| `@y-core/forge/http` | HTTP output — responses, headers, fragments | [src/http/README.md](src/http/README.md) |
| `@y-core/forge/jsx` | JSX runtime (`jsxImportSource`) | [src/jsx/README.md](src/jsx/README.md) |
| `@y-core/forge/render` | JSX → `HtmlResponse` (`renderPage`) | [src/jsx/README.md](src/jsx/README.md) |
| `@y-core/forge/logging` | Structured logging | [src/logging/README.md](src/logging/README.md) |
| `@y-core/forge/logging/show` | Log viewer UI & reader | [src/logging/README.md](src/logging/README.md) |
| `@y-core/forge/pkg` | Release & versioning (Node/Bun only) | [src/pkg/README.md](src/pkg/README.md) |
| `@y-core/forge/result` | Result monad | [src/result/README.md](src/result/README.md) |
| `@y-core/forge/router` | Declarative route config | [src/router/README.md](src/router/README.md) |
| `@y-core/forge/security` | Transport-layer hardening | [src/security/README.md](src/security/README.md) |
| `@y-core/forge/session` | Session + cookie management | [src/session/README.md](src/session/README.md) |
| `@y-core/forge/storage/db` | D1 database client | [src/storage/README.md](src/storage/README.md) |
| `@y-core/forge/storage/kv` | Workers KV typed store | [src/storage/README.md](src/storage/README.md) |
| `@y-core/forge/storage/r2` | R2 object storage | [src/storage/README.md](src/storage/README.md) |
| `@y-core/forge/ui/core` | Server-side JSX component library | [src/ui/README.md](src/ui/README.md) |
| `@y-core/forge/ui/controls` | Pre-bound signal-binding wrappers | [src/ui/README.md](src/ui/README.md) |
| `@y-core/forge/ui/assets` | Forge icon asset manifest (`forgeUiSpriteSources`) | [src/ui/README.md](src/ui/README.md) |
| `@y-core/forge/ui/client` | Browser-side UI scripts | [src/ui/README.md](src/ui/README.md) |
| `@y-core/forge/ui/client/htmx` | HTMX bundle (side-effect) | [src/ui/README.md](src/ui/README.md) |
| `@y-core/forge/ui/server` | SSR-only: Flash, Resumable, ThemeToggle | [src/ui/README.md](src/ui/README.md) |
| `@y-core/forge/ui/show` | Component showcase route helpers | [src/ui/README.md](src/ui/README.md) |
| `@y-core/forge/validation` | Schema validation (valibot) | [src/validation/README.md](src/validation/README.md) |
| `@y-core/forge/validation/cli` | `forge-cfgen` env-schema generator | [src/validation/README.md](src/validation/README.md) |

> **Internal only:** `src/crypto/` is not a public namespace — it has no export path and its symbols are `@internal`. See [src/crypto/README.md](src/crypto/README.md).

---

## The Request Context

Handlers and middleware receive a `RequestContext` from `@remix-run/fetch-router`. forge extends it at runtime with the Workers `env` and `executionCtx`, exposed as the `AppContext<Bindings>` type:

```typescript
import { getAppContext, type AppContext } from "@y-core/forge/context";

// Inside any handler/middleware: narrow the RequestContext to an AppContext.
// `getAppContext` asserts the Forge router has injected per-request state and throws a clear
// error if not (e.g. the handler ran outside the Forge chain), instead of yielding `undefined env`.
const c = getAppContext<Bindings>(context);
c.env.CSRF_SECRET;     // typed Workers bindings
c.executionCtx.waitUntil(promise);
c.request;             // the standard Request
c.url.pathname;        // parsed URL
```

Custom per-request variables use typed accessors instead of stringly-keyed `get`/`set`:

```typescript
import { contextVar } from "@y-core/forge/context";

const userCtx = contextVar<User>("user");
userCtx.set(context, user);
const user = userCtx.get(context);          // throws if unset
const maybe = userCtx.getOptional(context); // undefined if unset
```

See [src/context/README.md](src/context/README.md) for the full API.

---

## Namespace Summaries

Quick one-line orientation for each namespace — see the linked README for complete API docs.

**[`@y-core/forge/app`](src/app/README.md)** — `createApp` returns a `Forge` Workers handler; `definePage` / `defineAction` wire loaders, views, and form pipelines; `healthCheck` validates bindings.

**[`@y-core/forge/assets`](src/assets/README.md)** — `defineAssetsConfig` describes JS bundles, CSS builds, SVG sprites, and font downloads; `buildAll` runs the full pipeline; `forge-assets` is the CLI bin.

**[`@y-core/forge/cli`](src/cli/README.md)** — `createCommand` + `execute` build composable CLI tools with typed flags, subcommands, process execution, and structured errors.

**[`@y-core/forge/config`](src/config/README.md)** — `Config` lazily resolves and caches typed env-var groups per Worker lifetime; `optionalGroup` collapses absent optional integrations to `null`.

**[`@y-core/forge/context`](src/context/README.md)** — `getAppContext` narrows `RequestContext` to typed Workers bindings; `contextVar` creates type-safe per-request accessors.

**[`@y-core/forge/form`](src/form/README.md)** — `csrfProtection` middleware, stateless HMAC tokens with key-ring rotation, honeypot detection, and Cloudflare Turnstile verification.

**[`@y-core/forge/html/htmx`](src/html/README.md)** — HTMX request header parsers, response header builders (`hxHeaders`), JSX attribute helpers (`hxAttrs`), and pre-built interaction patterns.

**[`@y-core/forge/http`](src/http/README.md)** — `htmlResponse` / `fragmentResponse` / `redirect`, typed header builder classes, the `SafeHtml` branded type, and `escapeHtml` / `safeUrl` XSS guards.

**[`@y-core/forge/jsx`](src/jsx/README.md)** — the JSX runtime for `jsxImportSource`; `renderPage` / `renderToString` (imported from `@y-core/forge/render`) render JSX to `Response` or `SafeHtml`.

**[`@y-core/forge/logging`](src/logging/README.md)** — `createLogger` fans out structured records to pluggable channels (`consoleChannel`, `kvLogChannel`); `logging/show` adds an admin log-viewer UI.

**[`@y-core/forge/pkg`](src/pkg/README.md)** — Node/Bun-only release tooling: semver parsing, git tag management, `package.json` version updates, and `createReleaseCommand` for automated releases.

**[`@y-core/forge/result`](src/result/README.md)** — `Result<T, E>` discriminated union; `result.ok(data)` / `result.err(error)` constructors; `ValidationResult<T>` for form/schema results.

**[`@y-core/forge/router`](src/router/README.md)** — `route()` builds a typed route map; `createController` binds handlers; `routePaths` introspects patterns; curated re-exports of `@remix-run/fetch-router`.

**[`@y-core/forge/security`](src/security/README.md)** — `makeSecurityHeaders` sets CSP + hardening headers; `cors` / `originGuard` validate origins; `rateLimit` enforces request budgets; `requestId` propagates `CF-Ray`.

**[`@y-core/forge/session`](src/session/README.md)** — `sessionMiddleware` reads/writes sessions conditionally (unchanged requests stay cacheable); `createSignedCookie` enforces `httpOnly`, `secure`, and HMAC signing.

**[`@y-core/forge/storage`](src/storage/README.md)** — typed wrappers over Cloudflare D1 (`storage/db`), Workers KV (`storage/kv`), and R2 (`storage/r2`); all operations return `Result<T>`; signed URL support for R2.

**[`@y-core/forge/ui`](src/ui/README.md)** — `ui/core`: JSX component library (`Alert`, `Button`, `Card`, `Field`, `Form`, `Input`, …); `ui/controls`: pre-bound signal-binding wrappers (`Switch`, `Slider`, `Select`, `ToggleGroup`); `ui/assets`: `forgeUiSpriteSources()` manifest for forge's 7 icon glyphs; `ui/client`: signals + island hydration; `ui/server`: SSR Flash/Resumable/ThemeToggle.

**[`@y-core/forge/validation`](src/validation/README.md)** — the `v` valibot namespace + `ValidationResult<T>`; `validation/cli` generates typed Cloudflare env declarations from `wrangler.jsonc` (`forge-cfgen` bin).

---

## Testing

All tests live alongside the source they test (`*.test.ts` / `*.test.tsx`) and run directly under Bun with no bundler. `Forge` provides a `request()` helper that builds a `Request` and dispatches it through the full middleware chain:

```typescript
import { Forge } from "@y-core/forge/app";

const res = await app.request("/api/contact", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ __csrf: token, name: "Jane" }),
}, MINIMUM_ENV);

expect(res.status).toBe(200);
```

```bash
bun test                    # all tests
bun test src/form           # one namespace
bun run check               # typecheck (tsgo) + lint (biome) + tests + validate-exports
```

Type checking uses `tsgo` (`@typescript/native-preview`). `validate-exports` verifies, in both directions, that every barrel export resolves at runtime **and** that every `@public`-tagged source symbol is re-exported from its namespace barrel.
