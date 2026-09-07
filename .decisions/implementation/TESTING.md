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
- §1d Waiting on an htmx Swap: settled, not merely swapped
- §1e Media Options Playwright Does Not Implement: why a spec takes `test` from the harness
- §2 Co-Located Test Files: tests live beside their source
- §3 HTML Entity Exact-Match Assertion Rule: the encoding contract
- §3a The Encoding Map: character to entity, and what is not escaped
- §3b Exact Match — Never Substring Matching: why `toContain` is banned
- §3c Render Once, Assert Once: the single enforced shape
- §3d Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees: the deletion check
- §3e forge/exact-markup-assertion — The Enforced Form: what the rule catches, what it cannot, and the suppression
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
_assertion and mocking_ libraries layered over a runner that already has both, and that ban is
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

**The set runs under bun — `bunx --bun playwright test`, in the script and in `browserStep`'s argv
alike.** `node_modules/.bin/playwright` is a node shim, and node refuses to strip types from a file
under `node_modules`, so a consumer's `playwright.config.ts` importing any forge subpath dies at
config load. Forge's own config imports relatively and never hit it; a consumer hits it on the first
import. It is the same restriction the committed lint-plugin bundle answers, and
[`NAMESPACES.md`](NAMESPACES.md) §3c is its single home — including why the two remedies differ.

**The set is held back to the `full` tier, and the reason is a prerequisite, not cost.**
It needs a browser binary, and a prerequisite is the only legitimate ground for holding a step back.
Cost never is. It runs under `bun run verify:full`, the release gate, which is permitted to carry
one ([`TESTING.md`](../governance/TESTING.md) §6c).

**The browser comes from the workspace image, so forge ships no install script.** Every devbox
toolchain image bakes Chromium and sets `CHROME_PATH`, which is what `hasChromium` resolves first —
the prerequisite is met before anyone runs anything, and the probe never fails in a devbox session.
`browserStep`'s hint is therefore reached only from outside such a container, and it names both
routes a reader there has — the direct download, or a devbox container — rather than a script this
repository would otherwise have to define.

**So the browser set is verified manually and at publish, not in the default gate — a ruling, not
an oversight.** forge runs no CI, so `bun run test:browser` before a commit that touches
`src/ui/client/` or a controller is the check, and `prepublishOnly` is the backstop: a full run
fails hard when a prerequisite probe returns false (`src/tooling/gate/command.ts`) and
refuses a green when nothing ran, so a chromium-absent machine cannot publish.

**A consequence accepted with it:** `validate-co-location`
(`src/tooling/gate/checks/co-location.ts`) counts a `.browser.ts` as satisfying co-location
for a module the default gate never executes, so `bun run verify` can certify as tested a module
whose only test it did not run. Demanding a second unit file would buy a fake one, which is worse.

**`bun test` is untouched by it.** The two never share a process, so no global is ever redefined and
forge's Cloudflare `Request` / `Response` / `fetch` semantics stay exactly as the runtime ships them
— which matters, because forge is a Workers framework and those semantics _are_ the product. File
discovery cannot collide either: `bun test` matches `*.test.*` / `*.spec.*`, and `*.browser.ts` is
neither.

**This is why a DOM shim was rejected.** Registering one defines hundreds of globals and shadows Bun
natives the rest of the suite exercises, and the shim available did not implement the Popover API at
all — so the platform features these components are _built on_ would have been certified against a
model of the platform that did not have them. Worse, its shadow-root retargeting was backwards,
which would have made the central assertion about `event.target` pass for the wrong reason. The
browser set guarantees isolation **by construction**: a separate process, and no global ever
redefined.

**What each runner is sufficient evidence for:**

| Claim                                                           | Proven by                             |
| --------------------------------------------------------------- | ------------------------------------- |
| the server emitted this exact markup                            | `bun test`, exact-HTML assertion (§3) |
| a pure function returns this value                              | `bun test`                            |
| a controller moves focus / writes an attribute / consumes a key | **the browser set only**              |

**An SSR string is not sufficient evidence for a controller**, and a behaviour test does not subsume
an exact-HTML test — a component can behave correctly while emitting markup no stylesheet matches.
Where a rebuild changes markup, the exact-HTML test is _updated_, never replaced by a behaviour
test.

**A case in the browser set asserts a DOM or focus state, never a call count.** It builds real
markup — rendered by the real SSR components wherever possible — dispatches a real event through the
browser's own input path, and reads what resulted. A test that counts calls is testing the test's
own fixture.

**The browser set cannot prove an `@utility`, and a spec that seems to is passing for another
reason.** `mount`'s `css` option serves the stylesheets **raw, with no Tailwind build**, so a
`state-busy` or a `focus-ring` in the mounted markup resolves to nothing at all — a computed-style
assertion against one reads the browser's initial value and says nothing about the recipe. What the
option _does_ reach is the plain CSS in `forge-ui.css`'s `@layer` blocks, which is why
`forced-colors.browser.ts` works: its forced-colors block is `[data-slot~="…"]` rules, not utilities. A claim about a
recipe's own selector belongs in a `bun test` that compiles the design system —
`src/tooling/gate/checks/state-recipes.test.ts` is the pattern, and the compiled selector is the
artefact it reads.

**A UA pseudo-element is asserted from rendered pixels, never from `getComputedStyle`.** Chromium
answers `getComputedStyle(el, "::-webkit-slider-runnable-track")` with the _host_ element's style
rather than the pseudo-element's, so a computed-style spec for the slider track would pass whatever
the track actually did. `slider.browser.ts` samples a screenshot instead.

### 1d. Waiting on an htmx Swap

**A case that interacts with the page after an htmx swap waits on `htmx:afterSettle`, never on the
state the swap wrote.** htmx inserts the fragment into the DOM immediately, then binds its `hx-*`
trigger listeners in a settle task deferred by `htmx.config.defaultSettleDelay` — so every swap
leaves a window in which the new markup is fully readable and completely inert. A poll on the
swapped-in attributes therefore returns _inside_ that window, and the next interaction fires no
request at all.

Whether the poll's tick lands before or after the settle is a coin flip that CPU contention biases,
which is what makes the resulting failure load-dependent rather than reproducible. `showcase.browser.ts`
counts `htmx:afterSettle` on `document.body` and gates on the count. Raising `defaultSettleDelay`
is how such a race is made deterministic while it is being diagnosed; production settle timing is
never changed to suit a spec.

### 1e. Media Options Playwright Does Not Implement

**Take `test` from `src/ui/client/browser-test-helper.ts`, not from `@playwright/test`, in any spec
that emulates reduced motion, forced colours or contrast.** playwright 1.62 declares
`reducedMotion`, `forcedColors` and `contrast` in `types/test.d.ts` but builds none of them into
`_combinedContextOptions` (`playwright/lib/index.js`), so `test.use({ reducedMotion: "reduce" })`
type-checks and emulates nothing at all. A spec written against the reduced-motion branch of
`forge-ui.css` would silently exercise the `no-preference` branch and pass for the wrong reason.

The harness `test` reinstates the three as real options and applies them through an overridden
`page` fixture, which is the one form that does reach the browser; the runtime
`page.emulateMedia({ … })` call is equally sound and is what the five existing motion-sensitive
specs use. **Nothing enforces the import** — `browser-test-helper.browser.ts` is the regression
that would catch the option silently reverting to a no-op, not a check on call sites.

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

| Character          | Escaped form        |
| ------------------ | ------------------- |
| `'` (apostrophe)   | `&#39;`             |
| `&` (ampersand)    | `&amp;`             |
| `<` (less-than)    | `&lt;`              |
| `>` (greater-than) | `&gt;`              |
| `"` in attributes  | `&#34;` or `&quot;` |

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

The failure shape is always the same. The subject is a _mechanism_ — a timer cleared, a list that
does not grow, an observer disconnected — and the assertion reads an _outcome_ that a second,
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
read — which _is_ the mechanism. §1c bans substituting a count of calls into the test's own fixture
for the DOM state a controller was supposed to produce; where the subject is a DOM state, assert the
DOM state.

**The `page.clock` corollary.** Instrumentation of a page global — a wrapped `setTimeout`, an
accessor over a third-party global — is installed **after** the harness's `mount` and after
`page.clock.install()`. `setContent` replaces the document and discards every window mutation made
before it, and wrapping the clock's timers rather than the platform's is what keeps a fast-forward in
charge of the wrapped timer. Instrumenting earlier reads as correct and does nothing.

### 3e. forge/exact-markup-assertion — The Enforced Form

**A `toContain`, a `toMatch`, or a `.includes(` whose receiver is rendered markup fails the `lint`
step.** The rule is `forge/exact-markup-assertion`, and
`src/tooling/lint/rules/exact-markup-assertion.ts` owns it as enforced
([`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) §2b); `.oxlintrc.json` owns which files it judges,
scoped by an `overrides` entry to `src/ui`'s `*.test.ts` / `*.test.tsx` and `*.browser.ts` /
`*.browser.tsx`. Its finding cites [`TESTING.md`](../governance/TESTING.md) §3b — the shape it is
pushing a test back towards is §3c.

**Markup is traced through local helpers.** A wrapper — `const page = (which) => render(<X page={which} />)`
— and one hop of derivation off a rendered value — `const band = out.slice(...)` — both still count
as markup, resolved by a fixpoint over the file's bindings. Naming the render call something else
is not an escape.

**A derivation that produced a list is deliberately not flagged**: `.split(`, `.map(`, `.filter(`,
`.flatMap(`, `.concat(`, `.matchAll(`, `Array.from(`, an array literal — and either branch of a
`?? []` or a ternary, since the fallback is written because the other side is a list. `toContain` on
an array is exact membership rather than a substring, and `classOf(out).split(" ")` is the shape a
test reaches for precisely so `justify-end` stops matching inside `group-open:justify-end`.

**A same-file helper that yields a list counts as one too** — `function sectionIds(html): string[]`,
by its return annotation or by what its `return` statements produce, resolved in the same fixpoint
that traces markup. `expect(sectionIds(html)).toContain("terms")` is membership, and the rule would
otherwise see only an `Identifier` callee it knows nothing about.

**An absence claim is never reported.** `expect(html).not.toContain(secret)` and
`expect(html.includes(secret)).toBe(false)` — and its `not.toBe(true)` spelling — both say the
string appears **nowhere in the document**, which is the one thing no exact match can state: there
is no element to pin it to. `.includes(` is still checked on its receiver whenever the claim is
presence, which no matcher-name scan would see.

**What it cannot do: it reads one file.** A substring assertion on a value the rule cannot trace
back to a render — markup arriving as a function parameter, or imported from another file — is not
reported. §3b is what binds; the rule catches the common shapes of breaking it, not every one.

**A site is suppressed with `// oxlint-disable-next-line forge/exact-markup-assertion -- <reason>`,
and `forge/suppression-needs-reason` fails a directive carrying no reason.** Reserve it for a
genuine closed-world coverage sweep — the `expect(list.filter((x) => !html.includes(…))).toEqual([])`
shape, where the substring is how the sweep looks each item up rather than a claim about which
element an attribute landed on. Two exist in the tree today, each with its reason inline.

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

| Matrix row                                                  | Covering tests                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CSRF valid → 200 / invalid → 403                            | `src/form/csrf.test.ts` (mint-then-verify, invalid header, missing token, path and subject mismatch)       |
| CSRF 403 carries security headers                           | `src/app/app.test.ts`                                                                                      |
| Origin same → 200 / cross or missing → 403                  | `src/security/origin.test.ts`, `src/security/cop.test.ts`                                                  |
| Rate limit under / over / binding absent / key unresolvable | `src/security/rate-limit.test.ts`; header carriage in `src/app/app.test.ts`                                |
| Input validation ok / issues                                | `src/app/action.test.ts`, `src/validation/format-issues.test.ts`                                           |
| Body size under / over, both `Content-Length` and streaming | `src/form/parse-form-data.test.ts`, `src/app/action.test.ts`                                               |
| Content-Type valid / invalid → 415                          | `src/security/content-type.test.ts`                                                                        |
| Log-viewer access allow / deny → 403                        | `src/logging/show/route.test.tsx`                                                                          |
| Auth middleware valid / expired session                     | **N/A** — no `auth` namespace exists yet ([`NAMESPACES.md`](./NAMESPACES.md) §5a); add with that namespace |

**`isHxRequest` has no row.** It is a routing hint, not a security boundary, so there is no
guard middleware to test — see [`HTMX.md`](./HTMX.md) §7.

---

## 6. The Verification Gate

See [`TESTING.md`](../governance/TESTING.md) §6 for the one-command-three-modes gate, the flag
table, the prerequisite line, and the scoped-run rule. `config/steps.ts` owns forge's step list
and its per-step tier ([`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) §2a): `fast` holds `typecheck`,
`lint`, `format` and `test`; `standard` adds every `validate-*` row plus
`typecheck:workers-consumer`, `lint:types` and `governance`; `full` adds `validate-changelog` and
`test:browser`.

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

**The fakes refuse what the platform refuses.** A fake that is green where the real binding throws
is worse than no fake: it certifies code that fails on deploy. So `fakeKV.put` throws below the
60-second `expirationTtl` floor ([`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §2c), `fakeR2.get`
throws `UnsatisfiableRangeError` for a range lying **wholly** outside the object while still
clamping an overrun — which is exactly what R2 does, and the distinction is the point — and
`fakeD1.first(column)` rejects a column the row does not carry rather than returning `undefined`
against a declared `T | null`. **Do not "fix" a fake back to permissiveness** when a test fails
against one of these; the test is telling you what production would do.

Not enforcing TTL _expiry_ is a different thing from enforcing the TTL _floor_: the first would need
a clock, the second is a constant.

`fakeD1` both controls results and records the queries issued: a caller-supplied responder drives
the returned rows, and every prepared-and-bound statement is recorded, so one fake serves the
arrange and the assert. `fakeR2` mirrors `fakeKV` over `R2BucketLike`, honouring `delimiter` and `include` on `list`, with a
deterministic content-hash etag — deterministic because a random etag would make a conditional-request assertion
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
