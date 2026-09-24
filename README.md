# `@y-core/forge`

A Web standards platform for server-rendered web applications, built on a foundation of Web APIs for seamless deployment on **Cloudflare Workers**.
It covers the whole path a request takes — routing, middleware, validation, sessions, identity, storage — and the HTML that goes back: a JSX runtime
that renders inside the Worker, a Tailwind component library, HTMX for fragment swaps, and an island runtime for the parts that genuinely need a
script.

Around the application sits a command layer. `forge` builds assets, migrates D1, reconciles Cloudflare bindings, cuts releases and runs the
verification gate; `warden` serves the governing corpus that gate holds the code to.

```bash
bun add @y-core/forge
```

forge ships raw TypeScript and TSX. There is no build step, no `dist/`, and no emitted `.d.ts` — your bundler is the only compiler in the chain.

---

## Why not reach for a framework

The frameworks worth comparing forge to are solving a different problem. They abstract over many hosts, they render into a client runtime, and they
leave the rest of an application — identity, migrations, bindings, the release — to you and a directory of scripts. forge trades away the host
abstraction and the client runtime on purpose, and takes on the rest.

### Web APIs are the foundation; Workers is the deployment target

forge's runtime source is written against the Web Platform and nothing else. `tsconfig.json` includes no `@types/*` at all — not Node's, and not
Cloudflare's — so a Node or Bun global in runtime source is a **compile error** rather than a portability bug found at deploy time. Even the storage
bindings are typed by forge's own structural interfaces (`D1DatabaseLike`, `KVNamespaceLike`, `R2BucketLike`), which is how `@y-core/forge/testing`
satisfies them with in-memory fakes.

So what ties forge to Cloudflare is not the language runtime — it is the platform contract forge is shaped for: the `export default { fetch }`
module entry, `env` bindings and `executionCtx.waitUntil`, and the services reached through them (D1, KV, R2, the rate-limiter binding, the `ASSETS`
fetcher, Turnstile). Workers is where that contract is native, and it is the host forge ships ready to deploy on.

Any runtime carrying the same Web globals — Node, Deno, Bun — will execute this code. What forge does not ship is the adapter: you would supply the
entry shim, an implementation of each binding you use, and your own answer for the Cloudflare services behind them. Nothing in the source forbids
it, and nothing in the package does it for you. The command layer is the deliberate exception, and runs the other way round — `tooling/*` targets
Node and Bun, and is unreachable from a Worker by design.

### HTML is the output, not a hydration payload

`@y-core/forge/jsx` renders a JSX tree to a string inside the Worker. No virtual DOM, no hydration, no reconciler, and **nothing from the renderer
reaches the browser**. Escaping happens at render time; URL-bearing attributes are scheme-sanitized for you; a `style` attribute is dropped, because
the shipped CSP carries no `style-src 'unsafe-inline'`.

Interactivity is then taken in the cheapest form that works. Native platform behaviour first — `<dialog>`, the Popover and Invoker Commands APIs,
`<details>` — so a dialog, a menu and a tab panel open with no JavaScript at all. HTMX next, for swapping server-rendered fragments. Only what is
left over reaches the island runtime: a scope resumes on the **first interaction inside it**, rebuilds its state into signals, and runs its setup
once. A page nobody touches runs no controller.

The split is kept by import path, not by convention. `ui/core` may not reach `document`, `ui/client` may not be imported from a Worker-executed
file, and `validate-ssr-boundary` fails the gate when either happens.

### A small dependency surface, wrapped

The runtime dependency list is `@remix-run/fetch-router`, `@remix-run/headers`, `@remix-run/route-pattern`, `@remix-run/session`, `htmx.org` and
`valibot`. Each is reached through a forge namespace rather than directly, so a consumer imports `@y-core/forge/validation` and never `valibot` —
which is what keeps one version in play and makes a replacement a change inside forge rather than across every call site.

### The parts a real application ships with are in the box

This is where most of forge's surface lives, and it is what separates it from a routing library with a template engine bolted on:

- **Identity** — sign-in and sign-up, email OTP, passkeys through WebAuthn, an authenticator app, step-up elevation, self-service passkey and email
  management, and an administrative user console. Mountable pages over a domain you can also call directly.
- **Submissions** — a byte-capped body read, stateless CSRF, Turnstile verification, and a schema contract the page and action builders run before
  your handler sees anything.
- **Transport hardening** — CSP with per-request nonces, origin guards, CORS, rate limiting, and a request id the error page quotes.
- **Storage** — typed, injection-safe clients for D1, KV and R2, each answering with a `Result` instead of throwing.
- **Operations** — structured logging over pluggable channels with a mountable log viewer; `robots.txt`, `sitemap.xml` and edge allow-rules derived
  from the route map rather than maintained beside it.
- **The build and the deploy** — a content-hashed asset pipeline with a generated typed manifest; forward-only D1 migrations composed from a
  declared schema, with verified backups and idempotent seeds; and Cloudflare account and zone reconciliation that reports before it writes.

### The architecture is proved, not documented

`bun run verify` is one command over a declared step table, and most of what it runs is not a linter. It proves that the export map resolves in both
directions, that no namespace has an undeclared cross-namespace dependency, that the SSR, build-time and dev-only boundaries hold, that the package
tarball contains what the export map promises, that every audited colour pair still meets its WCAG criterion, that every Tailwind class in the
component library resolves against the stylesheet, and that the documentation corpus still cites what it claims to.

`warden` is the other half. The fleet's governing corpus ships inside the package, is indexed for BM25 retrieval, and is served over MCP — so an
agent working in a consuming repository asks the corpus a question and gets the section that answers it, rather than working from a remembered rule.

### What forge is not

It is not host-agnostic — there is one deployment target it arrives ready for, and every other one is yours to adapt to. It is not an SPA or a
hydration-based islands framework. And it is not consumable from plain JavaScript, or by a `tsc`-style resolver expecting compiled `.js`.

It is **pre-1.0**: breaking changes ship without deprecation shims, so read the **Breaking Changes** section of [CHANGELOG.md][changelog] before
upgrading.

---

## Supported environments

Consuming forge requires a **TypeScript-aware bundler** that resolves `.ts`/`.tsx` — esbuild, Bun, Vite or Wrangler — configured with the forge JSX
runtime:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@y-core/forge/jsx" } }
```

`esbuild`, `sharp` and `tailwindcss` are **optional** peer dependencies, needed only by the asset pipeline; none is ever imported by runtime source.
`wrangler` is the peer the database and Cloudflare commands shell out to.

---

## A worked entry point

A Worker's default export has to be one object with a `fetch` method. `createApp` is that object, and its wiring hooks run in a fixed order, so the
asset catch-all cannot shadow a route however you wrote the fields:

```ts
import { applyMiddlewareChain, createApp, type AssetsFetcher } from "@y-core/forge/app";
import { consoleChannel } from "@y-core/forge/logging";
import { NONCE } from "@y-core/forge/security";

import { appConfig } from "./config";
import { EnvSchema } from "./env.schema";
import { registerRoutes } from "./routes";

export interface Bindings {
  CSRF_SECRET: string;
  ASSETS: AssetsFetcher;
}

export default createApp<Bindings>({
  config: appConfig,
  middleware: (app) =>
    applyMiddlewareChain(app, {
      logging: { channels: () => [consoleChannel()] },
      securityHeaders: { scriptSrc: ["'self'", NONCE] },
      bindings: EnvSchema,
    }),
  routes: registerRoutes,
  assets: true,
});
```

Routes are **data** — a map of names to `{ method, pattern }`, bound to handlers separately — so a path exists in exactly one place, and dispatch,
URL generation and middleware wiring all read it. A page pairs a loader with a view; an action pairs a schema with a handler, and the body read, the
bot guard and the parse are already written:

```tsx
export const homePage = definePage({
  cache: { maxAge: 300, scope: "public" },
  loader: async (c, config) => ({ greeting: `Hello from ${config.site.name}` }),
  view: (_c, _config, state) => renderPage(<Home greeting={state.data.greeting} />),
});
```

[`src/app/README.md`][app-readme] teaches the rest: the middleware chain, the document shell, the submission pipeline, the error boundary and the
health check.

---

## The request context

Handlers and middleware receive a `RequestContext` from `@remix-run/fetch-router`. forge extends it at runtime with the Workers `env` and
`executionCtx`, exposed as the `AppContext<Bindings>` type:

```ts
import { getAppContext, type AppContext } from "@y-core/forge/context";

// `getAppContext` asserts the forge router injected per-request state, and throws a clear error if
// not — instead of yielding an `undefined` env deep inside a handler.
const c = getAppContext<Bindings>(context);
c.env.CSRF_SECRET; // typed Workers bindings
c.executionCtx.waitUntil(promise);
c.request; // the standard Request
c.url.pathname; // parsed URL
```

Custom per-request values use typed accessors rather than stringly-keyed `get`/`set`:

```ts
import { contextVar } from "@y-core/forge/context";

const userCtx = contextVar<User>("user");
userCtx.set(context, user);
const user = userCtx.get(context); // throws if unset
const maybe = userCtx.getOptional(context); // undefined if unset
```

---

## The command layer

`forge` assembles its command tree from the first-party commands plus whatever your own `config/commands.ts` default-exports, so an application's
scripts are subcommands rather than a directory of loose files:

```bash
forge verify                    # the gate, over config/steps.ts
forge assets build --minify     # hashed, cache-busted output plus a generated typed manifest
forge db migrate                # apply pending migrations, forward-only and checksummed
forge db backup                 # a verified artifact you can restore from
forge cf sync                   # report account-binding drift; --commit to create and write back
forge cf gen env                # emit env.schema.ts from wrangler.jsonc + .dev.vars
forge release                   # resolve the version from git, promote the changelog, commit, tag
forge curate ../skeleton        # copy the working tree minus config/features.ts's directories and marked lines
```

Every verb that could change something reports by default and writes only when told to. `warden sync`, `warden search` and `warden serve` are the
governance side of the same idea — see [warden/README.md][warden-readme].

---

## Testing

Tests live alongside the source they test (`*.test.ts` / `*.test.tsx`) and run directly under Bun with no bundler. `app.request()` builds a
`Request`, dispatches it through the full middleware chain, and awaits any `waitUntil` work before resolving:

```ts
const res = await app.request(
  "/api/contact",
  { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: token, name: "Jane" }) },
  MINIMUM_ENV,
);

expect(res.status).toBe(200);
```

```bash
bun test                       # all tests
bun test src/form              # one namespace
bun run verify                 # the standard gate — the run a task closes on
bun run verify --only lint     # one step, for the dev loop
bun run verify --list          # print the steps of the selected mode, run none
```

`@y-core/forge/testing` ships the fixtures a consuming suite would otherwise hand-roll: a loaded request context, in-memory D1 and KV fakes, real
CSRF minting, and an SSR render helper. Type checking uses `tsc` (`typescript` 7, the native compiler).

---

## Namespace catalog

Consumers import from `@y-core/forge/{namespace}` and never from a wrapped package. Each namespace has its own `README.md` with the full API — click
through for it. [NAMESPACES.md][namespaces] is the authoritative catalog, and owns the leaf/integration classification.

### The request path

| Import path | Concern | Docs |
| --- | --- | --- |
| `@y-core/forge/app` | App bootstrap, middleware chain, page & action builders, the shell | [src/app/README.md][app-readme] |
| `@y-core/forge/router` | Routes as data, controllers, URL generation | [src/router/README.md][router-readme] |
| `@y-core/forge/context` | `RequestContext`, `AppContext`, typed per-request variables | [src/context/README.md][context-readme] |
| `@y-core/forge/config` | Raw bindings mapped to a validated, per-env config store | [src/config/README.md][config-readme] |
| `@y-core/forge/validation` | Schema validation — the valibot facade and the form-field shapes | [src/validation/README.md][validation-readme] |
| `@y-core/forge/form` | Capped body reads, stateless CSRF, Turnstile verification | [src/form/README.md][form-readme] |
| `@y-core/forge/http` | HTTP output — response builders, header classes, `SafeHtml` | [src/http/README.md][http-readme] |
| `@y-core/forge/output/pdf` | Printable documents rendered to bytes — no browser, no dependency | [src/output/pdf/README.md][output-pdf-readme] |
| `@y-core/forge/output/pdf/audit` | What stands between a render and the conformance it aims at, read before any bytes | [src/output/pdf/README.md][output-pdf-readme] |
| `@y-core/forge/output/pdf/fonts` | Font packs and the CSS matching ladder a document selects a face through | [src/output/pdf/README.md][output-pdf-readme] |
| `@y-core/forge/output/pdf/jsx-runtime` | The `jsxImportSource` that lets a PDF document be written as markup | [src/output/pdf/README.md][output-pdf-readme] |
| `@y-core/forge/result` | The failure-as-data primitive every client answers with | [src/result/README.md][result-readme] |
| `@y-core/forge/security` | Transport hardening — CSP nonces, origin, CORS, rate limits, ids | [src/security/README.md][security-readme] |
| `@y-core/forge/session` | Hardened cookies and the session lifecycle middleware | [src/session/README.md][session-readme] |
| `@y-core/forge/logging` | Structured logging over pluggable channels | [src/logging/README.md][logging-readme] |
| `@y-core/forge/logging/viewer` | The mountable log viewer — one loader, access-gated | [src/logging/README.md][logging-readme] |
| `@y-core/forge/site` | `robots.txt`, sitemap and edge allow-rules, derived from the routes | [src/site/README.md][site-readme] |
| `@y-core/forge/dev` | The development allowance every dev-only relaxation takes | [src/dev/README.md][dev-readme] |

### Identity

| Import path | Concern | Docs |
| --- | --- | --- |
| `@y-core/forge/auth` | The identity domain — key rings, stores, factors, flows | [src/auth/README.md][auth-readme] |
| `@y-core/forge/auth/web` | Mountable routes, paths, guards, form schemas & the render seam | [src/auth/README.md][auth-readme] |
| `@y-core/forge/auth/client` | Browser island for the passkey ceremony (side-effect) | [src/auth/README.md][auth-readme] |
| `@y-core/forge/auth/schema.sql` | The identity tables' desired state, for a consumer's `config/db.ts` | [src/auth/README.md][auth-readme] |

### HTML and UI

| Import path | Concern | Docs |
| --- | --- | --- |
| `@y-core/forge/jsx` | The SSR JSX runtime — `renderPage`, `renderToString`, the types | [src/jsx/README.md][jsx-readme] |
| `@y-core/forge/jsx/jsx-runtime` | The automatic-transform entry `jsxImportSource` resolves to | [src/jsx/README.md][jsx-readme] |
| `@y-core/forge/jsx/register` | Classic-mode registration, for esbuild's zero-config fallback | [src/jsx/README.md][jsx-readme] |
| `@y-core/forge/html/htmx` | The server half of HTMX — inbound headers, `hx-*` attrs, directives | [src/html/README.md][html-readme] |
| `@y-core/forge/ui/core` | The server-rendered component library | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/core/client` | The scopes `ui/core` markup names (side-effect) | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/controls` | Signal-bound wrappers over the `ui/core` primitives | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/chrome` | App chrome — Navbar, Dock, Toolbar, ThemeToggle | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/chrome/client` | Browser island for the chrome scopes (side-effect) | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/server` | SSR-only Flash and Resumable | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/client` | Signals, the island runtime, and realm-safe DOM helpers | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/client/htmx` | The pinned HTMX bundle (side-effect) | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/contracts` | The DOM contract both halves write, as pure data | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/contracts/theme` | Colour-scheme generation and the audited contrast pairs | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets` | Forge's icon glyph names and sprite file map | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets/build` | Build-time glyph, colour, cursor and token computation | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets/glyphs` | Browser-safe sprite glyph parser | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/assets/css/*.css` | The stylesheets by filename — `tailwind.css` is the entry point | [src/ui/README.md][ui-readme] |
| `@y-core/forge/ui/design/*.md` | The design corpus as markdown, by filename | [src/ui/README.md][ui-readme] |
| `@y-core/forge/assets` | Request-time lookup from a logical name to its hashed URL | [src/assets/README.md][assets-readme] |

### Storage and testing

| Import path | Concern | Docs |
| --- | --- | --- |
| `@y-core/forge/storage/db` | D1 through `sql` fragments, answering with a `Result` | [src/storage/README.md][storage-readme] |
| `@y-core/forge/storage/kv` | Workers KV through a codec you choose | [src/storage/README.md][storage-readme] |
| `@y-core/forge/storage/r2` | R2 through a swappable object-storage backend | [src/storage/README.md][storage-readme] |
| `@y-core/forge/testing` | Fixtures and fakes — context, storage, CSRF, SSR render | [src/testing/README.md][testing-readme] |
| `@y-core/forge/testing/workerd` | `wrangler dev` fixture server (node-only, off the barrel) | [src/testing/README.md][testing-readme] |
| `@y-core/forge/testing/snapshot` | Text against a committed fixture, as a line diff (node-only, off the barrel) | [src/testing/README.md][testing-readme] |
| `@y-core/forge/testing/coverage` | Every published UI component, for a coverage manifest to declare (off the barrel) | [src/testing/README.md][testing-readme] |
| `@y-core/forge/testing/node` | Types only: the node surface those two reach | [src/testing/README.md][testing-readme] |

### The command layer

Everything here is **Node/Bun only** and unreachable from a Worker — `validate-import-boundary` proves it.

| Import path | Concern | Docs |
| --- | --- | --- |
| `@y-core/forge/tooling/cli` | The command framework the `forge` tree is built from | [src/tooling/cli/README.md][cli-readme] |
| `@y-core/forge/tooling/gate` | The verification gate — steps, presets & checks | [src/tooling/gate/README.md][gate-readme] |
| `@y-core/forge/tooling/gate/chromium` | Chromium resolution prebuilt — the spelling `playwright.config.ts` imports | [src/tooling/gate/README.md][gate-readme] |
| `@y-core/forge/tooling/assets` | Asset config, the build pipeline & `forge assets` | [src/tooling/assets/README.md][tooling-assets-readme] |
| `@y-core/forge/tooling/db` | D1 — migrations, backup, seeds, sync & Time Travel (`forge db`) | [src/tooling/db/README.md][db-readme] |
| `@y-core/forge/tooling/cf` | Cloudflare — account bindings, zone rules, env schema (`forge cf`) | [src/tooling/cf/README.md][cf-readme] |
| `@y-core/forge/tooling/release` | Release workflow — version, changelog & surface guard | [src/tooling/release/README.md][release-readme] |
| `@y-core/forge/tooling/curate` | Reducing a demonstrator to its skeleton from a feature manifest | [src/tooling/curate/README.md][curate-readme] |
| `@y-core/forge/tooling/lint` | Forge's oxlint rules, and the rule catalogs the gate reads | [src/tooling/lint/README.md][lint-readme] |
| `@y-core/forge/tooling/lint/plugin` | The same plugin prebuilt — the spelling `.oxlintrc.json` names | [src/tooling/lint/README.md][lint-readme] |
| `@y-core/forge/tooling/term` | Terminal rendering — width, wrapping, grids & colour | [src/tooling/term/README.md][term-readme] |

### Governance

| Import path | Concern | Docs |
| --- | --- | --- |
| `@y-core/forge/warden/steps` | Gate steps ready to drop into a repository's `config/steps.ts` | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/checks` | The documentation, changelog and design-corpus checks | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/knowledge` | BM25 retrieval over the corpus — index, search, read, related | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/mcp` | The MCP server behind `warden serve` — its tools and resources | [warden/README.md][warden-readme] |
| `@y-core/forge/warden` | The whole of warden, for the `warden` command alone | [warden/README.md][warden-readme] |
| `@y-core/forge/warden/canon/*.md` | The fleet canon as markdown, by filename | [warden/README.md][warden-readme] |

> **There is no aggregate `storage` or `ui` barrel** — each client and each UI surface is imported from its own subpath above.
>
> **Internal only:** `src/crypto/` is not a public namespace — it has no export path and its symbols are `@internal`. Its capabilities surface
> through whichever namespace owns the concern. See [src/crypto/README.md][crypto-readme].

---

## License

MIT — see [LICENSE](LICENSE). This covers everything the package ships, including the design corpus in `src/ui/design/`.

[app-readme]: src/app/README.md
[assets-readme]: src/assets/README.md
[auth-readme]: src/auth/README.md
[cf-readme]: src/tooling/cf/README.md
[changelog]: CHANGELOG.md
[cli-readme]: src/tooling/cli/README.md
[config-readme]: src/config/README.md
[context-readme]: src/context/README.md
[crypto-readme]: src/crypto/README.md
[curate-readme]: src/tooling/curate/README.md
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
[output-pdf-readme]: src/output/pdf/README.md
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
