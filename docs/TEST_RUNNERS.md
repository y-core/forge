---
title: Testing Discipline
description: "forge's three test runners, its browser and workerd sets, the entity encoding map, the security matrix coverage map, and the testing namespace fixtures."
audience: consumer
---

# Testing Discipline

> Owns test file placement, the assertion rules, the fakes-over-mocks posture, the security-test requirements, and the verification gate. Other
> documents link here rather than restating them.
>
> Defers to: `config/steps.ts` for the gate's step list; `src/testing/README.md` for the `testing` namespace's fixtures and their usage;
> [`NAMESPACE_DESIGN.md`][nd-1c] §1c for what `validate-exports` proves.

---

## 0. Quick Reference

- §1 Test Runners: the runners, their type stub, and which question each answers
- §1a bun:test Primitives: import source and nesting limit
- §1b Custom bun:test Stub — No bun-types: the hard package ban
- §1c The Browser Set: real Chromium behind its own verb
- §1d Waiting on an htmx Swap: settled, not merely swapped
- §1e Media Options and the Harness `test`: the emulation options, and what keeps them honest
- §1f The Workerd Set: forge inside the real Workers runtime, behind its own verb, and the published helper that starts it
- §2 Co-Located Test Files: tests live beside their source
- §3 HTML Entity Exact-Match Assertion Rule: the encoding contract
- §3a The Encoding Map: character to entity, and what is not escaped
- §3b Exact Match — Never Substring Matching: why `toContain` is banned
- §3c Render Once, Assert Once: the single enforced shape, and the one whole-element assertion a component file keeps
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
- §7f A Subpath That Is Not on the Barrel: why `@y-core/forge/testing/workerd` is imported by name
- §7g elementOf() and the Markup Readers: the exact assertion on one element of a whole page
- §7h matchTextSnapshot() — The Second Off-Barrel Subpath: what it writes, what it refuses, and what it never reads

---

## 1. Test Runners

**Forge's runners answer different questions.** `bun test` proves that a function returns what it should and that the server emitted the markup it
promised. The browser set (§1c) proves that a controller does what it claims **to a keystroke**. The workerd set (§1f) proves that a request is
decoded the way a deployed Worker decodes it. None substitutes for another, and none is dropped.

### 1a. bun:test Primitives

**Import all test utilities from `bun:test`** — never from a third-party test library. The one exception is the browser set, which imports
`@playwright/test` (§1c): driving a real browser needs a browser driver, and there is no forge-owned equivalent to reach for instead. The ban is on
_assertion and mocking_ libraries layered over a runner that already has both, and that ban is unchanged.

**Keep `describe` nesting to at most two levels.** Deeper nesting costs more readability than the grouping buys.

Runner commands and lifecycle-hook usage are in `src/testing/README.md`.

### 1b. Custom bun:test Stub — No bun-types

Forge uses a hand-written stub at `.types/bun-test.d.ts` rather than the `bun-types` package. This is a hard requirement:

- `bun-types` overrides DOM's `fetch` signature with Bun-specific properties.
- That override breaks type-checking of `fetch` in Worker code and test fakes.
- The stub declares exactly `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `mock` — nothing more.

**Do NOT install `@types/bun` or `bun-types`, and do not reference them in `tsconfig.json` or `package.json`.** A change that adds these packages
must be rejected.

### 1c. The Browser Set

**A `*.browser.ts` file runs in real Chromium under its own verb, `bun run test:browser`.** `playwright.config.ts` owns the discovery pattern, the
project list and the parallelism — cite it, never restate it here.

**The set runs the installed binary under node — `playwright test`, in the script and in `browserStep`'s argv alike — and the config imports the
committed `./tooling/gate/chromium` bundle, because under bun a dev server playwright spawns itself is unreachable from the browser in a sandbox.**
[`NAMESPACES.md`][namespaces-3c] §3c is that ruling's single home. The bare name is resolved off the runner's `binDir`, as every command step's is —
a gate never reaches a registry to find what it runs.

**The set is held back to the `full` tier, and the reason is a prerequisite, not cost.** It needs a browser binary, and a prerequisite is the only
legitimate ground for holding a step back. Cost never is. It runs under `bun run verify:full`, the release gate, which is permitted to carry one
([`TESTING.md`][testing-6c] §6c).

**The browser comes from the environment, so forge ships no install script.** `CHROME_PATH` is what `hasChromium` resolves first, so an environment
that sets it at an installed Chromium satisfies the probe before anyone runs anything. `browserStep`'s hint is reached only where it is unset, and
it names `bunx playwright install chromium` rather than a script this repository would otherwise have to define.

**So the browser set is verified manually and at publish, not in the default gate — a ruling, not an oversight.** forge runs no CI, so
`bun run test:browser` before a commit that touches `src/ui/client/` or a controller is the check, and `prepublishOnly` is the backstop: a full run
fails hard when a prerequisite probe returns false (`src/tooling/gate/command.ts`) and refuses a green when nothing ran, so a chromium-absent
machine cannot publish.

**A consequence accepted with it:** `validate-co-location` (`src/tooling/gate/checks/co-location.ts`) counts a `.browser.ts` as satisfying
co-location for a module the default gate never executes, so `bun run verify` can certify as tested a module whose only test it did not run.
Demanding a second unit file would buy a fake one, which is worse.

**`bun test` is untouched by it.** The two never share a process, so no global is ever redefined and forge's Cloudflare `Request` / `Response` /
`fetch` semantics stay exactly as the runtime ships them — which matters, because forge is a Workers framework and those semantics _are_ the
product. File discovery cannot collide either: `bun test` matches `*.test.*` / `*.spec.*`, and `*.browser.ts` is neither.

**This is also why forge registers no DOM shim.** Registering one defines hundreds of globals and shadows Bun natives the rest of the suite
exercises, and a shim that models the platform imperfectly certifies a component against features the real browser has and the model does not.

**What each runner is sufficient evidence for:**

| Claim | Proven by |
| --- | --- |
| the server emitted this exact markup | `bun test`, exact-HTML assertion (§3) |
| a pure function returns this value | `bun test` |
| a controller moves focus / writes an attribute / consumes a key | **the browser set only** |
| a request is decoded the way a deployed Worker decodes it | **the workerd set only** (§1f) |

**An SSR string is not sufficient evidence for a controller**, and a behaviour test does not subsume an exact-HTML test — a component can behave
correctly while emitting markup no stylesheet matches. Where a rebuild changes markup, the exact-HTML test is _updated_, never replaced by a
behaviour test.

**A case in the browser set asserts a DOM or focus state, never a call count.** It builds real markup — rendered by the real SSR components wherever
possible — dispatches a real event through the browser's own input path, and reads what resulted. A test that counts calls is testing the test's own
fixture.

**The browser set cannot prove an `@utility`, and a spec that seems to is passing for another reason.** `mount`'s `css` option serves the
stylesheets **raw, with no Tailwind build**, so a `state-busy` or a `focus-ring` in the mounted markup resolves to nothing at all — a computed-style
assertion against one reads the browser's initial value and says nothing about the recipe. What the option _does_ reach is the plain CSS in
`forge-ui.css`'s `@layer` blocks, which is why `forced-colors.browser.ts` works: its forced-colors block is `[data-slot~="…"]` rules, not utilities.
A claim about a recipe's own selector belongs in a `bun test` that compiles the design system — `src/tooling/gate/checks/state-recipes.test.ts` is
the pattern, and the compiled selector is the artefact it reads.

**A UA pseudo-element is asserted from rendered pixels, never from `getComputedStyle`.** Chromium answers
`getComputedStyle(el, "::-webkit-slider-runnable-track")` with the _host_ element's style rather than the pseudo-element's, so a computed-style spec
for the slider track would pass whatever the track actually did. `slider.browser.ts` samples a screenshot instead.

### 1d. Waiting on an htmx Swap

**A case that interacts with the page after an htmx swap waits on `htmx:afterSettle`, never on the state the swap wrote.** htmx inserts the fragment
into the DOM immediately, then binds its `hx-*` trigger listeners in a settle task deferred by `htmx.config.defaultSettleDelay` — so every swap
leaves a window in which the new markup is fully readable and completely inert. A poll on the swapped-in attributes therefore returns _inside_ that
window, and the next interaction fires no request at all.

Whether the poll's tick lands before or after the settle is a coin flip that CPU contention biases, which is what makes the resulting failure
load-dependent rather than reproducible. `showcase.browser.ts` counts `htmx:afterSettle` on `document.body` and gates on the count. Raising
`defaultSettleDelay` is how such a race is made deterministic while it is being diagnosed; production settle timing is never changed to suit a spec.

### 1e. Media Options and the Harness `test`

**`test.use({ reducedMotion })`, `{ forcedColors }` and `{ contrast }` reach the browser, and a spec may take `test` from either module.**
playwright 1.62 declared them in `types/test.d.ts` but built none of them into `_combinedContextOptions` (`playwright/lib/index.js`), so
`test.use({ reducedMotion: "reduce" })` type-checked and emulated nothing at all. 1.63 builds them, so `src/ui/client/browser.fixture.ts` overrides
nothing and re-exports `@playwright/test`'s `test` unchanged.

**`browser.fixture.browser.ts` is what keeps that safe.** Its cases assert the emulation against the real cascade — a
`prefers-reduced-motion: no-preference` rule leaving the page, `forced-colors: active` matching — so an option silently reverting to a no-op fails
there, rather than passing for the wrong reason in a spec written against the reduced-motion branch of `forge-ui.css`. **Nothing enforces the
import**: taking `test` from the harness alongside `mount` is convention, not a rule.

### 1f. The Workerd Set

**A spec under `tests/workerd/` runs forge inside the real Workers runtime, under its own verb, `bun run test:workerd`.** It exists because the
default suite drives an app through `app.request` under Bun, and Bun's `Request` is not workerd's. Anywhere the two disagree on a request — body
decoding above all — the default suite is green **by construction**, whatever the deployed app does. Forge is a Workers library, so that blind spot
is the one worth paying a runtime for.

**Each spec starts `wrangler dev` over a fixture in `tests/fixtures/`, under node.** Not `createTestHarness`: it starts under bun but never answers
a request, and the wrangler CLI refuses bun outright. Spawning the CLI as a child keeps `bun test` the only test runner in this repository
(`CLAUDE.md`'s toolchain table), while the code under test still executes in workerd. **This paragraph is the single home of that rationale** — the
helper's source states neither half of it.

**The helper itself is published, and forge's specs import it the way a consumer does.** `startDevServer` lives in `src/testing/workerd.ts` and is
reached as `@y-core/forge/testing/workerd`; there is no copy under `tests/`. A spec here imports the published specifier rather than a relative
path, so what forge exercises is the module a consumer loads — including its wrangler resolution, which walks the _consumer's_ `node_modules` and
would be wrong if it were computed from this file's own location. §7f owns why that subpath is off the `./testing` barrel.

**The compose cases run four at a time.** Each case is a dozen wrangler spawns of roughly 250MB apiece, so running every case at once peaked near
4GB and the OOM killer took the gate down; four in flight keeps most of the wall-clock win and holds the peak near a gigabyte.

**The spec files themselves run two at a time, and the number is small because it multiplies against that one.** `bun test` runs files in one
process by default, which left the set serial behind its longest file. `--parallel=2` fits the cheap files into the compose file's slack and cut the
set by about a third. The next value up does not: at `--parallel` with no number — one worker per core — a `wrangler dev` under `startDevServer`
never answered inside its 180s readiness budget, because every spec file at once, plus the compose file's own cases already in flight, is more
processes than the machine has cores. A file here carries its own concurrency, so the file-level number is the multiplier, not the total. The flag
shipped in Bun 1.3.13, which is what `package.json`'s `engines.bun` floor records for a consumer building a gate out of `workerdStep`.

**`stop()` kills the process group, not the CLI.** wrangler spawns workerd and esbuild as its own children, so a signal to the CLI alone leaves a
`workerd` pair reparented to PID 1, ignoring `SIGTERM` and holding a core each. The helper spawns `detached`, kills `-pid` with `SIGKILL`, and binds
that same kill to the runner's `exit`, `SIGINT`, `SIGTERM` and `SIGHUP` — the interrupted run never reaches `afterAll`, and that is the path an
orphan actually escapes through.

**The set is held back to the `full` tier, and the reason is a prerequisite, not cost** — the same ground the browser set is held back on (§1c).
`hasWorkerd` probes `wrangler`, which is what resolves the platform-specific runtime package, and `workerdStep`'s hint names `bun install`.

**`test` is scoped to `src/` so that this set is not also `standard`'s.** A spec here costs a runtime start; a co-located test costs milliseconds,
and the run a task closes on must not pay a runtime start per spec.

---

## 2. Co-Located Test Files

See [`TESTING.md`][testing-2] §2 for co-location, the naming convention, the publish exclusion, and the concrete-file import rule with its
exceptions. forge's browser set follows the same rule under its own suffix (§1c).

**Certain filenames need no test, and none is taken on trust.** A module named `types.ts` or `bin.ts` is exempt by name: the first declares, the
second is argv in and `process.exit` out, and what it wires is tested where that lives. `validate-co-location` then re-checks the claim the name
makes — **one that exports a function, a class, or a const bound to either fails**, naming the callable. Give it a test, or move the function to a
module that has one. There is no third state: a module that needs a nomination goes in `config/exemptions.ts` with the reason it needs one, and a
blank reason fails too.

The convention is deliberately narrow. "Exports no function" would have exempted every component written as `export const Button = (…) => …` and
every lint rule written as an object literal — all of which carry a test — while catching nothing the nominations did not already cover.

---

## 3. HTML Entity Exact-Match Assertion Rule

### 3a. The Encoding Map

The JSX renderer escapes **every** string child, static and interpolated alike. Assert the escaped forms:

| Character | Escaped form |
| --- | --- |
| `'` (apostrophe) | `&#39;` |
| `&` (ampersand) | `&amp;` |
| `<` (less-than) | `&lt;` |
| `>` (greater-than) | `&gt;` |
| `"` in attributes | `&#34;` or `&quot;` |

**Static text in the JSX source is escaped exactly as an interpolated value is** — `<p>Tom & Co</p>` and `<p>{name}</p>` produce the same entities.
Never assert raw `&`, `<`, `>`, `'` or `"` on the strength of a literal being written in the source.

**The one bypass is `SafeHtml`:** a child that passed through `rawHtml` is emitted verbatim. Assert the unescaped form there, and only there. See
`src/jsx/render-to-string.ts`.

**URL-bearing attributes are a further exception:** the renderer routes `href` / `src` / `action` through `safeUrl`, so a `javascript:` URL renders
as `"#"`. Assert the sanitized form.

### 3b. Exact Match — Never Substring Matching

See [`TESTING.md`][testing-3b] §3b for the exact-match rule and why a substring assertion on markup is a defect.

### 3c. Render Once, Assert Once

**Render through `render()` from `@y-core/forge/testing` (§7c) and assert the full markup with one `toBe`.**

```ts
import { render } from "@y-core/forge/testing"

it("renders the exact button markup", async () => {
  expect(await render(<Button label="Save & Exit" />)).toBe(
    '<button type="button">Save &amp; Exit</button>',
  )
})
```

**Do not call the private `jsx` render path, do not render twice to assert two fragments, and do not fall back to `toContain` / `toMatch`.** A
single entity-aware `toBe` on the full output is the only accepted shape.

**One whole-element assertion per `ui/core` component test file, and it is the HTML-escaping case.** Every other case in the file reads back only
the attributes or the classes it is actually about, through `attrsOf`, `attrOf`, `classesOf` or `variantClasses` from `src/testing/markup.ts`.
The escaping case is the one that has to see the whole string, because entity encoding is a property of the output as a whole and §3a is what it
holds the output to; a second whole-markup assertion in the same file buys no coverage and turns every unrelated class or slot change into a
multi-file diff. §3e enforces the half of this a rule can see — that a substring assertion never stands in for either shape — but which case earns
the whole-element `toBe` is a convention, not a lint.

### 3d. Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees

See [`TESTING.md`][testing-3d] §3d for the delete-the-mechanism check, the failure shapes it catches, and the rule that a mechanism is pinned along
with its having been armed. Here, the disposal guard is `if (disposed) return;` in a lazy-loading controller, and the absent subject is
`expect(probe?.[0]).not.toBe("x")`, which passes once `probe` has been deleted outright.

This does not weaken §1c's rule that a browser case asserts a DOM state rather than a call count. What is counted here is the **platform's** own
invocation — a timer callback firing, a property being read — which _is_ the mechanism. §1c bans substituting a count of calls into the test's own
fixture for the DOM state a controller was supposed to produce; where the subject is a DOM state, assert the DOM state.

**The `page.clock` corollary.** Instrumentation of a page global — a wrapped `setTimeout`, an accessor over a third-party global — is installed
**after** the harness's `mount` and after `page.clock.install()`. `setContent` replaces the document and discards every window mutation made before
it, and wrapping the clock's timers rather than the platform's is what keeps a fast-forward in charge of the wrapped timer. Instrumenting earlier
reads as correct and does nothing.

### 3e. forge/exact-markup-assertion — The Enforced Form

**A `toContain`, a `toMatch`, or a `.includes(` whose receiver is rendered markup fails the `lint` step.** The rule is
`forge/exact-markup-assertion`, and `src/tooling/lint/rules/exact-markup-assertion.ts` owns it as enforced ([`SOURCE_OF_TRUTH.md`][sot-2b] §2b);
`.oxlintrc.json` owns which files it judges, scoped by an `overrides` entry to `src/ui`'s `*.test.ts` / `*.test.tsx` and `*.browser.ts` /
`*.browser.tsx`. Its finding cites [`TESTING.md`][testing-3b] §3b — the shape it is pushing a test back towards is §3c.

**Markup is traced through local helpers.** A wrapper — `const page = (which) => render(<X page={which} />)` — and one hop of derivation off a
rendered value — `const band = out.slice(...)` — both still count as markup, resolved by a fixpoint over the file's bindings. Naming the render call
something else is not an escape.

**A derivation that produced a list is deliberately not flagged**: `.split(`, `.map(`, `.filter(`, `.flatMap(`, `.concat(`, `.matchAll(`,
`Array.from(`, an array literal — and either branch of a `?? []` or a ternary, since the fallback is written because the other side is a list.
`toContain` on an array is exact membership rather than a substring, and `classOf(out).split(" ")` is the shape a test reaches for precisely so
`justify-end` stops matching inside `group-open:justify-end`.

**A same-file helper that yields a list counts as one too** — `function sectionIds(html): string[]`, by its return annotation or by what its
`return` statements produce, resolved in the same fixpoint that traces markup. `expect(sectionIds(html)).toContain("terms")` is membership, and the
rule would otherwise see only an `Identifier` callee it knows nothing about.

**An absence claim is never reported.** `expect(html).not.toContain(secret)` and `expect(html.includes(secret)).toBe(false)` — and its
`not.toBe(true)` spelling — both say the string appears **nowhere in the document**, which is the one thing no exact match can state: there is no
element to pin it to. `.includes(` is still checked on its receiver whenever the claim is presence, which no matcher-name scan would see.

**What it cannot do: it reads one file.** A substring assertion on a value the rule cannot trace back to a render — markup arriving as a function
parameter, or imported from another file — is not reported. §3b is what binds; the rule catches the common shapes of breaking it, not every one.

**A site is suppressed with `// oxlint-disable-next-line forge/exact-markup-assertion -- <reason>`, and `forge/suppression-needs-reason` fails a
directive carrying no reason.** Reserve it for a genuine closed-world coverage sweep — the
`expect(list.filter((x) => !html.includes(…))).toEqual([])` shape, where the substring is how the sweep looks each item up rather than a claim about
which element an attribute landed on.

---

## 4. Fakes Over Mocks

See [`TESTING.md`][testing-4] §4 for the fakes-over-mocks posture, the compile-time-drift argument, and the no-mock-library ban. The fakes forge
ships are §7 below.

---

## 5. Security Test Requirements

### 5a. Both Pass and Fail Cases Required

See [`TESTING.md`][testing-5a] §5a for the both-directions requirement and the guard matrix. forge builds the app under test the way production does
— a `route()` map bound through `createController`, path-scoped middleware on `app.use`, and requests driven through `app.request(path, init, env)`.
For a namespace's own unit tests, `mapHandler` (§7e) registers a single route without a full map.

### 5b. Negative Case Structure

See [`TESTING.md`][testing-5b] §5b for the rule that a negative case asserts the exact status **and** a meaningful body.

### 5c. No Mocking of Security Primitives

See [`TESTING.md`][testing-5c] §5c for the ban on mocking a security primitive, and why an untestable primitive is a design signal rather than a
licence to mock.

### 5d. Security Matrix — Row-to-Test Coverage Map

Where each §5a row is covered at integration level, through `app.request()` with real primitives:

| Matrix row | Covering tests |
| --- | --- |
| CSRF valid → 200 / invalid → 403 | `src/form/csrf.test.ts` (mint-then-verify, invalid header, missing token, path and subject mismatch) |
| CSRF 403 carries security headers | `src/app/app.test.ts` |
| Origin same → 200 / cross or missing → 403 | `src/security/origin.test.ts`, `src/security/cop.test.ts` |
| Rate limit under / over / binding absent / key unresolvable | `src/security/rate-limit.test.ts`; header carriage in `src/app/app.test.ts` |
| Input validation ok / issues | `src/app/action.test.ts`, `src/validation/format-issues.test.ts` |
| Body size under / over, both `Content-Length` and streaming | `src/form/parse-form-data.test.ts`, `src/app/action.test.ts` |
| Content-Type valid / invalid → 415 | `src/security/content-type.test.ts` |
| Log-viewer access allow / deny → 403 | `src/logging/show/route.test.tsx` |
| Auth middleware valid / expired session | `src/auth/web/guards.test.ts` (anonymous redirect, deactivated user, store unavailable, admin and step-up refusals), `src/auth/web/identity.test.ts` (absolute lifetime, revocation barrier, missing established-at stamp) |

**`isHxRequest` has no row.** It is a routing hint, not a security boundary, so there is no guard middleware to test — see [`HTMX.md`][htmx-7] §7.

---

## 6. The Verification Gate

See [`TESTING.md`][testing-6] §6 for the one-command-three-modes gate, the flag table, the prerequisite line, and the scoped-run rule.
`config/steps.ts` owns forge's step list and its per-step tier ([`SOURCE_OF_TRUTH.md`][sot-2a] §2a).

**A step sits in `quality` unless it runs the code rather than judging it.** That rule, and not a speed estimate, is what decides a new row: every
`validate-*` check, both typechecks, `lint`, `format`, `lint:types` and the digest comparison judge source, so `quality` holds them and costs about
thirteen seconds. `standard` adds `test`, which is over half the gate's wall time on its own. `full` adds `validate-changelog` and the runtime
suites, `test:browser` and `test:workerd`.

**So the tier a row declares marks what it costs, not what it is**: a table read top to bottom is `quality` except where it says otherwise, which is
why `config/steps.ts` carries a `tier` key only on the rows that are not. `test` is scoped to `src/`, so `standard` runs the co-located suites alone
and the workerd set is reached only through its own step (§1f).

The table is not the running order: the selector sorts by tier after filtering, so every `quality` row runs before `test` and both before `full`,
with declared order preserved inside each tier. This is what makes a wrap or comment-budget failure surface in seconds rather than after the suite —
and `browserStep` sitting above `dbSchemaStep` in the file does not put Chromium ahead of the digest check.

---

## 7. Testing Namespace Utilities (`@y-core/forge/testing`)

The `testing` namespace ships the fixtures every consumer suite would otherwise hand-roll. **Import them from the barrel** — consumer test code sits
outside the source tree, so the concrete-file rule in [`TESTING.md`][testing-2c] §2c does not apply. §7f and §7h are the stated exceptions, and
each is a published subpath of its own rather than a file reached past a barrel. `src/testing/README.md` teaches the fixtures by the task each
one serves.

### 7a. Declared Integration Edge — testing Imports app and jsx

`testing` is an integration namespace ([`NAMESPACES.md`][namespaces-4b] §4b). A test-only namespace reaching into `app` and `jsx` is the **declared,
acceptable** edge — these utilities exist precisely to drive the app and render pipelines. **This is the one place forge source may depend on the
private `jsx` render helper**, re-exported as `render()` (§7c).

### 7b. In-Memory Storage Fakes — fakeKV, fakeD1, fakeR2

`Map`-backed fakes implement the real `storage/*` structural contracts, so interface drift breaks tests at compile time
([`TESTING.md`][testing-4a] §4a). **Never mock these bindings.**

`fakeKV` implements the full KV contract, including cursor-paginated `list`. **An expiry is enforced against the clock the caller injects** —
`fakeKV(seed, { now })` — and an expired key is absent from `get`, `getWithMetadata` and `list` alike, as it is in a real binding. **A test must
still never depend on wall-clock expiry**: the default clock is `Date.now`, so a suite that waited for a real TTL to elapse would fail by being
slow. Advance an injected clock instead.

**The fakes refuse what the platform refuses.** A fake that is green where the real binding throws is worse than no fake: it certifies code that
fails on deploy. So `fakeKV.put` throws below the 60-second `expirationTtl` floor ([`STORAGE_BINDINGS.md`][sb-2c] §2c), `fakeR2.get` throws
`UnsatisfiableRangeError` for a range lying **wholly** outside the object while still clamping an overrun — which is exactly what R2 does, and the
distinction is the point — and `fakeD1.first(column)` rejects a column the row does not carry rather than returning `undefined` against a declared
`T | null`. **Do not "fix" a fake back to permissiveness** when a test fails against one of these; the test is telling you what production would do.

**`fakeD1.batch` evaluates a `requireRowsWritten()` guard** rather than returning success for every statement it is handed. A guard behind a write
that reported no row rolls the batch back with the error a real D1 raises, so the client's own rewording is what a test sees
([`STORAGE_BINDINGS.md`][sb-1g] §1g). Supply the row count through `fakeD1(responder, { rowsWritten })` for a batch that should commit — the default
is zero, and a guarded batch left on the default is meant to fail. A guard behind a _non-write_ stays inert, mirroring a real `changes()`, which
reads through to the last write; [`STORAGE_BINDINGS.md`][sb-1g] §1g calls that shape a bug, and the fake does not diagnose it.

The TTL _floor_ is a different thing from the TTL _expiry_: the floor is a constant and refuses the write, the expiry needs a clock and hides the
value.

`fakeD1` both controls results and records the queries issued: a caller-supplied responder drives the returned rows, and every prepared-and-bound
statement is recorded, so one fake serves the arrange and the assert. `fakeR2` mirrors `fakeKV` over `R2BucketLike`, honouring `delimiter` and
`include` on `list`, with a deterministic content-hash etag — deterministic because a random etag would make a conditional-request assertion
unwritable.

### 7c. render() — SSR Render-to-String

`render` renders a JSX element to its exact HTML string, wrapping the private `jsx` `renderToString` runtime and coercing the result to a plain
string — so the render-once / assert-once convention (§3c) is a single call.

### 7d. buildRequest() — Request Builder

`buildRequest` builds a `Request` in place of hand-rolled `new Request(...)` boilerplate, resolving a relative path against a default base so no
test hardcodes an origin. The method is inferred from whether a body is present, and a body helper sets its own content-type unless the caller set
one — so the common case names neither.

**Supply exactly one body helper** — `formData`, `json`, or `body`. Two would silently pick one.

### 7e. mapHandler() and TestAction — Single-Route Registrar

`mapHandler` registers one route on a `Forge` app, mirroring `app.map(routes, controller)` without a full route map. Its `action` is a `TestAction`
— the same bare-handler or `{ middleware, handler }` shape a real controller accepts, so a test never exercises a registration shape production
cannot express.

**Use `mapHandler` for a namespace's own unit tests; use a full `route()` / `createController` map (§5a) when the test must exercise the production
registration path itself.**

### 7f. A Subpath That Is Not on the Barrel — `@y-core/forge/testing/workerd`

`@y-core/forge/testing/workerd` publishes `startDevServer`, `DevServer` and `DevServerOptions`, and it is **a stated exception to §7's opening
line.** Import it by its own subpath; it is not re-exported from `src/testing/mod.ts` and will not be.

**The reason is what the module reads.** It runs `wrangler dev` as a child process, so it imports `node:child_process`, `node:fs`, `node:net`,
`node:os`, `node:path` and `node:url`. A Worker-side test program compiles under `"types": []` against the Workers and DOM lib set, and none of
those modules exists there — putting the symbol on the barrel would make every `import … from "@y-core/forge/testing"` in a Worker-typed suite pull
a module its own program cannot type. Off the barrel, the only way to reach it is to ask for it by name, which is a decision the importing file
makes visibly. `checkExports` supports this directly: a non-`mod.ts` export target is excluded from its parent barrel's `@public` coverage walk, so
"published but off the barrel" is a shape the gate holds rather than one it tolerates.

**A suite that imports it references the shim, and then needs no `exclude`.** `@y-core/forge/testing/node` is a types-only subpath declaring exactly
the node surface `workerd.ts` reaches — the `node:*` modules above, plus `Buffer` and the `process` members it calls. One line at the top of the
file that reaches `startDevServer`:

```ts
/// <reference types="@y-core/forge/testing/node" />
```

A type reference directive is resolved per file, so the Worker half of the same program keeps an empty `types` array and sees none of it. This is
the supported way to put `tests/workerd/**` in a consumer's type program; dropping the directory from `include`, or adding `node` to `types`, is
not. Forge exercises it from `tests/fixtures/workers-consumer/workerd-suite.ts`, which compiles under `"types": []` the way a consumer's does.

**It reaches ambient Node globals too, not only the `node:` imports above.** `process.env`, `process.kill`, `process.once` and `process.exit`, and
Node's `Buffer`. They arrive without an import statement, so a grep for `node:` does not find them; `@y-core/forge/testing/node` declares them for
the same reason it declares the modules.

**What makes the file legal is that no deployed code can reach it, not an exemption from "Web APIs only".** There is no gate step that checks for a
non-Web API — the rule is prose in `CLAUDE.md`, and the only thing enforcing it is that a runtime source file typechecks under the Workers lib set,
where `node:child_process` does not resolve. `src/testing` stays out of a Worker by reachability instead: it is one of `devBoundaryStep`'s
`devOnlyDirs`, so no deployed file may import it, and `buildTimeBoundaryStep`'s `buildTimeDirs` pointedly leaves it out. A new file that wants Node
earns it the same way or not at all — the question to answer is whether anything shipped can reach it, and "it is only used in tests" is not that
answer unless a boundary step says so.

**`wrangler` is an optional peer dependency**, declared because the module resolves the CLI out of the importing package's own tree —
`import.meta.resolve("wrangler/package.json")`, never a path relative to forge's checkout. A consumer that imports this subpath installs `wrangler`;
one that does not, never loads the module and never needs it.

**Everything the process leaves behind is removed by `stop()`** — the process group (§1f) and the temp directory holding the `--env-file` it was
started with. The env file is written per start into a fresh `mkdtemp` directory rather than under a per-port name, because the OS reuses a port and
successive runs would then share a file; one recursive remove is the whole cleanup.

### 7g. elementOf() and the Markup Readers — One Element of a Whole Page

A page served through `app.request` cannot be asserted with one `toBe`: it is long, and its nonce differs per render. §3b does not relax for that,
so `elementOf(html, tag, selector?)` cuts the whole first element of a tag — or the first whose opening tag carries `selector` spelled as rendered
— out of the page for the exact assertion, children included and a void element as its opening tag. `innerOf` strips an element's own tags;
`tagOf`, `attrOf`, `attrsOf` and `classesOf` read the opening tag, and `variantClasses` is the class diff between two renders — published so a
consumer's seam suite and forge's own component specs (§3c) reach the same shape rather than a private copy per file. Each answers `""` or an
empty record for an element the page never rendered; the `toBe` against the expected markup is what makes that a failure.

### 7h. matchTextSnapshot() — The Second Off-Barrel Subpath

`@y-core/forge/testing/snapshot` publishes `matchTextSnapshot`, which compares text against a committed fixture on disk. It reads `node:fs` and
`node:path`, so it is off the `./testing` barrel for the reason §7f gives, declares its surface in the same `src/testing/node.d.ts` shim, and is
held to that shim's sufficiency by `tests/fixtures/workers-consumer/snapshot-suite.ts`.

**It is format-agnostic, and depends on no other namespace.** It takes a string. It is what `formatPdfLayout` ([`README.md`][pdf-readme]) was
built to feed, and it knows nothing about PDF, about layout or about forge's own output — a consumer comparing rendered markup, a generated SQL
schema or a CLI transcript uses the same function.

**An absent fixture is written and the call passes — except under `ci`.** The first run of a new suite should not fail on a file nobody could have
committed yet; a CI run must not regenerate one silently, so `ci: true` turns the absence into `reason: "missing"` and writes nothing at all.

**`update` is explicit, and no environment variable is ever read.** Whether fixtures are rewritten is an argument a caller passes, so it is visible
at the call site rather than in an ambient variable a runner may or may not have set. **`ci` overrides `update`**: a CI run carrying `update` from a
stale script rewrites nothing.

**It returns a `Result` and never throws** ([`FORGE_ERRORS.md`][errors-1a] §1a). An unreadable or unwritable path is a `reason` on the failure
channel with the original `Error` as `cause`, not an exception — rethrowing is the caller's decision rather than the library's.

**The diff is anchored-positional, not an LCS.** The identical run at each end is trimmed and the remaining band is paired positionally, each side
sliced to its own length so the shorter pads with `null`. That is O(n) and about twenty lines, and it reads an insertion correctly, where a raw
positional compare would report every following line as changed. The residual case — an insertion adjacent to a change, which pairs and reads as a
rewrite — is disclosed by the report's header carrying both files' line counts. Every rendered line is quoted, because a trailing space, a tab for
spaces and a stray `\r` are what "files differ" is most useless about; the comparison itself is byte-exact and happens before any of that.

`diff` carries every differing line and `report` is capped at `limit`, so a caller inspecting the data programmatically never fights the renderer.

[errors-1a]: ./FORGE_ERRORS.md#1a-the-unified-result-primitive-okerr-result-and-toerror
[htmx-7]: ./HTMX.md#7-trust-posture--selectors-and-json-values-must-be-developer-supplied
[namespaces-3c]: NAMESPACES.md#3c-toolinglint--a-namespace-whose-barrel-is-also-a-plugin
[namespaces-4b]: ./NAMESPACES.md#4b-integration-namespace-rules
[nd-1c]: ../warden/canon/libs/NAMESPACE_DESIGN.md#1c-what-the-export-gate-proves
[pdf-readme]: ../src/output/pdf/README.md
[sb-1g]: ./STORAGE_BINDINGS.md#1g-transactions--batch-is-the-boundary
[sb-2c]: ./STORAGE_BINDINGS.md#2c-kvstore-operations
[sot-2a]: ./SOURCE_OF_TRUTH.md#2a-package-and-configuration-facts
[sot-2b]: ./SOURCE_OF_TRUTH.md#2b-enforced-rules
[testing-2]: ../warden/canon/libs/TESTING.md#2-co-located-test-files
[testing-2c]: ../warden/canon/libs/TESTING.md#2c-import-concrete-files-in-tests
[testing-3b]: ../warden/canon/libs/TESTING.md#3b-exact-match--never-substring-matching
[testing-3d]: ../warden/canon/libs/TESTING.md#3d-assert-the-mechanism-not-an-outcome-a-second-mechanism-also-guarantees
[testing-4]: ../warden/canon/libs/TESTING.md#4-fakes-over-mocks
[testing-4a]: ../warden/canon/libs/TESTING.md#4a-fake-pattern--implement-the-interface
[testing-5a]: ../warden/canon/libs/TESTING.md#5a-both-pass-and-fail-cases-required
[testing-5b]: ../warden/canon/libs/TESTING.md#5b-negative-case-structure
[testing-5c]: ../warden/canon/libs/TESTING.md#5c-no-mocking-of-security-primitives
[testing-6]: ../warden/canon/libs/TESTING.md#6-the-verification-gate
[testing-6c]: ../warden/canon/libs/TESTING.md#6c-the-two-lines-between-the-modes
