---
title: Testing Discipline
description: "bun test, co-located tests, *.test.ts, *.test.tsx, fakes over mocks, HTML entity exact-match assertions, bun:test primitives, describe it expect, validate-exports gate, bun run check, security test requirements pass and fail cases, declarative route registration, app.request helper, MINIMUM_ENV, mapHandler, no substring matching"
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
- §5 Security test requirements: both pass AND fail cases required
- §6 `bun run check` gate: typecheck + lint + test + validate-exports

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
    import { makeSecurityHeaders } from "./headers"
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
    import { makeSecurityHeaders } from "@y-core/forge/security"

    // Minimal environment bindings the handlers read (KV, secrets, base URL, …).
    const MINIMUM_ENV = {
      BASE_URL: "https://example.com",
      CSRF_SECRET: "a".repeat(64), // 32-byte hex
    }

    function buildApp() {
      const app = new Forge<typeof MINIMUM_ENV>()
      app.use("*", makeSecurityHeaders())
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

Do not mock `makeSecurityHeaders`, `verifyCsrfToken`, or other security primitives
to make tests pass. Test with real implementations against a fake binding. If the
real implementation is too hard to invoke in a test, that is a testability signal —
refactor the code to accept injectable dependencies, not a signal to mock.

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
