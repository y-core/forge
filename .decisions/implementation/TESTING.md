---
title: Testing Discipline
description: "forge's two test runners and its browser set, the entity encoding map, the security matrix coverage map, and the testing namespace fixtures."
---

# Testing Discipline

> Owns test file placement, the assertion rules, the fakes-over-mocks posture, the security-test
> requirements, and the verification gate. Other documents link here rather than restating them.
>
> Defers to: `config/steps.ts` for the gate's step list; `src/testing/README.md` for the
> `testing` namespace's fixtures and their usage;
> [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §1c for what `validate-exports` proves.

---

## 0. Quick Reference

- §1 Test Runners: the two runners, their type stub, and which question each answers
- §1a bun:test Primitives: import source and nesting limit
- §1b Custom bun:test Stub — No bun-types: the hard package ban
- §1c The Browser Set: real Chromium behind its own verb
- §2 Co-Located Test Files: tests live beside their source
- §3 HTML Entity Exact-Match Assertion Rule: the encoding contract
- §3a The Encoding Map: character to entity, and what is not escaped
- §3b Exact Match — Never Substring Matching: why `toContain` is banned
- §3c Render Once, Assert Once: the single enforced shape
- §3d Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees: the deletion check
- §4 Fakes Over Mocks: implement the interface, add no libraries
- §5 Security Test Requirements: both directions, always
- §5a Both Pass and Fail Cases Required: the requirement matrix
- §5b Negative Case Structure: assert status and body
- §5c No Mocking of Security Primitives: a testability signal, not a mocking one
- §5d Security Matrix — Row-to-Test Coverage Map: where each row is covered
- §6 The Verification Gate: what must pass before a task is complete
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

**The set sits outside `bun run verify`, and the reason is a prerequisite, not cost.** It needs a
browser binary that `bun run test:install` fetches, and a prerequisite is the only legitimate
ground for a set to stand outside `check`. Cost never is. It **is** a step of `bun run verify`,
the release gate, which is permitted to carry a prerequisite
([`TESTING.md`](../governance/TESTING.md) §6c).

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

**A UA pseudo-element is asserted from rendered pixels, never from `getComputedStyle`.** Chromium
answers `getComputedStyle(el, "::-webkit-slider-runnable-track")` with the *host* element's style
rather than the pseudo-element's, so a computed-style spec for the slider track would pass whatever
the track actually did. `slider.browser.ts` samples a screenshot instead.

---

## 2. Co-Located Test Files

See [`TESTING.md`](../governance/TESTING.md) §2 for co-location, the naming convention, the
publish exclusion, and the concrete-file import rule with its two exceptions. forge's browser set
follows the same rule under its own suffix (§1c).

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

See [`TESTING.md`](../governance/TESTING.md) §3b for the exact-match rule and why a substring assertion on markup is a defect.

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

See [`TESTING.md`](../governance/TESTING.md) §4 for the fakes-over-mocks posture, the
compile-time-drift argument, and the no-mock-library ban. The fakes forge ships are §7 below.

---

## 5. Security Test Requirements

### 5a. Both Pass and Fail Cases Required

See [`TESTING.md`](../governance/TESTING.md) §5a for the both-directions requirement and the guard matrix. forge builds the app under
test the way production does — a `route()` map bound through `createController`, path-scoped
middleware on `app.use`, and requests driven through `app.request(path, init, env)`. For a
namespace's own unit tests, `mapHandler` (§7e) registers a single route without a full map.

### 5b. Negative Case Structure

See [`TESTING.md`](../governance/TESTING.md) §5b for the rule that a negative case asserts the exact status **and** a meaningful body.

### 5c. No Mocking of Security Primitives

See [`TESTING.md`](../governance/TESTING.md) §5c for the ban on mocking a security primitive, and why an untestable primitive is a
design signal rather than a licence to mock.

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
| Auth middleware valid / expired session | **N/A** — no `auth` namespace exists yet ([`NAMESPACES.md`](./NAMESPACES.md) §5a); add with that namespace |

**`isHxRequest` has no row.** It is a routing hint, not a security boundary, so there is no
guard middleware to test — see [`HTMX.md`](./HTMX.md) §7.

---

## 6. The Verification Gate

See [`TESTING.md`](../governance/TESTING.md) §6 for the one-command-two-modes gate, the flag
table, the prerequisite line, and the scoped-run rule. `config/steps.ts` owns forge's step list
([`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) §2a).

---

## 7. Testing Namespace Utilities (`@y-core/forge/testing`)

The `testing` namespace ships the fixtures every consumer suite would otherwise hand-roll.
**Import them from the barrel** — consumer test code sits outside the source tree, so the
concrete-file rule in [`TESTING.md`](../governance/TESTING.md) §2c does not apply.
`src/testing/README.md` documents each fixture with its signature and options.

### 7a. Declared Integration Edge — testing Imports app and jsx

`testing` is an integration namespace ([`NAMESPACES.md`](./NAMESPACES.md) §4b). A
test-only namespace reaching into `app` and `jsx` is the **declared, acceptable** edge — these
utilities exist precisely to drive the app and render pipelines. **This is the one place forge
source may depend on the private `jsx` render helper**, re-exported as `render()` (§7c).

### 7b. In-Memory Storage Fakes — fakeKV, fakeD1, fakeR2

Three `Map`-backed fakes implement the real `storage/*` structural contracts, so interface
drift breaks tests at compile time ([`TESTING.md`](../governance/TESTING.md) §4a). **Never mock
these bindings.**

`fakeKV` implements the full KV contract, including cursor-paginated `list`. **TTLs are accepted
but not enforced — a test must never depend on wall-clock expiry**, because a fake that expired on
a real clock would make a suite fail by being slow.

`fakeD1` both controls results and records the queries issued: a caller-supplied responder drives
the returned rows, and every prepared-and-bound statement is recorded, so one fake serves the
arrange and the assert. `fakeR2` mirrors `fakeKV` over `R2BucketLike`, with a deterministic
content-hash etag — deterministic because a random etag would make a conditional-request assertion
unwritable.

### 7c. render() — SSR Render-to-String

`render` renders a JSX element to its exact HTML string, wrapping the private `jsx`
`renderToString` runtime and coercing the result to a plain string — so the render-once /
assert-once convention (§3c) is a single call.

### 7d. buildRequest() — Request Builder

`buildRequest` builds a `Request` in place of hand-rolled `new Request(...)` boilerplate,
resolving a relative path against a default base so no test hardcodes an origin. The method is
inferred from whether a body is present, and a body helper sets its own content-type unless the
caller set one — so the common case names neither.

**Supply exactly one body helper** — `formData`, `json`, or `body`. Two would silently pick one.

### 7e. mapHandler() and TestAction — Single-Route Registrar

`mapHandler` registers one route on a `Forge` app, mirroring `app.map(routes, controller)`
without a full route map. Its `action` is a `TestAction` — the same bare-handler or
`{ middleware, handler }` shape a real controller accepts, so a test never exercises a
registration shape production cannot express.

**Use `mapHandler` for a namespace's own unit tests; use a full `route()` / `createController`
map (§5a) when the test must exercise the production registration path itself.**
