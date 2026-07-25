---
title: Testing Discipline
description: "Test placement, the HTML-entity exact-match assertion rule, fakes over mocks, security-test requirements, and the verification gate."
---

# Testing Discipline

> Owns test file placement, the assertion rules, the fakes-over-mocks posture, the security-test
> requirements, and the verification gate. Other documents link here rather than restating them.
>
> Defers to: `package.json` `scripts.check` for the gate's step list; `src/testing/README.md`
> for runner usage and debugging recipes; [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §1c for
> what `validate-exports` proves.

---

## 0. Quick Reference

- §1 bun test Runner: the runner and its type stub
- §1a bun:test Primitives: import source and nesting limit
- §1b Custom bun:test Stub — No bun-types: the hard package ban
- §2 Co-Located Test Files: tests live beside their source
- §2a Test File Naming Convention: `foo.ts` → `foo.test.ts`, same directory
- §2b Excluded from npm Publish: tests never ship
- §2c Import from Relative Paths in Tests: never through the barrel
- §3 HTML Entity Exact-Match Assertion Rule: the encoding contract
- §3a The Encoding Map: character to entity, and what is not escaped
- §3b Exact Match — Never Substring Matching: why `toContain` is banned
- §3c Render Once, Assert Once: the single enforced shape
- §4 Fakes Over Mocks: implement the interface, add no libraries
- §4a Fake Pattern — Implement the Interface: compile-time drift detection
- §4b Why Fakes Over Mocks: the comparison, and the no-mock-library rule
- §4c Capturing Arguments in Fakes: `let` captures over call assertions
- §5 Security Test Requirements: both directions, always
- §5a Both Pass and Fail Cases Required: the requirement matrix
- §5b Negative Case Structure: assert status and body
- §5c No Mocking of Security Primitives: a testability signal, not a mocking one
- §5d Security Matrix — Row-to-Test Coverage Map: where each row is covered
- §6 The Verification Gate: what must pass before a task is complete
- §6a The Gate and Its Steps: named, not listed
- §6b What Each Step Catches: the failure classes
- §7 Testing Namespace Utilities: the shared fixtures
- §7a Declared Integration Edge: why `testing` may import `app` and `jsx`
- §7b In-Memory Storage Fakes: `fakeKV`, `fakeD1`, `fakeR2`
- §7c render() — SSR Render-to-String: the assertion entry point
- §7d buildRequest() — Request Builder: options and body helpers
- §7e mapHandler() and TestAction: single-route registrar

---

## 1. bun test Runner

### 1a. bun:test Primitives

**Import all test utilities from `bun:test`** — never from a third-party test library.

**Keep `describe` nesting to at most two levels.** Deeper nesting costs more readability than
the grouping buys.

Runner commands and lifecycle-hook usage are in `src/testing/README.md`.

### 1b. Custom bun:test Stub — No bun-types

Forge uses a hand-written stub at `.types/bun-test.d.ts` rather than the `bun-types` package.
This is a hard requirement:

- `bun-types` overrides DOM's `fetch` signature with Bun-specific properties.
- That override breaks type-checking of `fetch` in Worker code and test fakes.
- The stub declares exactly `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach`,
  `afterEach`, `mock` — nothing more.

**Do NOT install `@types/bun` or `bun-types`, and do not reference them in `tsconfig.json` or
`package.json`.** A change that adds these packages must be rejected.

---

## 2. Co-Located Test Files

### 2a. Test File Naming Convention

**Every source file with non-trivial logic has a test file beside it**, same directory, with a
`.test.ts` (or `.test.tsx`) suffix:

    src/security/headers.ts   → src/security/headers.test.ts
    src/ui/core/button.tsx    → src/ui/core/button.test.tsx

**Test files never go in a top-level `__tests__/` or `test/` directory.** Co-location makes
coverage visible at a glance and keeps relative imports short (§2c).

### 2b. Excluded from npm Publish

`package.json` `files` excludes every test file, so tests exist only in the source repository.
This keeps the published package lean and stops consumers importing test helpers.

### 2c. Import from Relative Paths in Tests

**Always import the concrete source file** — never the namespace barrel (`./mod.ts`) and never
the package name:

```typescript
// In src/security/headers.test.ts:
import { createSecurityHeaders } from "./headers"
```

Importing via the barrel couples the test to the export surface rather than the implementation,
and masks the re-export bugs `validate-exports` exists to catch.

The one exception is `@y-core/forge/testing` (§7), which consumer test code imports by
subpath because it sits outside the source tree.

---

## 3. HTML Entity Exact-Match Assertion Rule

### 3a. The Encoding Map

The JSX renderer escapes dynamic content. Assert the escaped forms:

| Character | Escaped form |
|---|---|
| `'` (apostrophe) | `&#39;` |
| `&` (ampersand) | `&amp;` |
| `<` (less-than) | `&lt;` |
| `>` (greater-than) | `&gt;` |
| `"` in attributes | `&#34;` or `&quot;` |

**Static JSX content is NOT escaped — only interpolated values are.** Know which you are
asserting on before writing the assertion.

**URL-bearing attributes are a further exception:** the renderer routes `href` / `src` /
`action` through `safeUrl`, so a `javascript:` URL renders as `"#"`. Assert the sanitized form.

### 3b. Exact Match — Never Substring Matching

```typescript
// BAD — toContain passes even when the entity encoding is wrong
expect(html).toContain("O'Brien")

// BAD — a partial regex hides the same bug
expect(html).toMatch(/O'Brien/)

// GOOD — toBe on the full element catches encoding exactly
expect(html).toBe("<td>O&#39;Brien &amp; Associates</td>")
```

**If the assertion string is too long, extract the relevant fragment and assert `toBe` on
that.** Never shorten an assertion by switching to `toContain`.

### 3c. Render Once, Assert Once

**Render through `render()` from `@y-core/forge/testing` (§7c) and assert the full markup with
one `toBe`.**

```typescript
import { render } from "@y-core/forge/testing"

it("renders the exact button markup", async () => {
  expect(await render(<Button label="Save & Exit" />)).toBe(
    '<button type="button">Save &amp; Exit</button>',
  )
})
```

**Do not call the private `jsx` render path, do not render twice to assert two fragments, and
do not fall back to `toContain` / `toMatch`.** A single entity-aware `toBe` on the full output
is the only accepted shape.

---

## 4. Fakes Over Mocks

### 4a. Fake Pattern — Implement the Interface

A fake is a minimal in-test implementation of a real interface, written as a plain object
literal typed to that interface:

```typescript
import type { KVNamespace } from "@y-core/forge/storage/kv"

const kv: KVNamespace = {
  get:             async (_key, _opts) => null,
  put:             async (_key, _val)  => {},
  delete:          async (_key)        => {},
  list:            async ()            => ({ keys: [], list_complete: true }),
  getWithMetadata: async (_key, _opts) => ({ value: null, metadata: null }),
}
```

**TypeScript enforces that every interface member is present**, so interface drift breaks the
test at compile time.

### 4b. Why Fakes Over Mocks

| Concern | Fake | Mock library |
|---|---|---|
| API change detection | Compile error | Silent — passes with a stale signature |
| Readability | An explicit object literal | A chain of `.mockReturnValue(...)` calls |
| Coupling | To the interface contract | To call order, argument matchers, invocation counts |
| Dependencies | None | Requires a mock library |

**Mock libraries (jest-mock, sinon, and the like) are not installed and must not be added.**
Use argument-capturing fakes (§4c) when you need to inspect calls.

### 4c. Capturing Arguments in Fakes

**Use `let` captures at the top of the `it` block**, and reset them in `beforeEach` when the
fake is shared across cases.

```typescript
let capturedKey = ""
const kv: KVNamespace = { put: async (key) => { capturedKey = key }, /* …rest */ }

await handler(fakeContext)
expect(capturedKey).toBe("session:abc123")
```

---

## 5. Security Test Requirements

### 5a. Both Pass and Fail Cases Required

**Security-sensitive code requires both a positive case (the guard allows a valid request) and
a negative case (the guard blocks an invalid one).** A suite with only the happy path is
incomplete and must not be merged.

**Build the app under test the way production does — declaratively.** Routes are a
name→`{ method, pattern }` map (`route()`) bound to a controller (`createController`) and
installed with `app.map(routes, controller)`; path-scoped middleware goes on `app.use("*", …)`.
Drive requests through `app.request(path, init, env)`, which runs the full chain and awaits any
`waitUntil` work.

```typescript
import { Forge } from "@y-core/forge/app"
import { route, createController } from "@y-core/forge/router"

const MINIMUM_ENV = { BASE_URL: "https://example.com", CSRF_SECRET: "a".repeat(64) }

function buildApp() {
  const app = new Forge<typeof MINIMUM_ENV>()
  app.use("*", createSecurityHeaders())
  const routes = route({ contact: { method: "POST", pattern: "/contact" } })
  app.map(routes, createController(routes, {
    actions: { contact: { middleware: [csrfVerifyGuard], handler: contactHandler } },
  }))
  return app
}
```

For a namespace's own unit tests, `mapHandler` (§7e) registers a single route without a full
map.

| Feature | Required positive case | Required negative case |
|---|---|---|
| CSRF protection | Valid token → 200 | Missing or invalid token → 403 |
| Origin check | Same-origin → proceeds | Cross-origin → 403 |
| Rate limiting | Under limit → 200 | Over limit → 429 |
| Input validation | Valid input → renders form with values | Invalid input → renders field errors |
| Content type | Form content type → proceeds | Wrong or missing → 415 |
| Auth middleware | Valid session → proceeds | Missing or expired session → 401 |

### 5b. Negative Case Structure

**The negative case must assert the exact status AND a meaningful body fragment** — not just
the status code. That proves the error path renders, not merely that it exits early.

```typescript
it("rejects missing CSRF token with 403", async () => {
  const res = await buildApp().request("/contact", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "name=Alice",                       // no _csrf field
  }, MINIMUM_ENV)
  expect(res.status).toBe(403)
  expect(await res.text()).toBe("Forbidden")
})
```

### 5c. No Mocking of Security Primitives

**Do not mock `createSecurityHeaders`, `verifyCsrfToken`, or any other security primitive to
make a test pass.** Test the real implementation against a fake binding.

If the real implementation is too hard to invoke from a test, that is a **testability signal —
refactor to accept injectable dependencies**, not a licence to mock.

### 5d. Security Matrix — Row-to-Test Coverage Map

Where each §5a row is covered at integration level, through `app.request()` with real
primitives:

| Matrix row | Covering tests |
|---|---|
| CSRF valid → 200 / invalid → 403 | `src/form/csrf.test.ts` (mint-then-verify, invalid header, missing token, path and subject mismatch) |
| CSRF 403 carries security headers | `src/app/app.test.ts` |
| Origin same → 200 / cross or missing → 403 | `src/security/origin.test.ts`, `src/security/cop.test.ts` |
| Rate limit under / over / binding absent / key unresolvable | `src/security/rate-limit.test.ts`; header carriage in `src/app/app.test.ts` |
| Input validation ok / issues | `src/app/action.test.ts`, `src/validation/format-issues.test.ts` |
| Body size under / over, both `Content-Length` and streaming | `src/form/parse-form-data.test.ts`, `src/app/action.test.ts` |
| Content-Type valid / invalid → 415 | `src/security/content-type.test.ts` |
| Log-viewer access allow / deny → 403 | `src/logging/show/route.test.tsx` |
| Auth middleware valid / expired session | **N/A** — no `auth` namespace exists yet ([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5a); add with that namespace |

**`isHxRequest` has no row.** It is a routing hint, not a security boundary, so there is no
guard middleware to test — see [`HTMX.md`](./HTMX.md) §2.

---

## 6. The Verification Gate

### 6a. The Gate and Its Steps

`bun run check` is the gate. **`package.json` `scripts.check` owns the step list** — read it
there rather than trusting any prose copy.

**Every step must pass with zero errors before a task is declared complete.** A partial pass —
"types pass, lint has one warning" — is a failure, and skipping a step is not permitted.

Failure-triage recipes are in `src/testing/README.md`.

### 6b. What Each Step Catches

| Step | Tool | Catches |
|---|---|---|
| `typecheck` | `tsgo` | Type errors, wrong argument types, missing properties |
| `lint` | `biome` | Style violations, banned patterns, the no-sibling-barrel rule |
| `test` | bun test | Functional regressions across all namespaces |
| `validate-exports` | forge internal | Barrel and export-map drift ([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §1c) |
| `validate-jsx` | forge internal | Missing or wrong JSX pragma in `.tsx` sources |

**Fix `typecheck` failures first** — they cascade into misleading lint and test failures.

---

## 7. Testing Namespace Utilities (`@y-core/forge/testing`)

The `testing` namespace ships the fixtures every consumer suite would otherwise hand-roll.
**Import them from the barrel** — consumer test code sits outside the source tree, so §2c's
concrete-file rule does not apply.

```typescript
import { fakeKV, fakeD1, fakeR2, render, buildRequest, mapHandler } from "@y-core/forge/testing"
```

### 7a. Declared Integration Edge — testing Imports app and jsx

`testing` is an integration namespace ([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4b). A
test-only namespace reaching into `app` and `jsx` is the **declared, acceptable** edge — these
utilities exist precisely to drive the app and render pipelines. **This is the one place forge
source may depend on the private `jsx` render helper**, re-exported as `render()` (§7c).

### 7b. In-Memory Storage Fakes — fakeKV, fakeD1, fakeR2

Three `Map`-backed fakes implement the real `storage/*` structural contracts, so interface
drift breaks tests at compile time (§4a). **Never mock these bindings.**

| Fake | Contract | Seed |
|---|---|---|
| `fakeKV(seed?)` | `KVNamespace` | `Record<string, string>` → keyed values |
| `fakeD1(query?)` | `D1DatabaseLike & { calls }` | programmable responder |
| `fakeR2(seed?)` | `R2BucketLike` | `Record<string, string>` → keyed bodies |

`fakeKV` implements the full KV contract and paginates `list` by offset-encoded cursor
(`list_complete: false` plus a numeric `cursor`). **TTLs are accepted but not enforced — a test
must never depend on wall-clock expiry.**

`fakeD1`'s optional `query: (sql, params) => unknown[]` responder drives the returned rows,
and every `prepare(...).bind(...)` records `{ sql, params }` into `calls`, so one fake both
controls results and asserts the queries issued.

`fakeR2` mirrors `fakeKV` over `R2BucketLike`, with working `arrayBuffer()`/`text()`/`blob()`,
a `body` stream, and a deterministic content-hash etag.

### 7c. render() — SSR Render-to-String

`render(element): Promise<string>` renders a JSX element to its exact HTML string. It wraps the
private `jsx` `renderToString` runtime and coerces the result to a plain string, so the
render-once/assert-once convention (§3c) is a single call.

### 7d. buildRequest() — Request Builder

`buildRequest(path, opts?)` builds a `Request`, replacing hand-rolled `new Request(...)`
boilerplate. A relative `path` resolves against `baseUrl` (default `http://test`).

| Option | Effect |
|---|---|
| `method` | HTTP method; defaults to `POST` when a body is present, else `GET` |
| `headers` | Request headers |
| `formData` | Record → url-encoded body (+ content-type if unset), or a raw `FormData` |
| `json` | JSON-stringified body (+ `application/json` if unset) |
| `body` | Raw body, passed through untouched |
| `baseUrl` | Base for a relative `path` |

**Supply exactly one body helper** — `formData`, `json`, or `body`.

### 7e. mapHandler() and TestAction — Single-Route Registrar

`mapHandler(app, method, pattern, action)` registers one route on a `Forge` app, mirroring
`app.map(routes, controller)` without a full route map. `action` is a `TestAction` — a bare
`RequestHandler` or a `{ middleware, handler }` object; `method` accepts any `RequestMethod`
plus `"ANY"`.

**Use `mapHandler` for a namespace's own unit tests; use a full `route()` / `createController`
map (§5a) when the test must exercise the production registration path itself.**
