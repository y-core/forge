---
title: Testing Discipline
description: "Test placement, the HTML-entity exact-match assertion rule, fakes over mocks, security-test requirements, and the verification gate."
---

# Testing Discipline

> Owns test file placement, the assertion rules, the fakes-over-mocks posture, the security-test
> requirements, and the verification gate. Other documents link here rather than restating them.
>
> Defers to: `scripts/lib/steps.ts` for the gate's step list; `src/testing/README.md` for the
> `testing` namespace's fixtures and their usage; [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md)
> §1c for what `validate-exports` proves.

---

## 0. Quick Reference

- §1 Test Runners: the two runners, their type stub, and which question each answers
- §1a bun:test Primitives: import source and nesting limit
- §1b Custom bun:test Stub — No bun-types: the hard package ban
- §1c The Browser Set: real Chromium behind its own verb
- §2 Co-Located Test Files: tests live beside their source
- §2a Test File Naming Convention: `foo.ts` → `foo.test.ts`, same directory
- §2b Excluded from npm Publish: tests never ship
- §2c Import from Relative Paths in Tests: never through the barrel
- §3 HTML Entity Exact-Match Assertion Rule: the encoding contract
- §3a The Encoding Map: character to entity, and what is not escaped
- §3b Exact Match — Never Substring Matching: why `toContain` is banned
- §3c Render Once, Assert Once: the single enforced shape
- §3d Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees: the deletion check
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
- §6b What Each Tool Catches: the failure classes
- §6c Prerequisites: what separates `check` from `verify`
- §7 Testing Namespace Utilities: the shared fixtures
- §7a Declared Integration Edge: why `testing` may import `app` and `jsx`
- §7b In-Memory Storage Fakes: `fakeKV`, `fakeD1`, `fakeR2`
- §7c render() — SSR Render-to-String: the assertion entry point
- §7d buildRequest() — Request Builder: options and body helpers
- §7e mapHandler() and TestAction: single-route registrar

---

## 1. Test Runners

**Forge has two runners, and they answer different questions.** `bun test` proves that a function
returns what it should and that the server emitted the markup it promised. The browser set (§1c)
proves that a controller does what it claims **to a keystroke**. Neither substitutes for the other,
and both are kept.

### 1a. bun:test Primitives

**Import all test utilities from `bun:test`** — never from a third-party test library. The one
exception is the browser set, which imports `@playwright/test` (§1c): driving a real browser needs a
browser driver, and there is no forge-owned equivalent to reach for instead. The ban is on
*assertion and mocking* libraries layered over a runner that already has both, and that ban is
unchanged.

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

### 1c. The Browser Set

**A `*.browser.ts` file runs in real Chromium under its own verb, `bun run test:browser`.**
`playwright.config.ts` owns the discovery pattern, the project list and the parallelism — cite it,
never restate it here.

**The set sits outside `bun run check`, and the reason is a prerequisite, not cost.** It needs a
browser binary that `bun run test:install` fetches, and a prerequisite is the only legitimate
ground for a set to stand outside `check`. Cost never is. It **is** a step of `bun run verify`,
the release gate, which is permitted to carry a prerequisite (§6c).

**`bun test` is untouched by it.** The two never share a process, so no global is ever redefined and
forge's Cloudflare `Request` / `Response` / `fetch` semantics stay exactly as the runtime ships them
— which matters, because forge is a Workers framework and those semantics *are* the product. File
discovery cannot collide either: `bun test` matches `*.test.*` / `*.spec.*`, and `*.browser.ts` is
neither.

**This is why a DOM shim was rejected.** Registering one defines hundreds of globals and shadows Bun
natives the rest of the suite exercises, and the shim available did not implement the Popover API at
all — so the platform features these components are *built on* would have been certified against a
model of the platform that did not have them. Worse, its shadow-root retargeting was backwards,
which would have made the central assertion about `event.target` pass for the wrong reason. The
browser set guarantees isolation **by construction**: a separate process, and no global ever
redefined.

**What each runner is sufficient evidence for:**

| Claim | Proven by |
|---|---|
| the server emitted this exact markup | `bun test`, exact-HTML assertion (§3) |
| a pure function returns this value | `bun test` |
| a controller moves focus / writes an attribute / consumes a key | **the browser set only** |

**An SSR string is not sufficient evidence for a controller**, and a behaviour test does not subsume
an exact-HTML test — a component can behave correctly while emitting markup no stylesheet matches.
Where a rebuild changes markup, the exact-HTML test is *updated*, never replaced by a behaviour
test.

**A case in the browser set asserts a DOM or focus state, never a call count.** It builds real
markup — rendered by the real SSR components wherever possible — dispatches a real event through the
browser's own input path, and reads what resulted. A test that counts calls is testing the test's
own fixture.

---

## 2. Co-Located Test Files

### 2a. Test File Naming Convention

**Every source file with non-trivial logic has a test file beside it**, same directory, with a
`.test.ts` (or `.test.tsx`) suffix:

    src/security/headers.ts   → src/security/headers.test.ts
    src/ui/core/button.tsx    → src/ui/core/button.test.tsx

**Test files never go in a top-level `__tests__/` or `test/` directory.** Co-location makes
coverage visible at a glance and keeps relative imports short (§2c).

**The browser set follows the same rule with its own suffix** — `foo.ts` → `foo.browser.ts`, same
directory (§1c). A subject may have both, and often should: the exact-HTML test proves what the
server emitted, the browser test proves what the markup then does.

    src/ui/core/menu.tsx        → src/ui/core/menu.browser.ts
    src/ui/client/composite.ts  → src/ui/client/composite.browser.ts

**The one exception is a spec with no single subject.** A test for a scenario that only exists
*between* two components — nested overlays, a widget inside a form, a widget inside a shadow root —
sits at the root of the tier it spans rather than beside an arbitrary one of its participants.
Choosing a co-location for it would name one component as the subject when none is.

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

**A test whose subject *is* the export surface is the second exception**, and it proves the rule
rather than bending it: a test asserting that every component a namespace publishes has a
corresponding demo section has to read the published surface, because a hand-kept list is exactly
the thing that would rot. Suppress the lint rule at that import with a reason, and nowhere else.

---

## 3. HTML Entity Exact-Match Assertion Rule

### 3a. The Encoding Map

The JSX renderer escapes **every** string child, static and interpolated alike. Assert the
escaped forms:

| Character | Escaped form |
|---|---|
| `'` (apostrophe) | `&#39;` |
| `&` (ampersand) | `&amp;` |
| `<` (less-than) | `&lt;` |
| `>` (greater-than) | `&gt;` |
| `"` in attributes | `&#34;` or `&quot;` |

**Static text in the JSX source is escaped exactly as an interpolated value is** — `<p>Tom &
Co</p>` and `<p>{name}</p>` produce the same entities. Never assert raw `&`, `<`, `>`, `'` or
`"` on the strength of a literal being written in the source.

**The one bypass is `SafeHtml`:** a child that passed through `rawHtml` is emitted verbatim.
Assert the unescaped form there, and only there. See `src/jsx/render-to-string.ts`.

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

### 3d. Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees

**The operational check, applied before a test is counted as written: delete the mechanism the test
names; a test that still passes was never testing it.**

The failure shape is always the same. The subject is a *mechanism* — a timer cleared, a list that
does not grow, an observer disconnected — and the assertion reads an *outcome* that a second,
independent mechanism also produces. A guard clause is the usual second mechanism: `if (disposed)
return;` at the top of a callback makes "nothing visibly happened" true whether or not the timer
that calls it was ever cancelled.

Two shapes worth recognising:

- **A guard downstream of the subject.** Remove the disposal guard from a lazy-loading controller
  and every case but one stays green — the one counting initialisations. The pre-existing assertion
  re-observed the element and checked what appeared, which the guard and the mechanism produce
  identically.
- **An assertion that passes when its subject is absent.** `expect(probe?.[0]).not.toBe("x")` passes
  when `probe` has been deleted outright, because optional chaining makes the expression `undefined`.
  A negative assertion over an optional path asserts nothing.

**Pin the mechanism, and pin that it was armed.** "The timer never fired" is worth nothing without
"a timer was scheduled" — a mechanism never set up also never runs. Both halves in one assertion is
the cheapest form: `expect(timers).toEqual({ scheduled: 1, fired: 0 })`.

This does not weaken §1c's rule that a browser case asserts a DOM state rather than a call count.
What is counted here is the **platform's** own invocation — a timer callback firing, a property being
read — which *is* the mechanism. §1c bans substituting a count of calls into the test's own fixture
for the DOM state a controller was supposed to produce; where the subject is a DOM state, assert the
DOM state.

**The `page.clock` corollary.** Instrumentation of a page global — a wrapped `setTimeout`, an
accessor over a third-party global — is installed **after** the harness's `mount` and after
`page.clock.install()`. `setContent` replaces the document and discards every window mutation made
before it, and wrapping the clock's timers rather than the platform's is what keeps a fast-forward in
charge of the wrapped timer. Instrumenting earlier reads as correct and does nothing.

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

**`bun run check` is the gate; `bun run verify` is the release gate.** Both are the same runner
over one table, and **`scripts/lib/steps.ts` owns the step list** — every step, its command, and
which gates it belongs to. Read it there rather than trusting any prose copy.

**Every step must pass with zero errors before a task is declared complete.** A partial pass —
"types pass, lint has one warning" — is a failure, and skipping a step is not permitted.

The runner reports each step as it finishes, stops at the first failure, and names it:
`✗ check — failed at \`typecheck\``. **That name is the verdict** — it is read off the summary
line, never inferred from raw tool output.

Three flags, all resolved against the same table:

| Flag | Effect |
|---|---|
| `--only <a,b>` | Run only those steps. An unknown label is refused, with the known ones listed. |
| `--list` | Print the resolved selection and exit, running nothing. |
| `--fix` | Run each selected step's fixer, then re-run the gate to confirm. |

**A scoped run is not a gate run.** `--only` selecting fewer steps than the gate holds makes every
summary line carry `⚠ scoped run (N of M steps) — not the gate`, so a scoped green can never be
read as a green gate. A selection that resolves to **zero** steps is refused outright: a gate that
ran nothing must never be indistinguishable from a gate that passed.

**`bun run test:browser` is not one of `check`'s steps and is still required of any change that
touches a controller** (§1c). A green `check` says nothing whatever about whether a keystroke still
moves focus.

### 6b. What Each Tool Catches

Keyed by tool rather than by step: which steps exist drifts, and §6a already says where that list
lives. What a given tool proves does not drift.

| Tool | Catches |
|---|---|
| `tsgo` | Type errors, wrong argument types, missing properties |
| `biome` | Style violations, banned patterns, the no-sibling-barrel rule |
| `bun test` | Functional regressions across all namespaces |
| forge's own validators | Barrel and export-map drift ([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §1c), JSX pragmas, governing-doc format, `@source` coverage |

**Fix `typecheck` failures first** — they cascade into misleading lint and test failures. The step
table encodes this by ordering `typecheck` first, so a fail-fast run stops there without being
told to.

### 6c. `check` Carries No Machine Prerequisite; `verify` May

**This is the line between the two verbs.** Every step in `check` runs on any machine with the
repo's dependencies installed — nothing to fetch, no binary beyond `devDependencies`. That is what
makes `check` the gate anyone may run at any time, and why cost is never grounds for moving a step
out of it (§1c).

`bun run verify` is the release gate — `prepublishOnly` runs it — and **is** permitted a
prerequisite. It adds the browser set, whose Chromium binary comes from `bun run test:install`.
**Publishing therefore requires that install**, and a machine that lacks it fails `verify` at
`test:browser` before running any test, with the install command in the failure line.

A step needing a prerequisite belongs in `verify` only. A step needing nothing belongs in both.

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
