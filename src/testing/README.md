---
title: Test Fixtures for Forge Apps
description: "The fixtures every consumer previously hand-rolled: a loaded request context, real CSRF minting, in-memory storage fakes, and an SSR render helper."
---

# `@y-core/forge/testing`

Shared test utilities for apps built on forge — the fixtures every consumer previously hand-rolled: a pre-loaded request context, real CSRF token minting, typed in-memory storage fakes, an SSR render helper, a `Request` builder, and a single-route registrar.

This is an **integration namespace** (composes `context`, `app`, `jsx`, `logging`, `form`, and `storage/db`/`storage/kv`/`storage/r2` types). Reaching into `app` and `jsx` is the declared, acceptable edge for a test-only namespace — see [docs/TESTING.md](../../docs/TESTING.md) §7a. It is intended for **test code only** — never import it from Worker source files.

The namespace publishes a second subpath, `@y-core/forge/testing/workerd`, and it is **node-only and deliberately off the barrel**: it reads `node:child_process`, `node:fs` and `node:net` to run a `wrangler dev` fixture, so a Worker-side test program must not be able to reach it through `@y-core/forge/testing` — see [docs/TESTING.md](../../docs/TESTING.md) §7f.

---

## `@y-core/forge/testing`

> Import path: `@y-core/forge/testing` → `src/testing/mod.ts`
> **Test-only.** Never import it from a Worker source file.

### Exports

| Symbol | Kind | Summary |
| --- | --- | --- |
| `createTestContext` | function | `RequestContext` pre-loaded with `env`/`executionCtx`/`config`/request logger — exactly as the Forge router injects them. Satisfies `getAppContext`. |
| `TestContextOptions` | type | Options for `createTestContext` (`env`, `config`, `executionCtx`, `logger`). |
| `mockExecutionContext` | function | `ExecutionContext` whose `waitUntil`/`passThroughOnException` are no-ops. |
| `nullLogger` | const | `Logger` that drops everything; `child()` returns itself. |
| `mintTestCsrfToken` | function | Imports a hex secret and mints a real path-bound CSRF token in one call (production primitives — no mocking). |
| `fakeKV` | function | In-memory `KVNamespace` fake (text + arrayBuffer modes, metadata, prefix `list`, offset-cursor pagination). Accepts a view or a stream, **throws** below KV's 60-second `expirationTtl` floor, and **expires** a key against its clock — an expired key is absent from `get`, `getWithMetadata` and `list` alike. |
| `FakeKVOptions` | type | Options for `fakeKV`: `now()` is the millisecond clock every write's expiry is resolved and judged against, defaulting to `Date.now` — inject one to advance time and assert an expiry. |
| `fakeD1` | function | Programmable `D1DatabaseLike` stub; a `query` responder controls results and every bound statement records into `calls`. `first(column)` **rejects** an unknown column. |
| `FakeD1Options` | type | Options for `fakeD1`: `failOn(sql, params)` returns an `Error` to make that statement reject; `rowsWritten(sql, params)` is what a `run()` reports written, zero unless supplied. |
| `fakeAuthD1` | function | `fakeD1` preloaded with forge's auth schema: answers the user and factor stores' own statements from accounts stated in domain terms, binding each id as the 16 `BLOB` bytes for you. Takes the same `FakeD1Options`. |
| `FakeAuthUser` | type | One account `fakeAuthD1` answers with — `id` (canonical UUID) and `email` required; `emailKey`, `emailVerifiedAt`, `webauthnId`, `isAdmin`, `deactivatedAt`, `createdAt`, `updatedAt` and `factors` all default. |
| `FakeAuthFactor` | type | One enrolment on a `FakeAuthUser`: `kind`, plus optional `id`, `secret`, `lastCounter` and `confirmedAt` — `confirmedAt: null` is what an unconfirmed enrolment looks like to the registry. |
| `fakeR2` | function | Functional in-memory `R2BucketLike` fake — `put`/`get`/`head`/`delete`/`list` with working `arrayBuffer()`/`text()`/`blob()`, cursor + `delimiter` + `include` on `list`, and an `UnsatisfiableRangeError` for a range wholly outside the object. |
| `fakeAssetsFetcher` | function | `AssetsFetcher` fake serving from a path→body map (`200`/`404`). |
| `render` | function | Renders a JSX element to its exact HTML string for `toBe` assertions (wraps the `jsx` render runtime). |
| `buildRequest` | function | Builds a `Request` from a path plus optional `method`/`headers`/`formData`/`json`/`body`/`baseUrl` — kills `new Request(...)` boilerplate. |
| `mapHandler` | function | Registers a single route on a `Forge` app in tests, mirroring `app.map(routes, controller)`. |
| `TestAction` | type | Route action for `mapHandler`: a bare `RequestHandler` or a `{ middleware, handler }` object. |

## Usage

```ts
import { createTestContext, fakeKV, mintTestCsrfToken } from "@y-core/forge/testing";

// Direct handler test — no app dispatch needed:
const c = createTestContext<AppEnv, AppConfig>(new Request("http://test/settings"), { env: { SETTINGS_KV: fakeKV() }, config: testConfig });
const res = await settingsHandler(c);

// POST through csrfProtection without a prior GET:
const token = await mintTestCsrfToken(TEST_CSRF_SECRET, "/api/contact");
const posted = await app.request(
  "/api/contact",
  { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: token, name: "Jane" }) },
  TEST_ENV,
);
```

Prefer `app.request(...)` (the `Forge` test helper) for full-chain integration tests; reach for `createTestContext` when exercising a single handler or middleware in isolation.

```ts
import { fakeD1, fakeR2, render, buildRequest, mapHandler } from "@y-core/forge/testing";
import { createD1Client } from "@y-core/forge/storage/db";
import { Forge } from "@y-core/forge/app";

// Programmable D1 — control results and assert the queries issued:
const db = fakeD1((sql) => (sql.includes("users") ? [{ id: 1, name: "Ada" }] : []));
const client = createD1Client(db);
const rows = await client.query(sql`SELECT * FROM users`);
expect(db.calls[0].sql).toContain("users");

// In-memory R2 with a working body reader:
const bucket = fakeR2({ "logo.svg": "<svg/>" });
const obj = await bucket.get("logo.svg");
expect(await obj?.text()).toBe("<svg/>");

// Exact-match component assertion (render once, assert once):
expect(await render(<Button label="Save" />)).toBe('<button type="button">Save</button>');

// Single-route registrar + Request builder:
const app = new Forge<AppEnv>();
mapHandler(app, "POST", "/settings", settingsHandler);
const req = buildRequest("/settings", { formData: { theme: "dark" } });
const res = await app.request("/settings", req, TEST_ENV);
```

## `@y-core/forge/testing/workerd`

> Import path: `@y-core/forge/testing/workerd` → `src/testing/workerd.ts`
> **Node-only, and off the `./testing` barrel.** Import it from a suite the node process runs, never from Worker source or a Worker-side test program.

### Exports

| Symbol | Kind | Summary |
| --- | --- | --- |
| `startDevServer` | function | Starts `wrangler dev` over a fixture in its own process group and resolves once the readiness probe gets any answer. |
| `DevServer` | type | The running server: `origin`, `siteOrigin`, `logs()`, and a `stop()` that kills the group and removes the temp env file. |
| `DevServerOptions` | type | What to serve and how: `entry`, `config`, `vars`, `readyPath`, `capture` — every one optional. |

`stop()` sends `SIGKILL` to the **process group**, because wrangler spawns workerd and esbuild as its own children and killing the CLI alone orphans them. The same sweep is bound to the runner's `exit`, `SIGINT`, `SIGTERM` and `SIGHUP`, so an interrupted run that never reaches `afterAll` still takes its children down.

`wrangler` is an **optional peer dependency** and is resolved out of the consumer's own tree — a suite that imports this subpath installs it.

```ts
import { afterAll, beforeAll } from "bun:test";
import { type DevServer, startDevServer } from "@y-core/forge/testing/workerd";

let server: DevServer;

beforeAll(async () => {
  server = await startDevServer({ entry: "src/worker.dev.ts", vars: { TURNSTILE_SECRET: "1x0000000000000000000000000000000AA" }, readyPath: "/api/health" });
}, 200_000);

afterAll(() => server?.stop());
```

`SITE_ORIGIN` is always written to the temp env file as `siteOrigin` — `https://127.0.0.1:{port}`, not `origin` — because the dev server stamps `https` onto origin-bearing headers before the Worker sees them, so an app handed the http origin refuses its own suite at the origin guard. Requests still go to `origin`.

## Design rules

- **Real primitives, typed fakes.** `mintTestCsrfToken` wraps the production `importCsrfKey`/`createCsrfToken`; the fakes implement the real structural contracts (`KVNamespace`, `D1DatabaseLike`, `R2BucketLike`, `AssetsFetcher`) so interface drift breaks tests at compile time. No mock libraries (see [docs/TESTING.md](../../docs/TESTING.md) §4).
- **No wall-clock behavior.** `fakeKV` enforces an expiry against the clock passed as `now`, defaulting to `Date.now` — assert one by advancing an injected clock, never by letting real time pass. The TTL _floor_ is a constant rather than a clock, and is enforced either way.
- **The fakes refuse what the platform refuses.** A fake that is green where the real binding throws certifies code that fails on deploy. When a test fails against one of these refusals, fix the test — not the fake.
- **Render once, assert once.** Use `render()` with a single entity-aware `toBe` on the full markup — never substring `toContain`/`toMatch` (see [docs/TESTING.md](../../docs/TESTING.md) §3, §7c).
