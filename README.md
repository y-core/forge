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

`@y-core/forge/render/jsx` renders a JSX tree to a string inside the Worker. No virtual DOM, no hydration, no reconciler, and **nothing from the
renderer reaches the browser**. Escaping happens at render time; URL-bearing attributes are scheme-sanitized for you; a `style` attribute is
dropped, because the shipped CSP carries no `style-src 'unsafe-inline'`.

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
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@y-core/forge/render/jsx" } }
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

## Namespaces

Import from `@y-core/forge/{namespace}`, never from a package forge wraps. Each namespace teaches its own use in the `README.md` beside its barrel,
or in the nearest parent directory's for a nested subpath; warden's is [warden/README.md][warden-readme]. The subpaths themselves are `package.json`
`exports`.

---

## License

MIT — see [LICENSE](LICENSE). This covers everything the package ships, including the design corpus in `src/ui/design/`.

[app-readme]: src/app/README.md
[changelog]: CHANGELOG.md
[warden-readme]: warden/README.md
