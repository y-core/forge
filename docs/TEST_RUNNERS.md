---
title: Testing Discipline
description: "forge's test runners, its browser and workerd sets, the entity encoding map, the security matrix coverage map, and the testing namespace fixtures."
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
- §1c The Browser Set: real browsers behind their own verb
- §1d Waiting on an htmx Swap: `htmx:after:swap` on `document`, once the new markup is live
- §1e Media Options and the Harness `test`: the emulation options, and what keeps them honest
- §1f The Workerd Set: forge inside the real Workers runtime, behind its own verb, on `createTestHarness` under node
- §1g The Cross-Engine Subset: which specs also run in Firefox and WebKit, outside the gate, and how a skip on one engine is written
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
- §6 The Verification Gate: what must pass before a task closes, and before a commit
- §7 Testing Namespace Utilities: the shared fixtures
- §7a Declared Integration Edge: why `testing` may import `app` and `render/jsx`
- §7b In-Memory Storage Fakes: `fakeKV`, `fakeD1`, `fakeR2`
- §7c render() — SSR Render-to-String: the assertion entry point
- §7d buildRequest() — Request Builder: options and body helpers
- §7e mapHandler() and TestAction: single-route registrar
- §7f Subpaths That Are Not on the Barrel: why `@y-core/forge/testing/snapshot`, `/harness` and `/d1` are imported by name
- §7g elementOf() and the Markup Readers: the exact assertion on one element of a whole page
- §7h matchTextSnapshot() — Text Against a Committed Fixture: what it writes, what it refuses, and what it never reads
- §7i The Expected Coverage Set: the components a consumer's coverage manifest must declare, read off the barrels

---

## 1. Test Runners

**Forge's runners answer different questions.** `bun test` proves that a function returns what it should and that the server emitted the markup it
promised. The browser set (§1c) proves that a controller does what it claims **to a keystroke**. The workerd set (§1f) proves that a request is
decoded the way a deployed Worker decodes it. None substitutes for another, and none is dropped.

### 1a. bun:test Primitives

See [`TESTING.md`][testing-1a] §1a for the import source and the nesting limit. forge's runner is `bun:test`, and its one external test dependency
is the browser set's driver, `@playwright/test` (§1c).

Runner commands and lifecycle-hook usage are in `src/testing/README.md`.

### 1b. Custom bun:test Stub — No bun-types

See [`TESTING.md`][testing-1b] §1b for the ban and its reason. forge's stub is `.types/bun-test.d.ts`, and it replaces `bun-types` and `@types/bun`:
**never install either, or reference one from `tsconfig.json` or `package.json`.** The stub is the list of what a suite may import from `bun:test`.

### 1c. The Browser Set

**A `*.browser.ts` file runs in real Chromium under its own verb, `bun run test:browser`, and §1g's subset runs in Firefox and WebKit under `bun run
verify:cron`, the cron table `config/cron.ts`.** `playwright.config.ts` owns the discovery pattern, the project list and the parallelism — cite it,
never restate it here.

**The set runs the installed binary under node — `playwright test` with one `--project` per engine, in the script and in `browserStep`'s argv alike
— because under bun a dev server playwright spawns itself is unreachable from the browser in a sandbox.** [`NAMESPACES.md`][namespaces-3c] §3c is
that ruling's single home. The bare name is resolved off the runner's `binDir`, as every command step's is — a gate never reaches a registry to
find what it runs.

**Chromium's row runs at `scheduled`, whole, because a step that starts a browser is heavy** ([`TESTING.md`][testing-6c] §6c). §1g's Firefox and
WebKit row is a `scheduled` row too, but of its own table, `config/cron.ts`, run by `verify:cron` — never a row of the gate's table.

**A journey spec may start a Worker, and then needs workerd (§1f) as well as Chromium** — `src/auth/journey.browser.ts` is the case.

**Every browser runs in a devctl Playwright container, and nothing falls back to a local one.** forge, the workspace and the containers are one
environment, so a missing piece fails loudly. Chromium runs on `playwright`, and Firefox and WebKit on `playwright-compat`, which devctl starts
only on request. `playwright.config.ts` owns the variable that names each server and the worker limit, and refuses to load without Chromium's.

**A consequence accepted with it:** `validate-co-location` (`src/tooling/gate/checks/co-location.ts`) counts a `.browser.ts` as satisfying
co-location, so `bun run verify:unit`, which runs no browser, can certify as tested a module whose only test it did not run. Demanding a second
unit file would buy a fake one, which is worse.

**`bun test` and the browser set never share a process, and forge registers no DOM shim**, for the reasons [`TESTING.md`][testing-1c] §1c gives.
File discovery cannot collide either: `bun test` matches `*.test.*` / `*.spec.*`, and `*.browser.ts` is neither.

**What each runner is sufficient evidence for** is [`TESTING.md`][testing-1c] §1c's table, and forge adds a row: a request decoded the way a
deployed Worker decodes it is proven by **the workerd set only** (§1f). A browser case renders its markup with the real SSR components wherever
possible.

**`mount`'s `css` option cannot prove an `@utility`, and a spec that seems to is passing for another reason.** The option serves the stylesheets
**raw, with no Tailwind build**, so a `state-busy` or a `focus-ring` in the mounted markup resolves to nothing at all — a computed-style assertion
against one reads the browser's initial value and says nothing about the recipe. **A claim that depends on a utility or on preflight mounts
`withCompiledCss(html)` instead**, which inlines the Tailwind build of the markup's own classes, preflight included. A claim about a recipe's own
selector belongs in a `bun test` that compiles the design system — `src/tooling/gate/checks/state-recipes.test.ts` is the pattern, and the compiled
selector is the artefact it reads.

**A UA pseudo-element is asserted from rendered pixels, never from `getComputedStyle`.** Chromium answers
`getComputedStyle(el, "::-webkit-slider-runnable-track")` with the _host_ element's style rather than the pseudo-element's, so a computed-style spec
for the slider track would pass whatever the track actually did. `slider.browser.ts` samples a screenshot instead.

### 1d. Waiting on an htmx Swap

**A case that interacts with the page after an htmx swap waits on `htmx:after:swap`, listened for on `document`, never on the state the swap
wrote.** htmx inserts the fragment, settles it, and binds the new markup's `hx-*` listeners before it fires `htmx:after:swap`, so the event marks
the moment the new markup is live. Before it there is a window in which the markup is fully readable and completely inert. A poll on the swapped-in
attributes returns _inside_ that window, and the next interaction fires no request at all.

**Listen on `document`, not on an element.** htmx dispatches the event on the element that issued the request, and when the swap removed that
element it dispatches on the swap target or on `document` instead. The event bubbles, so `document` is the one listener that hears every swap.

**The nearest-sounding event is the wrong wait.** htmx 4 has no `htmx:afterSettle`, and its `htmx:after:settle` fires _before_ the new content is
processed, so waiting on it reopens the same window.

Whether a poll's tick lands before or after that processing is a coin flip that CPU contention biases, which is what makes the resulting failure
load-dependent rather than reproducible. `resume.browser.ts` awaits `htmx:after:swap` on `document` before it interacts. Raising
`defaultSettleDelay` is how such a race is made deterministic while it is being diagnosed; production settle timing is never changed to suit a spec.

### 1e. Media Options and the Harness `test`

**`test.use({ reducedMotion })`, `{ forcedColors }` and `{ contrast }` reach the browser, and a spec may take `test` from either module.**
`src/ui/client/browser.fixture.ts` overrides nothing and re-exports `@playwright/test`'s `test` unchanged. An option that type-checks can still
emulate nothing, which is the failure the next paragraph guards against.

**`browser.fixture.browser.ts` is what keeps that safe.** Its cases assert the emulation against the real cascade — a
`prefers-reduced-motion: no-preference` rule leaving the page, `forced-colors: active` matching — so an option silently reverting to a no-op fails
there, rather than passing for the wrong reason in a spec written against the reduced-motion branch of `forge-ui.css`. **Nothing enforces the
import**: taking `test` from the harness alongside `mount` is convention, not a rule.

### 1f. The Workerd Set

**A spec under `tests/workerd/` runs forge inside the real Workers runtime, under its own verb, `bun run test:workerd`.** It exists because the
default suite drives an app through `app.request` under Bun, and Bun's `Request` is not workerd's. Anywhere the two disagree on a request — body
decoding above all — the default suite is green **by construction**, whatever the deployed app does. Forge is a Workers library, so that blind spot
is the one worth paying a runtime for.

**Every runtime suite starts its Worker with wrangler's `createTestHarness`, under Playwright on node — the `workerd` project beside `chromium`.**
Under bun the harness starts and never answers a request: bun replaces the `undici` miniflare ships with, the replacement drops the `cf` blob a
request carries, the harness's proxy never receives the message that tells it to forward, and every request queues forever. Under node it answers,
bundles a TypeScript `main`, starts harnesses side by side with no lock, and captures the Worker's console through `getLogs()`. Playwright is
already forge's node runner (§1c), so the set gains no runner. **This paragraph is the single home of that rationale.** The project's discovery
pattern in `playwright.config.ts` is one `bun test` never collects, and the auth journey (`src/auth/journey.browser.ts`) reaches the same harness
from the `chromium` project.

**`serveWorker` in `@y-core/forge/testing/harness` is the one start, for forge and its consumers alike.** It serves a config's Worker, or an `entry`
in place of its `main` under the same bindings, and sets `SITE_ORIGIN` to the origin it answers on, over any caller var of that name. An inline
harness config has no `secrets` of its own, so under `entry` they reach the Worker as vars. `siteHost: "localhost"` is for a WebAuthn journey, which
refuses an IP address as an RP ID. `dev: true` serves the Worker as `forge cf dev` builds it, every `#relax/*` import armed; starts in one process
queue, because the build conditions are read from the shared process environment. Forge's specs reach it through `tests/workerd/harness.fixture.ts`,
whose `harnessTest(options)` returns a Playwright `test` with a worker-scoped `served` fixture, closed when the worker ends. That wrapper stays
unpublished, because publishing it would make `@playwright/test` a forge peer. The project runs a file's tests in one worker, so every test in a
file shares one Worker and files run side by side.

**The harness keeps no storage between runs**, so a spec starts on an empty database. `db-migrate.workerd.ts` needs the state `forge db migrate`
wrote under `--persist-to`, which the harness cannot read, so it serves no Worker: it opens the same miniflare D1 engine through `getPlatformProxy`
(`tests/workerd/d1.ts`) and calls `checkSchemaHealth` on that binding directly.

**The compose cases run on a bounded pool, `CASE_CONCURRENCY` in `tests/workerd/db-compose.workerd.ts`.** Each case spawns wrangler many times
over, so running every case at once exhausts memory and the OOM killer takes the gate down; a small pool keeps most of the wall-clock win.

**The set runs from the `runtime` tier, narrowed to the specs the pending changes reach, and the reason is a prerequisite, not cost**
([`TESTING.md`][testing-6c] §6c).
`hasWorkerd` probes `wrangler`, which is what resolves the platform-specific runtime package, and `workerdStep`'s hint names `bun install`.

**`test` does not reach `tests/workerd/`, so that this set is not also `unit`'s.** A spec here needs a runtime start, and `unit` is the run for
a machine with no runtime installed.

### 1g. The Cross-Engine Subset

**This subset runs on Firefox and WebKit by hand or on the cron run, through `verify:cron`, never in the gate**, because forge ships the UI an
application signs off against there and an engine difference is rare enough that a tag need not wait on one. For an application those engines run
every spec ([`TESTING.md`][testing-apps-6e] §6e).

**A spec joins the subset when its assertion reads something the engine computes rather than something forge's JavaScript wrote.** That covers CSS
layout and anchor placement; top-layer, popover, dialog, invoker and light-dismiss behaviour; forced colors and UA styling; resolved colour and
contrast, which forge's tokens reach through `light-dark()` and `color-mix()`; no-script platform defaults; and the focus and `:focus-visible`
heuristics. Engines disagree there, and a Chromium-only run is green wherever they do.

**A spec stays Chromium-only when a second engine could not tell it anything, or could not run it:** forge's own DOM logic — signals, binding,
htmx glue, resume — and a spec needing a Chromium-only Playwright capability, CDP's virtual WebAuthn authenticator or the accessibility tree.

**The tag is `{ tag: "@cross-engine" }` on a top-level `describe` or bare top-level `test`, and that block is the unit.** A block is judged by
what its own assertions read, so one file may hold tagged and untagged blocks side by side, and a `describe` or `test` inside a top-level `for` is a
block of its own. The `firefox` and `webkit` projects select the tag by `grep`; the `chromium` project has no `grep` and runs everything.
**`validate-cross-engine-tags` holds the unit:** it fails an untagged block that makes one of the engine reads
`src/tooling/gate/checks/cross-engine-tags.ts` names, directly or through a helper in its file or a `*.fixture.ts` it imports, and fails
`@cross-engine` written anywhere else, in a title or on a nested case. **A block it flags wrongly is tagged, never excused** — an extra engine run
costs time, and a missed one hides a defect. It cannot tell an engine's focus heuristic from forge moving focus itself, so a block that reads
`document.activeElement` is tagged by the test above, not by the check.

**A skip on one engine is either a forge defect or a missing platform behaviour, and its reason says which.** A forge defect is filed as a `bug`
task before the skip is written, and the reason reads `"<task-id>: <symptom on this engine>"`, so the task that fixes it is the one that removes it.
A behaviour the engine does not implement is not forge's to file, and the reason names the missing behaviour, such as WebKit's absent forced-colors
palette. Either way the skip is the first line of the case, `test.skip(browserName === "…", reason)`, never a tag taken off.

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

See [`TESTING.md`][testing-3a] §3a for the rule and its two bypasses; the table above is the map it defers to. In forge the trusted value is a
`SafeHtml` from `rawHtml`, and every attribute in `URL_ATTRS` (`src/render/jsx/render-to-string.ts`) passes through `safeUrl`, so a `javascript:`
URL renders as `"#"`.

### 3b. Exact Match — Never Substring Matching

See [`TESTING.md`][testing-3b] §3b for the exact-match rule and why a substring assertion on markup is a defect.

### 3c. Render Once, Assert Once

See [`TESTING.md`][testing-3c] §3c for the rule. In forge the shared helper is `render()` from `@y-core/forge/testing` (§7c), and the one exact
assertion is a `toBe`:

```ts
import { render } from "@y-core/forge/testing"

it("renders the exact button markup", async () => {
  expect(await render(<Button label="Save & Exit" />)).toBe(
    '<button type="button">Save &amp; Exit</button>',
  )
})
```

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

This does not weaken [`TESTING.md`][testing-1c] §1c's rule that a browser case asserts a DOM state rather than a call count. What is counted here is
the **platform's** own invocation — a timer callback firing, a property being read — which _is_ the mechanism. That rule bans substituting a count
of calls into the test's own fixture for the DOM state a controller was supposed to produce; where the subject is a DOM state, assert the DOM state.

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
| Log-viewer access allow / deny → 403 | `src/logging/viewer/route.test.tsx` |
| Auth middleware valid / expired session | `src/auth/web/guards.test.ts` (anonymous redirect, deactivated user, store unavailable, admin and step-up refusals), `src/auth/web/identity.test.ts` (absolute lifetime, revocation barrier, missing established-at stamp) |

**`isHxRequest` has no row.** It is a routing hint, not a security boundary, so there is no guard middleware to test — see [`HTMX.md`][htmx-7] §7.

---

## 6. The Verification Gate

See [`TESTING.md`][testing-6] §6 for the one command and its tiers, the flag table, the lines between the tiers, and the scoped-run rule.
`config/steps.ts` owns forge's step list and its per-step tier ([`SOURCE_OF_TRUTH.md`][sot-2a] §2a).

**A step's tier follows [`TESTING.md`][testing-6c] §6c's lines**, and an omitted `tier` is `static`. `unit` adds `test`;
`runtime` adds the workerd suite and the database rows (§1f); `scheduled` runs those whole and adds the heavy rows — the Chromium set (§1c) — and
the rows that judge a finished change. `test` covers every co-located suite that judges nothing external — `src/`,
`config/` and `warden/src/` — so `unit` runs those alone and the workerd set is reached only through its own step (§1f).

**forge's workerd row runs whole when a change reaches what a spec loads without importing it**: a file named by `new URL(…, import.meta.url)`,
or a Worker config with its `main`'s closure. `config/spec-reach.ts` is its `widen`, and refuses any such site it cannot read as a literal. A
fixture path built with `join()` is not traced, so `tests/fixtures/**` is `wide`.

**forge's tag runs `unit` on the remote, not `scheduled`**: `forge release` runs `verify:scheduled` locally and refuses to tag a tree it has not
passed ([`TESTING.md`][testing-6c] §6c). A tag pushed by hand or past `--allow-unverified` reaches no runtime suite.

**The reviewer's baseline is a static reuse run, and the developer's task check is what answers it.** [`CODE_REVIEW.md`][cr-1a] §1a has the
reviewer run `verify --tier static --reuse` and the task's touched test files. The task check's `static` run records a receipt naming the tree it
judged, so a reviewer on the same bytes gets a one-line verdict; anything that moved runs the static tier. A test that writes into the tree moves
the bytes that receipt names, so every baseline after it pays for a whole static run.

**`GATE_INPUTS` in `config/steps.ts` holds the runner and the code its checks run**: the check code under `src/tooling` and `warden/src`, and the
`result` primitive it imports. No builder can derive these, because a check's own implementation is never in its config, yet an edit there can
change any row's verdict — so under `--affected` a change to one runs every step. **A row stays undeclared and runs on every change when no path
list bounds what it reads** — the whole type program, an unbounded import graph, every path a document names, or the whole surface the exports map
declares. `config/steps.test.ts` pins that set, so declaring one of these rows is a decision the test makes visible.

**Each spawned step runs under its own `TMPDIR`, which the gate removes with whatever the step left in it**; a failed step's full log is all a
run keeps. **`test` also fails when its suite leaves anything there**, naming each entry, because it is built with `leavesNoTemp`: a spec removes
every temp directory it creates, in an `afterAll` over a file-level `roots` array, so a bare `bun test` leaves none either.

---

## 7. Testing Namespace Utilities (`@y-core/forge/testing`)

The `testing` namespace ships the fixtures every consumer suite would otherwise hand-roll. **Import them from the barrel** — consumer test code sits
outside the source tree, so the concrete-file rule in [`TESTING.md`][testing-2c] §2c does not apply. §7f and §7i are the stated exceptions, and
each is a published subpath of its own rather than a file reached past a barrel. `src/testing/README.md` teaches the fixtures by the task each
one serves.

### 7a. Declared Integration Edge — testing Imports app and render/jsx

`testing` is an integration namespace ([`NAMESPACES.md`][namespaces-4b] §4b). A test-only namespace reaching into `app` and `render/jsx` is the
**declared, acceptable** edge — these utilities exist precisely to drive the app and render pipelines. **This is the one place forge source may
depend on the private `render/jsx` render helper**, re-exported as `render()` (§7c).

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

`fakeD1` both controls results and records the queries issued: a caller-supplied responder drives the returned rows, and every prepared-and-bound
statement is recorded, so one fake serves the arrange and the assert. `fakeR2` mirrors `fakeKV` over `R2BucketLike`, honouring `delimiter` and
`include` on `list`, with a deterministic content-hash etag — deterministic because a random etag would make a conditional-request assertion
unwritable.

### 7c. render() — SSR Render-to-String

`render` wraps the private `render/jsx` `renderToString` runtime and returns a plain string, so the render-once / assert-once convention (§3c) is
a single call.

### 7d. buildRequest() — Request Builder

**Supply exactly one body helper** — `formData`, `json`, or `body`. Two would silently pick one.

### 7e. mapHandler() and TestAction — Single-Route Registrar

`mapHandler`'s `action` is a `TestAction` — the same bare-handler or `{ middleware, handler }` shape a real controller accepts, so a test never
exercises a registration shape production cannot express.

**Use `mapHandler` for a namespace's own unit tests; use a full `route()` / `createController` map (§5a) when the test must exercise the production
registration path itself.**

### 7f. Subpaths That Are Not on the Barrel

`@y-core/forge/testing/snapshot` publishes `matchTextSnapshot` (§7h), and it is **a stated exception to §7's opening line.** Import it by its own
subpath; it is not re-exported from `src/testing/mod.ts` and will not be.

**The reason is what `snapshot.ts` reads.** It imports `node:fs` and `node:path`. A Worker-side test program compiles under `"types": []`
against the Workers and DOM lib set, and neither module exists there — putting the symbol on the barrel would make every
`import … from "@y-core/forge/testing"` in a Worker-typed suite pull a module its own program cannot type. Off the barrel, the only way to
reach it is to ask for it by name, which is a decision the importing file makes visibly. `checkExports` supports this directly: a non-`mod.ts`
export target its barrel never re-exports from is left out of that barrel's `@public` coverage walk, so "published but off the barrel" is a shape
the gate holds rather than one it tolerates.

**A suite that imports `@y-core/forge/testing/snapshot`, `/d1` or `/harness` references the shim, and then needs no `exclude`.**
`@y-core/forge/testing/node` is a types-only subpath declaring the node surface those three reach. One line at the top of the file that imports
one:

```ts
/// <reference types="@y-core/forge/testing/node" />
```

**The reference reaches the whole program, not the one file.** The shim declares no globals, but its `node:*` modules resolve for every file
the program includes, so a Worker file compiled alongside a referencing suite can import `node:os` and typecheck. Keep Worker code in a program
that no referencing file joins. Dropping the file from `include`, or adding `node` to `types`, is not the supported way. A consumer's `tests/` is
the node program, Playwright specs included ([`CONFIG_BASELINE.md`][cb-1] §1). Forge holds both halves in `tests/fixtures/workers-consumer/`:
`tsconfig.json` compiles the Worker files with no shim (`typecheck:workers-consumer`), and `tsconfig.node.json` compiles the snapshot, d1 and
harness suites against it (`typecheck:workers-consumer-node`), both under `"types": []`.

**`@y-core/forge/testing/harness` is off the barrel for the same reason.** `src/testing/harness.ts` imports `wrangler` and `node:path`, and
`serveWorker` (§1f) runs only under node.

**`@y-core/forge/testing/d1` is off the barrel for the same reason as the harness.** `openTestD1` imports `wrangler` and `node:fs`, starts
wrangler's local D1 through `getPlatformProxy`, and is bundled to `d1.mjs` for node like `./testing/harness`. `getPlatformProxy` does answer under
`bun test`, but a spec that starts it stays in the workerd set (§1f), because workerd is the prerequisite that set is held back on. Its co-located
`d1.test.ts` covers the pure helpers and the refusals that come before a process starts; `tests/workerd/test-d1.workerd.ts` covers the engine.
Forge's own workerd specs open D1 through its `openPlatformD1` (`tests/workerd/d1.ts`). It re-exports `sql`, so a node spec builds the fragment
`explainPlan` takes without importing `storage/db`, which ships as TypeScript. Its default path loads the app's host config, so that file imports
forge only from `@y-core/forge/tooling/db/host` ([declaring what forge reads][db-host-config]).

**What makes any of these files legal is that no deployed code can reach it, not an exemption from "Web APIs only".** There is no gate step that
checks for a non-Web API — the rule is prose in `CLAUDE.md`, and the only thing enforcing it is that a runtime source file typechecks under the
Workers lib set, where `node:fs` does not resolve. `src/testing` stays out of a Worker by reachability instead: it is one of `devBoundaryStep`'s
`devOnlyDirs`, so no deployed file may import it, and `importBoundaryStep`'s `guarded` pointedly leaves it out. A new file that wants Node earns it
the same way or not at all — the question to answer is whether anything shipped can reach it, and "it is only used in tests" is not that answer
unless a boundary step says so.

### 7g. elementOf() and the Markup Readers — One Element of a Whole Page

A page served through `app.request` cannot be asserted with one `toBe`: it is long, and its nonce differs per render. **§3b does not relax for
that** — `elementOf` cuts one element out of the page and the exact assertion is made on it. The readers are published so a consumer's seam suite
and forge's own component specs (§3c) reach the same shape rather than a private copy per file. A reader answers `""` or an empty record for an
element the page never rendered, so the `toBe` against the expected markup is what makes an absent element a failure. Usage is
`src/testing/README.md`'s.

### 7h. matchTextSnapshot() — Text Against a Committed Fixture

`matchTextSnapshot` compares text against a committed fixture on disk, and is reached off the barrel (§7f).

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
sliced to its own length so the shorter pads with `null`. That is O(n), and it reads an insertion correctly, where a raw
positional compare would report every following line as changed. The residual case — an insertion adjacent to a change, which pairs and reads as a
rewrite — is disclosed by the report's header carrying both files' line counts. Every rendered line is quoted, because a trailing space, a tab for
spaces and a stray `\r` are what "files differ" is most useless about; the comparison itself is byte-exact and happens before any of that.

`diff` carries every differing line and `report` is capped at `limit`, so a caller inspecting the data programmatically never fights the renderer.

### 7i. The Expected Coverage Set — `@y-core/forge/testing/coverage`

`@y-core/forge/testing/coverage` publishes `COVERAGE_COMPONENTS`, every component the UI component barrels export
(`src/testing/coverage/components.ts` names them). A consumer's catalog test compares its own coverage manifest against it, so a component forge
adds fails that test until it is demonstrated, rather than passing because nobody listed it.

**It is off the `./testing` barrel because of what it loads.** Reading the set means importing each of those barrels, and a suite that wants only
a fake store should not pay for the whole component library. It needs no node module, so a Worker-typed suite imports it directly.

**The set is read off the barrels, never listed.** A component is a capitalised function a barrel exports; constants and helpers beside it are
not. `key` is `barrel/component`, the spelling a coverage manifest's own keys use, because `Input` names a component in both `core` and
`controls`. The array and each entry are frozen and ordered by `key`, so a failure names the same component first on every run.

[cb-1]: ../warden/canon/apps/CONFIG_BASELINE.md#1-the-tsconfig-flag-set
[cr-1a]: ../warden/canon/libs/CODE_REVIEW.md#1a-pre-review-preparation
[db-host-config]: ../src/tooling/db/README.md#declaring-what-forge-reads
[errors-1a]: ./FORGE_ERRORS.md#1a-the-unified-result-primitive-okerr-result-and-toerror
[htmx-7]: ./HTMX.md#7-trust-posture--selectors-and-json-values-must-be-developer-supplied
[namespaces-3c]: NAMESPACES.md#3c-a-surface-node-loads-is-published-prebuilt
[namespaces-4b]: ./NAMESPACES.md#4b-integration-namespace-rules
[nd-1c]: ../warden/canon/libs/NAMESPACE_DESIGN.md#1c-what-the-export-gate-proves
[pdf-readme]: ../src/render/pdf/README.md
[sb-1g]: ./STORAGE_BINDINGS.md#1g-transactions--batch-is-the-boundary
[sb-2c]: ./STORAGE_BINDINGS.md#2c-kvstore-operations
[sot-2a]: ./SOURCE_OF_TRUTH.md#2a-package-and-configuration-facts
[sot-2b]: ./SOURCE_OF_TRUTH.md#2b-enforced-rules
[testing-1a]: ../warden/canon/libs/TESTING.md#1a-runner-primitives
[testing-1b]: ../warden/canon/libs/TESTING.md#1b-no-runtime-specific-type-package
[testing-1c]: ../warden/canon/libs/TESTING.md#1c-the-browser-set
[testing-2]: ../warden/canon/libs/TESTING.md#2-co-located-test-files
[testing-2c]: ../warden/canon/libs/TESTING.md#2c-import-concrete-files-in-tests
[testing-3a]: ../warden/canon/libs/TESTING.md#3a-assert-the-escaped-form
[testing-3b]: ../warden/canon/libs/TESTING.md#3b-exact-match--never-substring-matching
[testing-3c]: ../warden/canon/libs/TESTING.md#3c-render-once-assert-once
[testing-3d]: ../warden/canon/libs/TESTING.md#3d-assert-the-mechanism-not-an-outcome-a-second-mechanism-also-guarantees
[testing-4]: ../warden/canon/libs/TESTING.md#4-fakes-over-mocks
[testing-4a]: ../warden/canon/libs/TESTING.md#4a-fake-pattern--implement-the-interface
[testing-5a]: ../warden/canon/libs/TESTING.md#5a-both-pass-and-fail-cases-required
[testing-5b]: ../warden/canon/libs/TESTING.md#5b-negative-case-structure
[testing-5c]: ../warden/canon/libs/TESTING.md#5c-no-mocking-of-security-primitives
[testing-6]: ../warden/canon/libs/TESTING.md#6-the-verification-gate
[testing-6c]: ../warden/canon/libs/TESTING.md#6c-the-lines-between-the-tiers
[testing-apps-6e]: ../warden/canon/apps/TESTING.md#6e-one-tier-per-moment
