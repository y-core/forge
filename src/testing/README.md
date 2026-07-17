# `@y-core/forge/testing`

Shared test utilities for apps built on forge — the fixtures every consumer previously hand-rolled: a pre-loaded request context, real CSRF token minting, typed in-memory storage fakes, an SSR render helper, a `Request` builder, and a single-route registrar.

This is an **integration namespace** (composes `context`, `app`, `jsx`, `logging`, `form`, and `storage/db`/`storage/kv`/`storage/r2` types). Reaching into `app` and `jsx` is the declared, acceptable edge for a test-only namespace — see [.decisions/TESTING.md](../../.decisions/TESTING.md) §7a. It is intended for **test code only** — never import it from Worker source files.

---

## Exports

| Symbol | Kind | Summary |
|---|---|---|
| `createTestContext` | function | `RequestContext` pre-loaded with `env`/`executionCtx`/`config`/request logger — exactly as the Forge router injects them. Satisfies `getAppContext`. |
| `TestContextOptions` | type | Options for `createTestContext` (`env`, `config`, `executionCtx`, `logger`). |
| `mockExecutionContext` | function | `ExecutionContext` whose `waitUntil`/`passThroughOnException` are no-ops. |
| `nullLogger` | const | `Logger` that drops everything; `child()` returns itself. |
| `mintTestCsrfToken` | function | Imports a hex secret and mints a real path-bound CSRF token in one call (production primitives — no mocking). |
| `fakeKV` | function | In-memory `KVNamespace` fake (text + arrayBuffer modes, metadata, prefix `list`, offset-cursor pagination, `expiration`). |
| `fakeD1` | function | Programmable `D1DatabaseLike` stub; a `query` responder controls results and every bound statement records into `calls`. |
| `fakeR2` | function | Functional in-memory `R2BucketLike` fake — `put`/`get`/`head`/`delete`/`list` with working `arrayBuffer()`/`text()`/`blob()` and cursor `list`. |
| `fakeAssetsFetcher` | function | `AssetsFetcher` fake serving from a path→body map (`200`/`404`). |
| `render` | function | Renders a JSX element to its exact HTML string for `toBe` assertions (wraps the `jsx` render runtime). |
| `buildRequest` | function | Builds a `Request` from a path plus optional `method`/`headers`/`formData`/`json`/`body`/`baseUrl` — kills `new Request(...)` boilerplate. |
| `mapHandler` | function | Registers a single route on a `Forge` app in tests, mirroring `app.map(routes, controller)`. |
| `TestAction` | type | Route action for `mapHandler`: a bare `RequestHandler` or a `{ middleware, handler }` object. |

## Usage

```ts
import { createTestContext, fakeKV, mintTestCsrfToken } from "@y-core/forge/testing";

// Direct handler test — no app dispatch needed:
const c = createTestContext<AppEnv, AppConfig>(new Request("http://test/settings"), {
  env: { SETTINGS_KV: fakeKV() },
  config: testConfig,
});
const res = await settingsHandler(c);

// POST through csrfProtection without a prior GET:
const token = await mintTestCsrfToken(TEST_CSRF_SECRET, "/api/contact");
const posted = await app.request("/api/contact", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: token, name: "Jane" }),
}, TEST_ENV);
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

## Design rules

- **Real primitives, typed fakes.** `mintTestCsrfToken` wraps the production `importCsrfKey`/`createCsrfToken`; the fakes implement the real structural contracts (`KVNamespace`, `D1DatabaseLike`, `R2BucketLike`, `AssetsFetcher`) so interface drift breaks tests at compile time. No mock libraries (see [.decisions/TESTING.md](../../.decisions/TESTING.md) §4).
- **No wall-clock behavior.** `fakeKV` accepts TTLs but does not enforce expiry — tests must not depend on time passing.
- **Render once, assert once.** Use `render()` with a single entity-aware `toBe` on the full markup — never substring `toContain`/`toMatch` (see [.decisions/TESTING.md](../../.decisions/TESTING.md) §3, §7c).
