---
title: Testing Discipline
description: "bun test, co-located tests, *.test.ts, *.test.tsx, fakes over mocks, HTML entity exact-match assertions, bun:test primitives, describe it expect, validate-exports gate, bun run check, security test requirements pass and fail cases, declarative route registration, app.request helper, MINIMUM_ENV, mapHandler, no substring matching, testing namespace, fakeKV, fakeD1, fakeR2, cursor pagination, render render-to-string, buildRequest, TestAction, in-memory fakes"
weight: 35
---

# Testing Discipline

> Authoritative source for test file placement, assertion rules, the bun test runner,
> fake patterns, and the `bun run check` gate that must pass before any commit.
>
> Complements [PRODUCTION_TS_RULES.md](./PRODUCTION_TS_RULES.md) §4 (testability rule),
> [NAMESPACE_DESIGN.md](./NAMESPACE_DESIGN.md) (validate-exports gate).

---

## 0. Quick Reference

- §1 bun test runner: `describe`/`it`/`expect`, `bun:test` stub, no `bun-types`
- §2 Co-located test files: `source.ts` → `source.test.ts`, same directory
- §3 HTML entity exact-match assertion rule: never substring matching
- §4 Fakes over mocks: interface implementation pattern
- §5 Security test requirements: both pass AND fail cases required; §5d matrix row-to-test coverage map
- §6 `bun run check` gate: typecheck + lint + test + validate-exports
- §7 `@y-core/forge/testing` utilities: `fakeKV`/`fakeD1`/`fakeR2` storage fakes, `render`, `buildRequest`, `mapHandler`/`TestAction`

---

## 1. bun test Runner

### 1a. bun:test Primitives

Import all test utilities from `bun:test` — never from a third-party test library.

    import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"

    describe("parseUrl", () => {
      it("parses a valid URL", () => {
        const r = parseUrl("https://example.com")
        expect(r.ok).toBe(true)
        expect(r.value.hostname).toBe("example.com")
      })
    })

`describe` organises related cases. `it` is a single case. Nest `describe` blocks
for sub-grouping, but keep nesting to at most two levels deep to preserve readability.

Available lifecycle hooks: `beforeAll`, `afterAll`, `beforeEach`, `afterEach`.
Use `beforeEach`/`afterEach` for stateful setup that must reset between cases.
Use `beforeAll`/`afterAll` only for expensive one-time setup (e.g., building fixtures).

### 1b. Custom bun:test Stub — No bun-types

Forge uses a hand-written stub at `types/bun-test/index.d.ts` rather than the
`bun-types` package. This is a hard requirement:

- `bun-types` overrides DOM's `fetch` signature with Bun-specific properties
- That override breaks type-checking of `fetch` in Worker code and test fakes
- The custom stub declares exactly: `describe`, `it`, `expect`, `beforeAll`,
  `afterAll`, `beforeEach`, `afterEach`, `mock` — nothing more

Do NOT install `@types/bun` or `bun-types`. Do NOT reference them in `tsconfig.json`
or `package.json`. Any PR that adds these packages must be rejected.

### 1c. Running Tests

    bun test                          # all tests
    bun test src/security/            # tests under a specific directory
    bun test --watch                  # rerun on file change (dev only)
    bun run check                     # full gate: typecheck + lint + test + validate-exports

`bun test` discovers all `*.test.ts` and `*.test.tsx` files automatically. No
configuration file or explicit test list is needed.

---

## 2. Co-Located Test Files

### 2a. Test File Naming Convention

Every source file that contains non-trivial logic has a co-located test file with
the `.test.ts` (or `.test.tsx` for JSX) suffix in the same directory:

    src/security/headers.ts          → src/security/headers.test.ts
    src/form/csrf.ts                 → src/form/csrf.test.ts
    src/ui/core/button.tsx           → src/ui/core/button.test.tsx
    src/router/resolve.ts            → src/router/resolve.test.ts

Test files do NOT go into a top-level `__tests__/` or `test/` directory. Co-location
makes it immediately visible whether a file has test coverage and simplifies relative
imports (see §2c).

### 2b. Excluded from npm Publish

`package.json` `"files"` excludes all test files:

    "files": [
      "src/**/*.ts",
      "src/**/*.tsx",
      "!**/*.test.ts",
      "!**/*.test.tsx"
    ]

Test files exist only in the source repository — they are never shipped to consumers.
This keeps the published package lean and prevents consumers from accidentally
importing test helpers.

### 2c. Import from Relative Paths in Tests

    // In src/security/headers.test.ts:
    import { createSecurityHeaders } from "./headers"
    import { requestId }           from "./request-id"

Always import from the concrete source file, not from the namespace barrel
(`./mod.ts`) or the package name (`@y-core/forge/security`). Importing via the
barrel couples the test to the export surface rather than the implementation, and
can mask tree-shaking or re-export bugs that validate-exports is designed to catch.

---

## 3. HTML Entity Exact-Match Assertion Rule

### 3a. The Encoding Map

The JSX renderer escapes dynamic content. When asserting rendered HTML, use the escaped forms:

| Character | Escaped form |
|---|---|
| `'` (apostrophe) | `&#39;` |
| `&` (ampersand) | `&amp;` |
| `<` (less-than) | `&lt;` |
| `>` (greater-than) | `&gt;` |
| `"` in attributes | `&#34;` or `&quot;` |

Static JSX content (string literals in JSX, not interpolated) is NOT escaped by the
renderer — only interpolated values are. Know the difference before writing assertions.

> URL-bearing attributes are an exception: the renderer routes `href`/`src`/`action`/…
> values through `safeUrl`, so a `javascript:` URL renders as `"#"`. Assert the sanitized
> form when testing such attributes.

### 3b. Exact Match — Never Substring Matching

    // BAD: toContain passes even when the entity encoding is wrong
    expect(html).toContain("O'Brien")

    // BAD: toMatch with a partial regex also hides encoding errors
    expect(html).toMatch(/O'Brien/)

    // GOOD: toBe on the full element catches encoding exactly
    expect(html).toBe("<td>O&#39;Brien &amp; Associates</td>")

If the assertion string is too long, extract the relevant DOM fragment using a
helper that parses the full HTML and returns a specific element — then assert `toBe`
on that fragment. Never shorten the assertion by switching to `toContain`.

### 3c. Debugging Entity Encoding

When a test fails unexpectedly on entity encoding, print the raw rendered string:

    const html = await render(<MyComponent name="O'Brien" />)
    console.log(JSON.stringify(html))  // shows escaped characters unambiguously

Read the raw output first, then write the assertion to match it exactly. Do not
adjust the source code to match a wrong assertion.

### 3d. Render Once, Assert Once — the Enforced Convention

The exact-match rule is now enforced across the whole suite via a single render helper.
Render the component once through `render()` from the `@y-core/forge/testing` barrel
(see §7c) and assert the full markup with one `toBe`:

    import { render } from "@y-core/forge/testing"

    it("renders the exact button markup", async () => {
      expect(await render(<Button label="Save & Exit" />)).toBe(
        '<button type="button">Save &amp; Exit</button>',
      )
    })

Do not call the private `jsx` render path, do not render twice to assert two fragments,
and do not fall back to `toContain`/`toMatch`. A single entity-aware `toBe` on the full
output is the only accepted shape (§3b). `render()` awaits the async SSR pipeline and
coerces the result to a plain string, so `expect(await render(<C/>)).toBe(...)` is exact.

---

## 4. Fakes Over Mocks

### 4a. Fake Pattern — Implement the Interface

A fake is a minimal in-test implementation of a real interface. Construct it as a
plain object literal typed to the interface:

    import type { KVNamespace } from "@y-core/forge/storage/kv"

    const fakeKV: KVNamespace = {
      get:             async (_key, _opts) => null,
      put:             async (_key, _val)  => {},
      delete:          async (_key)        => {},
      list:            async ()            => ({ keys: [], list_complete: true }),
      getWithMetadata: async (_key, _opts) => ({ value: null, metadata: null }),
    }

TypeScript enforces that all interface members are present. If the interface gains
a new method, the fake breaks at compile time — you cannot forget to handle it.

### 4b. Why Fakes Over Mocks

| Concern | Fake | Mock library |
|---|---|---|
| API change detection | Compile error | Silent — test passes with stale signature |
| Readability | Setup is explicit object literal | Setup is a chain of `.mockReturnValue(...)` calls |
| Coupling | To the interface contract | To call order, argument matchers, invocation counts |
| Dependencies | None | Requires mock library in dev dependencies |

Mock libraries (jest-mock, sinon, etc.) are not installed and must not be added.
Use argument-capturing fakes (§4c) when you need to inspect calls.

### 4c. Capturing Arguments in Fakes

    let capturedKey = ""
    let capturedValue = ""

    const fakeKV: KVNamespace = {
      put: async (key, value) => {
        capturedKey   = key
        capturedValue = value as string
      },
      // ...other members
    }

    await handler(fakeContext)

    expect(capturedKey).toBe("session:abc123")
    expect(capturedValue).toBe("user-data")

Use `let` captures at the top of the `it` block. Reset them in `beforeEach` if the
fake is shared across multiple cases.

---

## 5. Security Test Requirements

### 5a. Both Pass and Fail Cases Required

Security-sensitive code requires BOTH a positive case (the guard allows a valid
request) AND a negative case (the guard blocks an invalid request). A test suite
with only the happy path is incomplete and must not be merged.

Build the app under test the same way production does — **declaratively**. There is no
imperative `app.get`/`app.post`/`app.all`; routes are registered as a name→`{ method,
pattern }` map (`route()`) bound to a controller (`createController`) and installed with
`app.map(routes, controller)`. Path-scoped middleware (security headers, guards) is added
with `app.use("*", …)`. Drive requests through the built-in `app.request(path, init, env)`
helper, which constructs a `Request`, runs the full middleware chain, and awaits any
`ctx.waitUntil` work:

    import { Forge } from "@y-core/forge/app"
    import { route, createController } from "@y-core/forge/router"
    import { createSecurityHeaders } from "@y-core/forge/security"

    // Minimal environment bindings the handlers read (KV, secrets, base URL, …).
    const MINIMUM_ENV = {
      BASE_URL: "https://example.com",
      CSRF_SECRET: "a".repeat(64), // 32-byte hex
    }

    function buildApp() {
      const app = new Forge<typeof MINIMUM_ENV>()
      app.use("*", createSecurityHeaders())
      const routes = route({ contact: { method: "POST", pattern: "/contact" } })
      app.map(routes, createController(routes, {
        actions: { contact: { middleware: [csrfVerifyGuard], handler: contactHandler } },
      }))
      return app
    }

    const res = await buildApp().request("/contact", { method: "POST" }, MINIMUM_ENV)

In a forge namespace's own unit tests, the test-only `mapHandler(app, method, pattern,
action)` helper registers a single route without writing a full route map.

| Feature | Required positive case | Required negative case |
|---|---|---|
| CSRF protection | Valid token → 200 | Missing or invalid token → 403 |
| Origin check | Same-origin → proceeds | Cross-origin → 403 |
| Rate limiting | Under limit → 200 | Over limit → 429 |
| Input validation | Valid input → renders form with values | Invalid input → renders field errors |
| `isHxRequest` guard | `HX-Request: true` → proceeds | Header absent → 403 |
| Auth middleware | Valid session → proceeds | Missing or expired session → 401 |

### 5b. Negative Case Structure

The negative case must assert the exact response status AND a meaningful response
body fragment — not just the status code. This proves the error path renders
correctly, not merely that it exits early.

    it("rejects missing CSRF token with 403", async () => {
      const res = await buildApp().request(
        "/contact",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "name=Alice&email=alice%40example.com",  // no _csrf field
        },
        MINIMUM_ENV,
      )
      expect(res.status).toBe(403)
      const html = await res.text()
      expect(html).toBe("Forbidden")
    })

### 5c. No Mocking of Security Primitives

Do not mock `createSecurityHeaders`, `verifyCsrfToken`, or other security primitives
to make tests pass. Test with real implementations against a fake binding. If the
real implementation is too hard to invoke in a test, that is a testability signal —
refactor the code to accept injectable dependencies, not a signal to mock.

### 5d. Security Matrix — Row-to-Test Coverage Map

Where each row of the §5a matrix is covered at integration level (through
`app.request()` with real primitives), as of 2026-07-02:

| Matrix row | Covering tests |
|---|---|
| CSRF valid → 200 / invalid → 403 | `src/form/csrf.test.ts` (mint-then-verify, invalid header, missing token, path mismatch, subject mismatch) |
| CSRF 403 carries security headers | `src/app/app.test.ts` "error path carries security headers (F9)" |
| Origin same → 200 / cross or missing → 403 | `src/security/origin.test.ts`, `src/security/cop.test.ts` (Sec-Fetch-Site + Origin/Referer fallback) |
| Rate limit under → 200 / over → 429 / binding absent → 503 / key unresolvable → 503 | `src/security/rate-limit.test.ts`; 429-carries-headers in `src/app/app.test.ts` (F9) |
| Input validation ok / issues | `src/app/action.test.ts` (pipeline), `src/validation/format-issues.test.ts` |
| Body size under / over (Content-Length fast path) | `src/form/parse-form-data.test.ts`, `src/app/action.test.ts` |
| Body size over (streaming, no Content-Length) | `src/form/parse-form-data.test.ts` (direct), `src/app/action.test.ts` (full chain, exact 413 fragment) |
| Content-Type valid / invalid → 415 | `src/security/content-type.test.ts` |
| Log-viewer access allow / deny → 403 | `src/logging/show/route.test.tsx` |
| `isHxRequest` guard | **N/A** — `isHxRequest` is a routing hint for full-page vs fragment renders, not a security boundary (`src/html/htmx/mod.ts`); there is no guard middleware to test |
| Auth middleware valid / expired session | **N/A** — no `auth` namespace exists yet (NAMESPACE_DESIGN.md §5a growth rule); add this row's tests with that namespace |

---

## 6. bun run check Gate

### 6a. The Full Check Pipeline

    bun run check
    # Expands to:
    # bun run typecheck && bun run lint && bun test && bun run validate-exports

All four steps must pass with zero errors before a task is declared complete. A
partial pass (e.g., "types pass, lint has one warning") is a failure.

### 6b. What Each Step Catches

| Step | Tool | What it catches |
|---|---|---|
| `typecheck` | `tsgo` | Type errors, wrong argument types, missing properties |
| `lint` | `biome` | Style violations, banned patterns, no-sibling-barrel rule |
| `bun test` | bun test runner | Functional regressions in all namespaces |
| `validate-exports` | forge internal | Orphaned export paths, missing `mod.ts` entries, broken re-exports |

### 6c. Interpreting Failures

- `typecheck` fails: fix type errors before anything else — they can cascade into
  misleading lint and test failures
- `lint` fails: run `bun run lint:fix` to auto-fix; review remaining manual fixes
- `bun test` fails: never skip a failing test; fix the implementation or the test
- `validate-exports` fails: a namespace has an export path in `package.json` that
  does not resolve to a `mod.ts` — add the missing barrel or remove the export path

Disabling or skipping any of the four steps in CI is not permitted.

---

## 7. Testing Namespace Utilities (`@y-core/forge/testing`)

The `testing` namespace ships the shared fixtures every consumer test suite would
otherwise hand-roll: in-memory storage fakes, an SSR render helper, a `Request`
builder, and a single-route registrar. Import all of them from the barrel — never
from a concrete file — since consumer test code sits outside the source tree:

    import { fakeKV, fakeD1, fakeR2, render, buildRequest, mapHandler } from "@y-core/forge/testing"

### 7a. Declared Integration Edge — testing Imports app and jsx

`testing` is an **integration namespace** (`NAMESPACE_DESIGN.md` §4). It intentionally
composes types and helpers from other forge namespaces — `app` (`Forge`, `AssetsFetcher`),
`jsx` (the private `render-to-string` runtime), `storage/db`, `storage/kv`, `storage/r2`,
`context`, and `form`. A test-only namespace reaching into `app` and `jsx` is the
**declared, acceptable** integration edge: these utilities exist precisely to drive the
app and render pipelines from tests. This is the one place forge source may depend on the
private `jsx` render helper by re-exporting it as `render()` (§7c). See
[NAMESPACE_DESIGN.md](./NAMESPACE_DESIGN.md) §4 for the leaf-vs-integration classification.

### 7b. In-Memory Storage Fakes — fakeKV, fakeD1, fakeR2

Three `Map`-backed fakes implement the real `storage/*` structural contracts, so interface
drift breaks tests at compile time (§4a). Never mock these bindings.

| Fake | Contract | Constructor | Seed |
|---|---|---|---|
| `fakeKV(seed?)` | `KVNamespace` | `fakeKV()` | `Record<string, string>` → keyed values |
| `fakeD1(query?)` | `D1DatabaseLike & { calls }` | `fakeD1()` | programmable responder |
| `fakeR2(seed?)` | `R2BucketLike` | `fakeR2()` | `Record<string, string>` → keyed bodies |

**`fakeKV(seed?)`** — full KV contract (`get`/`getWithMetadata` in `text` and
`arrayBuffer` modes, `put`, `delete`, `list`). `list` filters by `prefix` and now paginates
by **offset-encoded cursor**: when `limit` truncates the page, it returns
`list_complete: false` plus a numeric string `cursor` to resume; an explicit `expiration`
passed to `put` is tracked and surfaced on each returned key. TTLs are accepted but not
enforced — tests must not depend on wall-clock expiry.

    const kv = fakeKV({ "settings||user-1": JSON.stringify({ theme: "dark" }) })
    const first = await kv.list({ limit: 1 })
    if (!first.list_complete) {
      const next = await kv.list({ limit: 1, cursor: first.cursor })
    }

**`fakeD1(query?)`** — programmable `D1DatabaseLike` stub for `createD1Client`-backed code.
The optional `query: (sql, params) => unknown[]` responder is invoked with the executed SQL
and bound params; its return becomes the `results` of `all` (and the first row for `first`),
defaulting to `[]`. Every `prepare(...).bind(...)` records `{ sql, params }` into the
returned `calls` array, so a test can assert **both** the queries issued and control the rows
returned. `run` reports zero writes with default `meta`; `batch` maps the responder over each
statement.

    const db = fakeD1((sql) => (sql.includes("users") ? [{ id: 1, name: "Ada" }] : []))
    const client = createD1Client(db)
    const rows = await client.query(sql`SELECT * FROM users`)
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].sql).toContain("users")

**`fakeR2(seed?)`** — functional in-memory `R2BucketLike` mirroring `fakeKV`. `put` stores
body bytes plus optional http/custom metadata and returns an `R2ObjectLike`; `get` returns an
`R2ObjectBodyLike` with working `arrayBuffer()`/`text()`/`blob()` and a `body` stream; `head`
returns metadata without a body; `delete` accepts one key or an array; `list` honors
`prefix`/`limit`/`cursor` with offset-encoded cursors (`truncated` + `cursor`). Etags are a
deterministic content hash.

    const bucket = fakeR2({ "logo.svg": "<svg/>" })
    const backend = r2Backend(bucket)
    const obj = await backend.get("logo.svg")
    expect(await obj?.text()).toBe("<svg/>")

### 7c. render() — SSR Render-to-String

`render(element): Promise<string>` renders a JSX element to its exact HTML string for
assertions. It wraps the private `jsx` `renderToString` runtime (previously the
`jsx/render-test-helper`) and coerces the result to a plain string, so the enforced
render-once/assert-once convention (§3d) is a single call:

    expect(await render(<Button label="Save" />)).toBe('<button type="button">Save</button>')

### 7d. buildRequest() — Request Builder

`buildRequest(path, opts?)` builds a `Request`, replacing hand-rolled
`new Request("http://test/…", {…})` boilerplate. A relative `path` resolves against
`baseUrl` (default `http://test`).

| Option | Type | Effect |
|---|---|---|
| `method` | `string` | HTTP method; defaults to `POST` when a body is present, else `GET` |
| `headers` | `HeadersInit` | Request headers |
| `formData` | `Record<string, string>` \| `FormData` | record → url-encoded body (+ `content-type` if unset); or a raw `FormData` |
| `json` | `unknown` | JSON-stringified body (+ `application/json` if unset) |
| `body` | `BodyInit` | raw body passed through untouched |
| `baseUrl` | `string` | base for relative `path` (default `http://test`) |

Supply exactly one body helper (`formData`, `json`, or `body`).

    const req = buildRequest("/settings", { method: "POST", formData: { theme: "dark" } })
    const get = buildRequest("/settings")          // GET, no body
    const posted = buildRequest("/api", { json: { name: "Jane" } })  // POST + JSON

### 7e. mapHandler() and TestAction — Single-Route Registrar

`mapHandler(app, method, pattern, action)` registers a single route on a `Forge` app in
tests, mirroring the declarative `app.map(routes, controller)` surface without writing a
full route map. It replaces the removed imperative `app.get`/`app.post`/`app.all` in test
suites (see §5a). `action` is a `TestAction` — either a bare `RequestHandler` or a
`{ middleware, handler }` object. The `method` accepts any `RequestMethod` plus `"ANY"`.

    import { Forge } from "@y-core/forge/app"
    import { mapHandler, render } from "@y-core/forge/testing"

    const app = new Forge<typeof MINIMUM_ENV>()
    mapHandler(app, "GET", "/settings", async (c) => htmlResponse(await render(<Settings />)))
    const res = await app.request("/settings", {}, MINIMUM_ENV)

Use `mapHandler` for a namespace's own unit tests; use a full `route()`/`createController`
map (§5a) when the test must exercise the production registration path itself.
