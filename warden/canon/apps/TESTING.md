---
title: Testing Discipline
description: "The app-request pattern, environment fixtures, exact-match assertions and entity encoding, fakes over mocks, fail-closed expectations, and the gate."
---

# Testing Discipline

> Owns how an application is tested: driving the composition root through its own request entry, the environment fixture, the assertion rules, the
> security cases every guarded route needs, and the verification gate.
>
> Defers to: [`BOUNDARIES.md`][boundaries-2d] §2d for the status each refusal returns; [`APP_ARCHITECTURE.md`][aa-1] §1 for the composition root
> under test; [`CODE_RULES.md`][cr-5d] §5d for the comment budget inside tests.

---

## 0. Quick Reference

- §1 The App-Request Pattern: driving the real app without a network
- §1a Why the Composition Root Is the Subject: what a hand-wired handler cannot prove
- §1b The Request Entry Point: path, init, environment
- §1c What Is Still a Unit Test: pure functions and schemas
- §2 Test Placement and the Environment Fixture: where tests live and what they inject
- §2a Test Placement Is a Repository Decision, Stated Once: and why
- §2b The Browser-Spec Suffix Is `*.browser.ts`: fleet-wide, and what it stops colliding with
- §2c The Minimum Environment Fixture: the smallest env that boots the app
- §2d Optional Bindings Are Deliberately Absent: proving graceful degradation
- §2e A Configuration File Gets No Test: a test over one restates the file back to itself
- §3 Assertion Rules: exactness, and what nondeterminism is allowed to change
- §3a Exact Match — Never Substring Matching on Markup: the rule
- §3b Nondeterministic Output: normalise, then assert exactly
- §3c The Entity Encoding Map: character to entity
- §3d Headers and Status Are Always Exact: no range assertions
- §3e Assert the Contract, Not the Implementation Restated: the deletion check, and the copied-literal ban
- §3f A Deleted Claim Lands in a Test: the receiving end of the comment budget
- §4 Fakes Over Mocks: implement the interface, add no libraries
- §4a Fake Pattern — Implement the Interface: compile-time drift detection
- §4b Stubbing an Outbound Call: the network seam, not the service
- §5 Security and Fail-Closed Expectations: both directions, every guard
- §5a Both Pass and Fail Cases Required: the requirement matrix
- §5b One Test Per Rejection Path: never one test for the whole guard stack
- §5c Negative Case Structure: assert status and body
- §5d No 200 on Guard Failure: never adjust the assertion to match
- §5e No Mocking of Security Primitives: a testability signal, not a mocking one
- §6 The Verification Gate: what must pass before a task closes, and before an epic does
- §6a One Command, Nested Tiers: what a step needs, the heavy step, what an absent prerequisite means, and how a table nests its tiers
- §6b What Each Tool Catches: the failure classes
- §6c A Scoped Run Is Not a Gate Run: why a narrowed selection brands itself, and where a runtime row's reach comes from
- §6d Local Ports Are Slots, and a Slot Is a Port and a Bind Address: what each half is, and who overrides which
- §6e One Tier per Moment: which tier each moment takes, why `verify:scheduled` is never an agent's, a browser spec by judgement, and the cron
  run

---

## 1. The App-Request Pattern

### 1a. Why the Composition Root Is the Subject

**A handler test that wires the handler by hand proves the handler works and proves nothing about the chain** — and the chain is where guards,
headers, and context live ([`BOUNDARIES.md`][boundaries-2] §2).

The default subject is therefore the **composition root**: the real app, with its real middleware registration and its real route map. A test that
would still pass with every guard removed is not testing the route.

### 1b. The Request Entry Point

The app exposes a request entry that bypasses the network entirely and drives the Worker directly — no dev server required. It takes a path, a
request init, and an **environment object**, so bindings and secrets are under test control.

```ts
import app from "../src/worker";

it("returns 200", async () => {
  const res = await app.request("/", {}, MINIMUM_ENV);
  expect(res.status).toBe(200);
});
```

**The environment is an argument, not a global.** That is what makes a missing-binding case testable at all, and it is why §2c's fixture is a value
rather than an ambient setup step.

### 1c. What Is Still a Unit Test

**Pure functions, schemas, and formatters are tested directly, never routed through the app** — the request adds nothing but a slower failure
message.

The dividing question: _does the behaviour depend on the middleware chain, the route map, or the environment?_ If no, test the function.

---

## 2. Test Placement and the Environment Fixture

### 2a. Test Placement Is a Repository Decision, Stated Once

**Whether tests sit beside their source or in a dedicated directory is a per-repository choice, recorded in that repository's `docs/` docs, and it
is not re-argued per file.**

**The choice is uniform and stated**: a repository with tests both co-located and in a test directory has neither convention, and a reader cannot
tell whether a missing neighbour means missing coverage.

Where the choice is a dedicated directory, the reason is usually that tests are grouped by the _question they answer_ — unit, integration,
end-to-end — rather than by the file they cover. That is a legitimate taxonomy, and it is the one thing co-location cannot express.

**Whichever directory the repository chooses, a test file's name matches the name of the source file it covers** — `headers.ts` is tested by
`headers.test.ts`, wherever that file sits. Grouping by question governs _placement_, not names: a test named after its question leaves the source
file with no test findable from its own name.

**Where a repository does dedicate a directory to the browser set, it is named `browser/`** — the same word as the `test:browser` verb that runs it,
so the directory and the command a reader types are one name. That is a naming rule for a directory that exists, not a requirement to grow one.

### 2b. The Browser-Spec Suffix Is `*.browser.ts`

**A browser spec is named `*.browser.ts`, and this is fleet-wide rather than a repository's choice.** The unit runner collects `*.test.*`,
`*_test.*`, `*.spec.*` and `*_spec.*` — never `*.browser.ts`. A browser spec named `.spec.ts` is therefore collected by a bare unit run, which
cannot execute it; `.browser.ts` makes that collision impossible by construction rather than avoided by hand-scoping the gate's test paths.

**A repository never narrows the preset's `tests` option to dodge the unit collector**; narrowing it for a deliberate tier split — a set whose
every spec starts a real runtime, held to its own step — stays legitimate, and those specs keep `.test.ts` because their own runner collects them.

The suffix also makes a helper safe to keep beside the specs it serves: a driver or a fixture module under the browser directory is collected by
neither runner, where the same file beside a `.spec.ts` would be.

### 2c. The Minimum Environment Fixture

**Define one shared fixture holding the smallest environment that boots the app**, and derive every variant from it by spreading and overriding.

```ts
const MINIMUM_ENV = {
  ASSETS: { fetch: async () => new Response("", { status: 200 }) },
  SITE_ORIGIN: "https://example.com",
  CSRF_SECRET: "…64 hex characters…",
};
```

These properties make it useful rather than ceremonial:

- **Every value is obviously a test value.** A secret that looks like a real secret will eventually be treated as one ([`CODE_REVIEW.md`][cr-3c]
  §3c).
- **A field is present only because its absence breaks the boot.** A fixture that lists every binding the app has ever had stops telling a reader
  what is required.

**The fixture's required fields are documented in `docs/`** with what each one must satisfy — a key length, a URL scheme — because a wrong value
produces a confusing failure rather than a clear one.

### 2d. Optional Bindings Are Deliberately Absent

**Bindings the application degrades gracefully without are left out of the minimum fixture on purpose** — a log store resolved with
`required: false`, say. Their absence is what proves the degradation path works ([`BOUNDARIES.md`][boundaries-5b] §5b).

A rate limiter is not one of them: outside `forge cf dev` its absence answers `503`, so leaving it out asserts the refusal rather than a
degradation ([`WORKERS_PLATFORM.md`][wp-3b] §3b).

Add such a binding only in the test that exercises it, never to the shared fixture, where it silently deletes the coverage.

### 2e. A Configuration File Gets No Test

**A config names values; it has no logic to exercise**, so a test over it can only restate the file back to itself and fail whenever the config
legitimately changes.

Where such a test looks like it proves something, the property belongs to the code that _reads_ the config, and the fix is to enforce it there. A
route map is the usual case: the assertion worth writing is that requesting each declared path reaches a handler, not that the literal array still
holds the strings someone typed into it (§3e).

---

## 3. Assertion Rules

### 3a. Exact Match — Never Substring Matching on Markup

```ts
// BAD — passes even when the entity encoding is wrong
expect(html).toContain("O'Brien");

// GOOD — catches encoding exactly
expect(html).toBe("<td>O&#39;Brien &amp; Associates</td>");
```

**An assertion string too long to write is shortened by extracting the relevant element and asserting exactly on that, never by switching to a
substring match.** Substring matching stays legitimate on non-markup strings — an error message, a log line, a query fragment.

### 3b. Nondeterministic Output

A full page contains per-request values — a CSP nonce, a CSRF token, a generated id — so a whole-document exact assertion would break on every run.
**The answer is to remove the nondeterminism, not to weaken the assertion.**

The accepted shapes, in order of preference:

1. **Normalise, then assert exactly.** Replace each nondeterministic token with a fixed placeholder, then assert the whole document with one exact
   comparison. This keeps every surrounding character under test, including the encoding.
2. **Extract the deterministic element and assert exactly on it.** Where normalisation would be more machinery than the test is worth, assert the
   exact markup of the element under test rather than the page.

**Assert the nondeterministic value's _shape_ separately** — that a nonce is present, non-empty, and different across two requests. A test that
skips this proves the placeholder was substituted and nothing about the value.

### 3c. The Entity Encoding Map

A correct renderer escapes **every** string child, static and interpolated alike. Assert the escaped forms:

| Character | Escaped form |
| --- | --- |
| `'` (apostrophe) | `&#39;` |
| `&` (ampersand) | `&amp;` |
| `<` (less-than) | `&lt;` |
| `>` (greater-than) | `&gt;` |
| `"` in attributes | `&#34;` or `&quot;` |

**Never assert a raw `&`, `<`, `>`, `'` or `"` on the strength of a literal having been written that way in the source.** A URL-bearing
attribute goes through a sanitizer, so a hostile scheme renders as a safe placeholder — assert the sanitized form.

### 3d. Headers and Status Are Always Exact

<!-- rule:apps-testing-exact-header-status --> Security headers are deterministic strings and HTTP status is an integer constant.

```ts
expect(res.headers.get("x-content-type-options")).toBe("nosniff");
expect(res.status).toBe(403);
```

A range assertion on a status passes for `403` when the test meant `422`, which is precisely the distinction [`BOUNDARIES.md`][boundaries-2d] §2d
exists to keep.

### 3e. Assert the Contract, Not the Implementation Restated

**Both checks are applied before a test is counted as written, and each catches what the other misses.**

**The deletion check: delete the mechanism the test names; a test that still passes was never testing it.** Such a test
reads an _outcome_ that a second, independent mechanism also produces — usually a guard clause, whose early return makes "nothing visibly happened"
true whether or not its caller was ever there. **Pin the mechanism, and pin that it was armed**: "the timer never fired" is worth nothing without "a
timer was scheduled", cheapest as one assertion. A negative assertion over an optional path — `expect(probe?.[0]).not.toBe("x")` — passes when
`probe` is absent outright, so it asserts nothing.

**The copied-literal check: a literal copied from the source under test is not an expected value.** The deletion check cannot reach it: a
transcription goes red when the source changes, yet only records that two files agree, a fact about the repository rather than the software. Common
shapes:

- **A transcribed constant map.** A frozen array or lookup table asserted back entry by entry. Test what _reads_ the table: the behaviour its
  entries were chosen to produce.
- **A registration list.** The middleware roster or command list copied in as an array of names. Assert dispatch instead — drive a request through
  the real stack and pin which mount got which guard, which status the refusal returned, what the command wrote; an _identity_, not a spelling, is
  what stops two copies of a name drifting apart.
- **A class string hoisted out of a recipe.** A style literal lifted from the source, or out of rendered output, and reassembled in the expected
  value. A token rename then fails the test while changing nothing a reader can see, and a stylesheet carrying no rule for that class fails nothing
  at all.

**The operational test: if this test and the source under test were edited together by the same rename, would anything go red?** If no, the test
pins agreement between two files, not behaviour.

This does not weaken §3a: the exact markup a view emitted, written out whole where a reader can see the entity encoding, **is** the contract.
§3e refuses the derived form — a class constant imported or transcribed from the source and recomposed into the expectation, so both sides move
together.

**An expected value has to come from somewhere other than the source.** In descending order of strength:

- **A published standard's test vectors.** Literals from a standards body make transcription structurally impossible.
- **A table generated from the domain rule** — every shape a discriminator can produce, enumerated from the rule rather than from the branches.
- **A real dependency's own answer** — a query plan from a real database over real migrations, a DOM state after a real event in a real browser.
- **The observable outcome of a request**, asserted whole: status, body, and headers, per §3a and §3d.

**Where a constant genuinely is the contract, write it as a literal rather than importing it.** Read back out of the module under test, it cannot
fail when the value changes. The reverse holds for a value the repository does not own: a
cap or a limit defined by the shared library is imported, so a library change surfaces as a failure here rather than as silent disagreement.

**Negative space is evidence.** A refusal that asserts status and body _and_ that nothing downstream ran — no statement issued, no row written, no
outbound call made — pins what the refusal cost, which no restatement of the guard's own constants can.

### 3f. A Deleted Claim Lands in a Test

**A claim removed from a comment is not removed from the system until an assertion holds it.** `CODE_RULES.md` §5e is this rule seen from the source
side: a comment asserting behaviour is prose standing in for a test, and the fix is the test. This section is the receiving end.

A change that deletes such a comment carries scoped work here:

- **The claim names the assertion.** "Redirects to the login route when the session cookie is absent" is already a test name and an expectation; it
  does not need to be redesigned, only written.
- **Check first whether it is already pinned.** Frequently it is, and the comment was a second, unexecuted copy — a restatement, not a missing test.
  Deleting it then costs nothing and adds nothing.
- **Where it is not pinned, the test is part of the change.** Not a follow-up, not a ledger task: the claim was load-bearing enough to be written
  down once, and the change is not done while the system has lost it and gained nothing.

§3e applies to the test that results. A claim rewritten as an assertion that reads an outcome a second mechanism also produces, or as a literal
copied back out of the source, has not landed — it has been restated in a new syntax.

---

## 4. Fakes Over Mocks

### 4a. Fake Pattern — Implement the Interface

A fake is a minimal in-test implementation of a real interface, written as a plain object literal typed to that interface. **TypeScript enforces
that every member is present**, so interface drift breaks the test at compile time — which is the whole of the argument for fakes over mocks.

<!-- rule:apps-testing-no-mock-library --> They detect no API change, couple the test to call order and argument matchers, and pass happily against
a stale signature.

**Prefer the shared library's fixtures over hand-rolled ones** — in-memory storage fakes, a render helper, a request builder. A fake every suite
writes for itself is a fake that drifts per suite ([`FORGE_CONSUMPTION.md`][fc-1b] §1b).

### 4b. Stubbing an Outbound Call

**Stub at the network seam, not at the service.** Replacing the global fetch for the duration of a test keeps the service's own logic — its request
shaping, its error mapping, its `Result` construction — under test. Replacing the service deletes exactly the code the test was for.

The exception is a **handler** test, where the service is legitimately a collaborator: inject a fake service and assert the handler's branch on each
outcome.

---

## 5. Security and Fail-Closed Expectations

### 5a. Both Pass and Fail Cases Required

**Security-sensitive code requires both a positive case — the guard allows a valid request — and a negative case — the guard blocks an invalid
one.** A happy-path-only suite is not merged.

| Feature | Required positive case | Required negative case |
| --- | --- | --- |
| CSRF protection | Valid token → 200 | Missing or invalid token → 403 |
| Origin check | Same-origin → proceeds | Cross-origin → 403 |
| Expected client hints | Present → proceeds | Absent → 403 |
| Rate limiting | Under limit → 200 | Over limit → 429 |
| Input validation | Valid input → renders values | Invalid input → renders field errors |
| Content type | Expected type → proceeds | Wrong or missing → 415 |
| Body size | Under cap → proceeds | Over cap → 413 |

**Keep a row-to-test coverage map in `docs/`**, naming which suite covers each row. A matrix nobody has mapped to real files is a checklist, not
coverage.

### 5b. One Test Per Rejection Path

**Write a separate case for each way a request can be refused**, not one case that omits everything at once.

A single "invalid request" test passes as soon as _any_ guard fires, so it stays green after the guard it was written for is deleted — the deletion
check ([`CODE_REVIEW.md`][cr-3c] §3c) fails it. Each case is valid in every respect except the one it tests.

### 5c. Negative Case Structure

**The negative case asserts the exact status AND a meaningful body fragment** — not the status alone. That proves the error path _renders_, rather
than merely that the request exited early.

**"Body is non-empty" is a code smell.** An assertion that the body is not the empty string asserts nothing. Reserve loose checks for genuinely
runtime-dependent values.

### 5d. No 200 on Guard Failure

**If a test expects a guard to fire and the response is 200, the guard has a hole.** Treat an unexpected 200 from a guarded route as a defect
requiring root-cause investigation.

**Never adjust the assertion to match the observed status** — that turns a security regression into documented behaviour.

### 5e. No Mocking of Security Primitives

**Do not mock a security primitive to make a test pass.** Test the real implementation against a fake binding — mint a real token with the same
utility the app uses, and let the real verifier check it.

If the real implementation is too hard to invoke from a test, that is a **testability signal — refactor to accept injectable dependencies**, not a
licence to mock. A mocked guard is a test that passes when the guard is deleted.

---

## 6. The Verification Gate

### 6a. One Command, Nested Tiers

**There is one gate command, and its tiers — `static`, `unit`, `runtime` and `scheduled` — are selected with `--tier`, not commands.** They are
nested: `static ⊆ unit ⊆ runtime ⊆ scheduled`. **A bare invocation is `runtime`**, the gate an epic closes on; §6e says which tier each other
moment takes. The step table is owned by its config file; read it there, not from a prose copy.

**A task is complete only when every step the run executed passes with zero errors**; "types pass, lint has one warning" is a failure.

**A tier names what a step needs, so a step's tier is predictable from the step alone:**

| Tier | A step belongs here when it |
| --- | --- |
| `static` | judges the source and runs nothing |
| `unit` | runs code in the test process, with nothing installed but the application's dependencies |
| `runtime` | needs workerd or a local database, and runs only when the pending changes reach it |
| `scheduled` | is heavy, or judges a finished change — the deployed bundle; every row at this tier runs whole. An empty changelog entry is the release command's refusal, not a row |

**A heavy step goes to `scheduled`, and that is the one line cost draws.** A step is heavy when any of these holds:

- it starts a browser, or runs any suite under Playwright — a Worker-runtime suite on Playwright included;
- it runs a Worker-runtime suite on every change, with nothing declaring which changes reach it;
- it is a soak, a live-network or a deep property run;
- its test set takes more than 60 seconds, or one test in it more than 10.

That budget is stated here and nowhere else. **A step that is not heavy stays where what it needs puts it**, however slow it feels, because a tier
whose membership follows taste is a tier nobody can predict.

<!-- rule:apps-testing-split-not-dropped --> The `unit` row's sources leave it out — the deliberate tier split §2b allows — and a `testStep`
with its own label and sources runs it.

**The price is stated rather than hidden: a break in a heavy step is found by the next daily cron run or the next tag, not by the epic gate.** A
step worth proving only periodically — another browser engine — goes in the `scheduled` tier of `config/steps.config.ts`, which a tag and the cron
both run (§6e).

**Every application declares `verify:scheduled`.** The cron runs it, so an application without it is outside the cron, and that is a gap rather
than a choice (`CONFIG_BASELINE.md` §4).

**An absent prerequisite is a skip below `runtime` and a failure from `runtime` up**, because those tiers promise that a runtime ran, and an epic
may not be closed on a step nobody ran.

**The tier is part of the verdict**, since the tiers are different assurances — and so is a skipped step: a green that skipped one is not the green
that ran it.

**A table declares each tier as its own list, in run order, and each tier above `static` leads with a reference to the tier below**, by
convention — which makes a fail-fast `scheduled` run fail on the sub-second check rather than after minutes of browser. A row moves tier by moving
its entry, never by declaring it twice. `resolveTiers`'s TSDoc owns the expansion, the run of an undeclared tier as the nearest declared one below,
and the refusals; the verdict names a fallback — `verify (as unit)` — so a table never spells one as a tier that only references the one below.
A malformed table is refused whole, whichever tier the run asked for. Below `scheduled`, a row is left untouched only in the tier that declares it
directly; one reached through a reference runs whole, because the declaring tier made no claim about which changes reach it.

### 6b. What Each Tool Catches

| Tool | Catches |
| --- | --- |
| The type checker | Type errors, wrong argument types, missing properties |
| The linter | Style violations and banned patterns |
| The test runner | Functional regressions across routes and services |
| The asset build | Markup referencing an asset the pipeline does not produce |

**Fix type failures first** — they cascade into misleading lint and test failures. The step table encodes this by ordering the type check first, so
a fail-fast run stops there without being told to.

### 6c. A Scoped Run Is Not a Gate Run

`Selection`'s `scoped` flag owns the brand a narrowed run puts on every summary line, so a scoped green never reads as a green gate. **A selection
resolving to zero steps is refused**: a gate that ran nothing must never pass for one that passed.

**Leaving a row untouched at `runtime` is not a scoped selection.** It is the tier's own definition (§6a), fixed by the tree and the commit it sits
on, so its green is a gate green. What it ran depends on that commit, so its receipt records it, and a `runtime` receipt answers a reuse only at the
same commit.

**A runtime row's reach is derived wherever a graph can derive it**: the row runs whole when a change touches the gate's own inputs, a path the row
reads or one it traces at run time, and when its trace fails, and runs nothing otherwise. The only hand-kept list names what no graph can see — a
file a spec reads without importing it, a specifier resolved at run time — and a glob in it matching nothing is refused rather than silently
dropping the row. **`scheduled` runs every row whole on every tag and every cron run**, the backstop for a reach the derivation missed; a row that
declares nothing it reads runs whole on every change.

**A Playwright row has no reach to derive**: the browser set and the Worker-runtime suite both start at `scheduled`, where every row runs whole
(§6a).

**A run that executes no step is not refused when it cannot pass for a gate that ran.** A reuse run's verdict names the recorded run it stands on
and the tree hash that run judged, so its green is that run's green, carried only to bytes it covered. An `--affected` run whose changes touch no
step says so, exits 0 and carries the scoped brand, so it is never a green gate.

### 6d. Local Ports Are Slots, and a Slot Is a Port and a Bind Address

**Each slot declares both halves:**

| Slot | Port | Bind address | Used by |
| --- | --- | --- | --- |
| The application's dev server | 8787 | `0.0.0.0` | `bun run dev`, and anything reaching it across the container network |
| The browser set | 8788 | `127.0.0.1` | `test:browser`, and the `dev:browser` script that attaches to it |
| Ad-hoc observation | 8789 | `127.0.0.1` | Reserved, not required — a repository claims it only when it has a use |

**The bind address is load-bearing, not decoration.** `0.0.0.0` is what makes 8787 reachable from another container, which is what turns a browser
set bound there from an annoyance into a hazard: the run does not merely collide with the dev server, it **answers as it** — driving the real
application, against the real bindings, and writing into the database the next run wipes.

<!-- rule:apps-testing-origin-spelling --> An application's allowed-origin check compares strings, so `https://localhost:8788` is not
`https://127.0.0.1:8788` and a browser run on the wrong spelling fails its own origin guard for a reason that has nothing to do with the code under
test.

<!-- rule:apps-testing-port-in-runner --> The port a harness listens on is a property of the harness; moving the number the application declares
moves the application.

**A fixed port is for a server a human starts or attaches to.**

<!-- rule:apps-testing-ephemeral-port --> The `listen()` of wrangler's `createTestHarness` takes a free port from the OS, which is why a per-run set
has no port problem to solve. A fixed 8788 still collides when two repositories' browser sets run at once; an environment-variable override covers
that in one line.

**`reuseExistingServer` is `false`.** The dev command builds the stylesheet as it boots, so a reused server serves the CSS the source had at boot
time — a run against edited views then measures the previous layout and reports it as current. A repository that cannot make `false` work records
the exception with its compensating control.

### 6e. One Tier per Moment

**Each moment takes one whole tier of the same gate** (`AGENT_WORKFLOW.md` §4):

| Moment | Command | Runs |
| --- | --- | --- |
| Interim, while writing | `bun run verify:static`, as often as it helps | every row that judges the source; it closes nothing |
| Task close, before review | `bun run verify:unit` | every static row, and the unit and seam sets whole |
| Epic close | `bun run verify`, by the verification runner | the unit tier, plus every runtime row the pending changes touch; no Playwright spec |
| Tag | `bun run verify:scheduled`, run by `forge release` before it tags | every runtime row whole, every browser spec on Chromium and on each other engine the table declares, the Worker-runtime suite, every heavy row, and the rows that judge a finished change; the remote CI then runs `verify:unit` on the tag |
| Daily cron | `bun run verify:scheduled`, run by the ledger host | the tag's run, over the default branch as committed |

No other moment exists to close on.

**`verify:scheduled` belongs to the tag and the cron, never to an agent**, who neither runs it, plans it into a task nor reports it as owed:
`forge release` runs it on a release the user asked for, the ledger host runs it daily, and a break either finds reaches the ledger as a task.

**The browser set starts at `scheduled`, because a step that starts a browser is heavy (§6a).** Narrowing it at `runtime` bought almost nothing:
its reach was the Worker's whole import graph plus the asset build's inputs, so nearly every source edit ran it whole. A tag never ships without
the set. **Between them, a browser spec is the developing agent's call**: one spec on one engine — `bun run test:browser -- <spec>` — where a UI
change needs confirming, never the whole set or a routine run, since the schedule runs the set whole; it is a scoped run, never a task check or a
gate green (§6c).

**The cron run is the ledger host's, and its verdict lands in the ledger rather than in anyone's terminal.** It gates a fresh checkout of the
default branch, never a developer's work tree, and asks the gate for a structured report beside its logs. A failing step or spec becomes one open
task in the project it ran for, rewritten in place by each later failure; a run that never reached a test — the server it needs did not come up —
is logged and filed as nothing, since it says nothing about the code.

**Chromium is the browser set's engine, and `browser: true` emits its row, `test:browser`.** An application that needs wider compatibility merges
`crossEngineStep()` into its `scheduled` tier. A tag and the cron run then each take Firefox and WebKit, and each needs the second Playwright
server below, because an absent server fails a `scheduled` run (§6a).

**Firefox and WebKit run on a second Playwright server, started only on request, whose endpoint `PLAYWRIGHT_COMPAT_WS_ENDPOINT` names.** The test
runner reads only the primary server's variable, so the application's `playwright.config.ts` points its `firefox` and `webkit` projects at the
second through `use.connectOptions`, which replaces the environment's connection whole, and declares them only when the variable is set.

**An application that opts into Firefox and WebKit runs every spec on them; it tags no cross-engine subset.** An engine difference found there is
fixed, or skipped as the first line of the case with `test.skip(browserName === "…", "<task-id>: <symptom on this engine>")`, the task filed before
the skip is written. A spec that needs a Chromium-only Playwright capability — the CDP virtual WebAuthn authenticator has no Firefox or WebKit
equivalent — is skipped on the other two the same way.

<!-- rule:apps-testing-no-retries --> A retry turns an intermittent failure into a green.

**A browser run never takes more workers than its Playwright server's client limit.** The worker count defaults to the client limit, read from the
environment, because a worker past it only queues; a set whose specs share one database across workers sets `1` and says why.

[aa-1]: ./APP_ARCHITECTURE.md#1-the-composition-root
[boundaries-2]: ./BOUNDARIES.md#2-middleware-ordering-and-guard-placement
[boundaries-2d]: ./BOUNDARIES.md#2d-rejection-status-discipline
[boundaries-5b]: ./BOUNDARIES.md#5b-required-false--non-security-features-only
[cr-3c]: ./CODE_REVIEW.md#3c-tier-3--judgement
[cr-5d]: ../shared/CODE_RULES.md#5d-tests-are-not-exempt
[fc-1b]: ./FORGE_CONSUMPTION.md#1b-capability-classes-the-library-owns
[wp-3b]: ./WORKERS_PLATFORM.md#3b-an-absent-limiter-fails-closed
