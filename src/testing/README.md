# `@y-core/forge/testing`

Shared test utilities for apps built on forge — the fixtures every consumer previously hand-rolled: a pre-loaded request context, real CSRF token minting, and typed in-memory fakes.

This is an **integration namespace** (composes `context`, `app`, `logging`, `form`, and `storage/kv` types). It is intended for **test code only** — never import it from Worker source files.

---

## Exports

| Symbol | Kind | Summary |
|---|---|---|
| `createTestContext` | function | `RequestContext` pre-loaded with `env`/`executionCtx`/`config`/request logger — exactly as the Forge router injects them. Satisfies `getAppContext`. |
| `TestContextOptions` | type | Options for `createTestContext` (`env`, `config`, `executionCtx`, `logger`). |
| `mockExecutionContext` | function | `ExecutionContext` whose `waitUntil`/`passThroughOnException` are no-ops. |
| `nullLogger` | const | `Logger` that drops everything; `child()` returns itself. |
| `mintTestCsrfToken` | function | Imports a hex secret and mints a real path-bound CSRF token in one call (production primitives — no mocking). |
| `fakeKV` | function | In-memory `KVNamespace` fake (text + arrayBuffer modes, metadata, prefix `list`). |
| `fakeAssetsFetcher` | function | `AssetsFetcher` fake serving from a path→body map (`200`/`404`). |

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

## Design rules

- **Real primitives, typed fakes.** `mintTestCsrfToken` wraps the production `importCsrfKey`/`createCsrfToken`; the fakes implement the real structural contracts (`KVNamespace`, `AssetsFetcher`) so interface drift breaks tests at compile time. No mock libraries (see [.decisions/TESTING.md](../../.decisions/TESTING.md) §4).
- **No wall-clock behavior.** `fakeKV` accepts TTLs but does not enforce expiry — tests must not depend on time passing.
