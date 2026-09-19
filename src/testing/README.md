---
title: Test Fixtures for Forge Apps
description: "The fixtures a consumer would otherwise hand-roll: a loaded request context, real CSRF minting, in-memory storage fakes, and an SSR render helper."
audience: consumer
---

# `@y-core/forge/testing`

Every suite for a forge app needs the same handful of fixtures: a request context the production accessors accept, storage bindings that behave the
way the real ones do, a CSRF token that actually verifies, and a way to turn a component into the string you assert against. This namespace ships
them.

Import it from test files only. Everything is reached from the barrel except the `wrangler dev` helper, which has its own subpath and is
deliberately not re-exported ([`TEST_RUNNERS.md`][testing-7f] §7f).

---

## Getting started

```ts
import { buildRequest, createTestContext, fakeD1, fakeKV, mintTestCsrfToken, render } from "@y-core/forge/testing";
```

Reach the code under test either by dispatching through the app or by building a context, and the choice decides which fixtures you need.

**Dispatch through the app** when the assertion is about wiring — routing, middleware order, headers, status. `app.request(path, init, env)` runs
the real chain, and the third argument is where the fake bindings go.

```ts
const res = await app.request("/settings", { method: "POST", body: new URLSearchParams({ theme: "dark" }) }, { SETTINGS_KV: fakeKV() });
```

**Build a context** when the assertion is about one function. `createTestContext` hands a handler or a middleware the context the router would have
built for it, with no app in the way.

```ts
const c = createTestContext<AppEnv, AppConfig>(buildRequest("/settings"), { env: { SETTINGS_KV: fakeKV() }, config: testConfig });
const res = await settingsHandler(c);
```

---

## Exercising one handler or middleware

`createTestContext` takes the request and, optionally, whatever else the router injects. Every one you leave out gets an inert
stand-in: an empty `env`, an `ExecutionContext` whose members do nothing, no config, and `nullLogger`. Pass a field only when the assertion touches
it.

```ts
const c = createTestContext(buildRequest("/settings", { formData: { theme: "dark" } }), { env: { SETTINGS_KV: fakeKV() } });
```

Pass `logger` when the assertion is about what was logged. Spreading `nullLogger` keeps the other methods silent:

```ts
const records: string[] = [];
const logger = { ...nullLogger, info: (message: string) => records.push(message) };

await auditMiddleware(createTestContext(buildRequest("/admin"), { logger }), next);
expect(records).toEqual(["admin.viewed"]);
```

Pass `executionCtx` — usually `mockExecutionContext()`, held in a variable — when the assertion is about `waitUntil`.

`buildRequest(path, options)` is there so no test writes `new Request(…)` or hardcodes an origin: a relative path resolves against `http://test`,
the method is inferred from whether there is a body, and `formData`/`json` set their own content-type. Supply exactly one body helper
([`TEST_RUNNERS.md`][testing-7d] §7d).

---

## Driving the whole app through a route

`mapHandler` registers a single route on a real `Forge` app, so a test exercising one endpoint does not need a route map and a controller.

```ts
import { createApp } from "@y-core/forge/app";
import { mapHandler } from "@y-core/forge/testing";

const app = createApp<AppEnv>();
mapHandler(app, "POST", "/settings", { middleware: [requireSignIn], handler: settingsHandler });

const res = await app.request("/settings", { method: "POST", body: new URLSearchParams({ theme: "dark" }) }, TEST_ENV);
```

The action is either a bare handler or a `{ middleware, handler }` object — the same shapes a real controller accepts. When the test is about
the production registration path itself, register it that way instead ([`TEST_RUNNERS.md`][testing-7e] §7e).

---

## Standing in for a Workers binding

The fakes implement the structural contracts the `storage` and `app` namespaces consume, so they drop straight into an `env`. Each takes a seed of
plain strings:

```ts
const TEST_ENV = {
  SETTINGS_KV: fakeKV({ "user:1": JSON.stringify({ theme: "dark" }) }),
  MEDIA: fakeR2({ "logo.svg": "<svg/>" }),
  ASSETS: fakeAssetsFetcher({ "/assets/app.css": "body{margin:0}" }),
};
```

`fakeD1` is the one that does two jobs. Its first argument answers the rows for a statement, and every bound statement is recorded on `calls`, so
one fake covers the arrange and the assert:

```ts
import { createD1Client, sql } from "@y-core/forge/storage/db";

const db = fakeD1((text) => (text.includes("users") ? [{ id: 1, email: "ada@example.com" }] : []));
const found = await createD1Client(db, { logger: nullLogger }).query(sql`SELECT * FROM users WHERE id = ${1}`);

expect(found).toEqual({ ok: true, data: [{ id: 1, email: "ada@example.com" }] });
expect(db.calls[0]).toEqual({ sql: "SELECT * FROM users WHERE id = ?", params: [1] });
```

Its options bag is about the database's behaviour, not its data. `failOn` is how a test reaches an error path — return an `Error` for
the statement that should blow up, `null` for every other. `rowsWritten` is how a write claims to have changed something: the default is zero, which
is what makes a `requireRowsWritten()` guard fire, so a batch that is meant to commit has to say so.

```ts
const db = fakeD1(() => [], { rowsWritten: (text) => (text.startsWith("UPDATE") ? 1 : 0) });
```

**These fakes refuse what the real binding refuses** — a too-short TTL, a range wholly outside an object, a column the row does not carry. When a
test goes red against one of those, the fake is telling you what production would do; [`TEST_RUNNERS.md`][testing-7b] §7b has the list and the
reasoning, and [`TESTING.md`][canon-testing-4] §4 has the standing ban on mock libraries.

---

## Asserting an expiry without waiting for one

`fakeKV` judges every write's expiry against the clock you give it, so a TTL test costs no wall-clock time. Advance the clock; do not sleep.

```ts
let now = Date.UTC(2026, 0, 1);
const kv = fakeKV({}, { now: () => now });

await kv.put("otp:ada", "123456", { expirationTtl: 300 });
now += 301_000;

expect(await kv.get("otp:ada", { type: "text" })).toBeNull();
```

The clock is milliseconds and defaults to `Date.now`. An expired key is gone from `get`, `getWithMetadata` and `list` alike, as it is in a real
namespace.

---

## Seeding an account for an auth test

`fakeAuthD1` is `fakeD1` with forge's auth schema already modelled. State the accounts in domain terms and it answers the user, factor and admin
stores' own statements, binding each id as the 16 `BLOB` bytes for you; it also holds the challenge and nonce rows written to it, so a taken
challenge is spent and a replayed nonce loses.

```ts
const DB = fakeAuthD1([{ id: ADA, email: "ada@example.com", isAdmin: true, factors: [{ kind: "passkey" }] }]);
```

`id` and `email` are the whole requirement. Everything else defaults to the ordinary case — a verified, active, non-admin account with no factors
and no revocation barrier — so each field you write is a departure from it. The departures worth knowing: `deactivatedAt` gives you the
suspended account, and `confirmedAt: null` on a factor gives the enrolment that was begun and never finished, which is how the pending-enrolment
and step-up paths are reached.

It takes the same options as `fakeD1`, and a `rowsWritten` you supply leads — return `null` from it to fall through to the modelled tables.

Mounting a full auth app, seeding a signed-in session, and the CSRF round trip through it are all in [`src/auth/README.md`][auth-readme].

---

## Posting through CSRF protection

`mintTestCsrfToken` mints a token with the production minter, so a POST test needs no prior GET and nothing is mocked
([`TESTING.md`][canon-testing-5c] §5c). The secret is a hex string — the same one the app under test is configured with.

```ts
const TEST_CSRF_SECRET = "a".repeat(64);

const token = await mintTestCsrfToken(TEST_CSRF_SECRET, "/api/contact");
const res = await app.request(
  "/api/contact",
  { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: token, name: "Jane" }) },
  TEST_ENV,
);
```

A token is bound to the path it was minted for, so mint it for the path you are posting to. Where `csrfProtection` was mounted with a subject
resolver, pass the same subject — usually the session id — as `{ subject }`, or verification answers `subject-mismatch`.

---

## Asserting rendered markup

`render` turns a JSX element into the exact HTML string. One render, one `toBe` on the whole output, and the file is a `.test.tsx`:

```tsx
expect(await render(<p class="lead">Save & Exit</p>)).toBe('<p class="lead">Save &amp; Exit</p>');
```

The entity encoding is the point of asserting the whole string, and `toContain` is banned rather than discouraged —
[`TEST_RUNNERS.md`][testing-3c] §3c owns the shape, including the one whole-element assertion a `ui/core` component file is allowed.

---

## Asserting on one element of a whole page

A page served through `app.request` is too long to `toBe`, and a nonce makes it different on every render. The rule does not relax for that
([`TESTING.md`][canon-testing-3a] §3a): cut the element out and assert it whole, so the substring never stands in for the markup.

```ts
import { attrOf, elementOf, innerOf } from "@y-core/forge/testing";

const html = await (await app.request("/account", { headers: { cookie } }, TEST_ENV)).text();

expect(elementOf(html, "title")).toBe("<title>Your account — Forge Studio</title>");
expect(elementOf(html, "span", 'data-ref="account-email"')).toBe('<span data-ref="account-email">a&amp;b@example.com</span>');
expect(attrOf(elementOf(html, "form"), "action")).toBe("/auth/signout");
```

`elementOf(html, tag, selector?)` is the whole first element of that tag, children included — or, given a selector, the first whose opening tag
carries that attribute spelled exactly as rendered; a void element such as `<meta>` is its opening tag. Reach for `innerOf` when the case is about
an element's children, `attrOf`, `attrsOf` or `classesOf` when it is about one attribute, every attribute or the class list, and
`variantClasses(html, baseline, selector?)` when it is about which class tokens one render added and dropped against another. Each answers `""` or
an empty record for an element the page never rendered, which a `toBe` against the expected markup turns into a failure.

Children are cut at the first closing tag of the same name, so for an element nested inside another of its own kind, name the inner one by a
selector rather than reaching for the outer.

---

## Running a suite in the real Workers runtime

`@y-core/forge/testing/workerd` starts `wrangler dev` over a fixture, so a spec can drive forge inside workerd instead of Bun. It is node-only: a
suite reaches it by name, references the types shim in the file that imports it, and needs no `exclude` and no `node` entry in its `types` array
([`TEST_RUNNERS.md`][testing-7f] §7f). `wrangler` is an optional peer dependency, resolved from your own tree — a suite that imports this subpath
installs it.

```ts
/// <reference types="@y-core/forge/testing/node" />
import { afterAll, beforeAll } from "bun:test";
import { type DevServer, startDevServer } from "@y-core/forge/testing/workerd";

let server: DevServer;

beforeAll(async () => {
  server = await startDevServer({ entry: "src/worker.dev.ts", readyPath: "/api/health", capture: true });
}, 200_000);

afterAll(() => server?.stop());
```

Every option is optional. `entry` and `config` say what to serve. `vars` are written to a temp env file, which
replaces `.dev.vars` discovery rather than adding to it, so name every secret the fixture needs. `readyPath` is what the readiness probe fetches —
any answer counts, a 404 included, so point it at something cheap. `capture` keeps stdout and stderr for `server.logs()` and folds them into the
error when the server never comes up; without it they are discarded.

Give the `beforeAll` a generous timeout: a cold `wrangler dev` start is measured in tens of seconds.

**Send requests to `server.origin`; hand the app `server.siteOrigin`.** The two differ by scheme, and that is not cosmetic — the dev server stamps
`https` onto origin-bearing headers before the Worker sees them, so an app told the http origin refuses its own suite at the origin guard.
`SITE_ORIGIN` is written to the env file as `siteOrigin` for you, and your `vars` are merged over it.

`stop()` takes down the whole process tree and removes the temp file. The same kill is bound to the runner's exit and signals, so an interrupted run
leaves nothing behind ([`TEST_RUNNERS.md`][testing-1f] §1f).

---

## Gotchas

**`app.request` takes a `RequestInit`, not a `Request`.** A `buildRequest` result goes to `createTestContext`, or to `app.fetch(request, env, ctx)`
when you want the whole chain — passing it as the second argument of `app.request` is the mistake that silently loses the body. `app.fetch`
requires an execution context: pass `mockExecutionContext()`, or `collectExecutionContext()` when the assertion is about the deferred work itself —
its `pending` shows that work was handed over, and `drain()` is what lets it finish, so a test can assert the in-between state that `app.request`
never exposes.

**`fakeD1.calls` records at `bind`, not at `prepare`.** Everything `createD1Client` issues binds, so this only bites a test driving `db.prepare(…)`
by hand, or one asserting on an `exec()` that was never a prepared statement.

**`createD1Client` logs every statement at debug** through a logger of its own unless you pass one. `{ logger: nullLogger }` keeps the test output
readable.

**A statement `fakeAuthD1` does not model answers no rows** rather than throwing — which reads as "absent", not "failed". A test that needs a value
to survive a round trip through an unmodelled table hands the code its own store instead ([`src/auth/README.md`][auth-readme]).

---

## See also

- [`docs/TEST_RUNNERS.md`][testing-7] §7 — the rulings behind every fixture here, and why `testing` may import `app` and `jsx`
- [`docs/TEST_RUNNERS.md`][testing-3c] §3c — render once, assert once
- [`src/auth/README.md`][auth-readme] — testing an auth mount: sessions, challenges, and the CSRF round trip
- [`src/storage/README.md`][storage-readme] — the D1, KV and R2 clients these fakes stand in for
- [`TESTING.md`][canon-testing-4] §4 — fakes over mocks, and the no-mock-library ban

[auth-readme]: ../auth/README.md
[canon-testing-3a]: ../../warden/canon/libs/TESTING.md#3a-assert-the-escaped-form
[canon-testing-4]: ../../warden/canon/libs/TESTING.md#4-fakes-over-mocks
[canon-testing-5c]: ../../warden/canon/libs/TESTING.md#5c-no-mocking-of-security-primitives
[storage-readme]: ../storage/README.md
[testing-1f]: ../../docs/TEST_RUNNERS.md#1f-the-workerd-set
[testing-3c]: ../../docs/TEST_RUNNERS.md#3c-render-once-assert-once
[testing-7]: ../../docs/TEST_RUNNERS.md#7-testing-namespace-utilities-y-coreforgetesting
[testing-7b]: ../../docs/TEST_RUNNERS.md#7b-in-memory-storage-fakes--fakekv-faked1-faker2
[testing-7d]: ../../docs/TEST_RUNNERS.md#7d-buildrequest--request-builder
[testing-7e]: ../../docs/TEST_RUNNERS.md#7e-maphandler-and-testaction--single-route-registrar
[testing-7f]: ../../docs/TEST_RUNNERS.md#7f-the-one-subpath-that-is-not-on-the-barrel--y-coreforgetestingworkerd
