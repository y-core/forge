---
title: Testing Discipline
description: "Test placement, the exact-match assertion rule, fakes over mocks, security-test requirements, and the one-command verification gate."
---

# Testing Discipline

> Owns test file placement, the assertion rules, the fakes-over-mocks posture, the security-test requirements, and the verification gate. Other
> documents link here rather than restating them.
>
> Defers to: the gate's step-list config for which steps exist; [`BOUNDARIES.md`][boundaries] for the boundaries a security test must exercise;
> [`CODE_RULES.md`][cr-5d] §5d for the comment budget inside tests.

---

## 0. Quick Reference

- §1 Test Runners: the runners, their type stub, and which question each answers
- §1a Runner Primitives: import source and nesting limit
- §1b No Runtime-Specific Type Package: the hard ban and the hand-written stub
- §1c The Browser Set: real Chromium behind its own verb
- §2 Co-Located Test Files: tests live beside their source
- §2a Which Files Get a Test, and the Naming Convention: non-trivial logic, same name, same directory, test suffix
- §2b Excluded From Publish: tests never ship
- §2c Import Concrete Files in Tests: never through the barrel
- §3 Assertion Rules: exactness, and what an assertion is allowed to prove
- §3a Assert the Escaped Form: the rule, and the two documented bypasses
- §3b Exact Match — Never Substring Matching: why `toContain` is banned on markup
- §3c Render Once, Assert Once: the single enforced shape
- §3d Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees: the deletion check
- §3e Assert the Contract, Not the Implementation Restated: the copied-literal check
- §3f A Deleted Claim Lands in a Test: the receiving end of the comment budget
- §4 Fakes Over Mocks: implement the interface, add no libraries
- §4a Fake Pattern — Implement the Interface: compile-time drift detection
- §4b Why Fakes Over Mocks: the comparison, and the no-mock-library rule
- §5 Security Test Requirements: both directions, always
- §5a Both Pass and Fail Cases Required: the requirement matrix
- §5b Negative Case Structure: assert status and body
- §5c No Mocking of Security Primitives: a testability signal, not a mocking one
- §6 The Verification Gate: what must pass before a task closes, and before an epic does
- §6a One Command, Nested Tiers: which tier each moment runs, why `verify:scheduled` is never an agent's, and the daily cron
- §6b What Each Tool Catches: the failure classes
- §6c The Lines Between the Tiers: what a step needs, the heavy step, the price of running it late, and how a table nests its tiers
- §6d A Scoped Run Is Not a Gate Run: why a narrowed selection brands itself
- §6e What the Runner Promises: the step table, zero errors, an absent prerequisite, the verdict line, and the flags

---

## 1. Test Runners

**There may be more than one runner, and they answer different questions**: a unit runner proves a function's value and the markup the server
emitted, a browser runner proves what a controller does **to a keystroke**, and both are kept.

### 1a. Runner Primitives

<!-- rule:libs-testing-runner-imports --> The runner already has both. A browser driver is the one legitimate external test dependency, because
driving a real browser needs one and there is no in-house equivalent to reach for.

**Keep suite nesting to at most two levels.** Deeper nesting costs more readability than the grouping buys.

### 1b. No Runtime-Specific Type Package

Use a **hand-written declaration stub** for the runner's globals rather than the runtime's published type package. This is a hard requirement:

- Such a package typically overrides a standard global's signature with runtime-specific properties — `fetch` is the usual casualty.
- That override breaks type-checking of Worker code and of test fakes that implement platform interfaces.
- The stub declares exactly the lifecycle, assertion and runtime calls in use, as module declarations, and nothing more. It adds no global, so a
  spec imports the runtime's API from its module by name.

<!-- rule:libs-testing-no-runtime-types --> A change that adds it is rejected, whatever convenience it brings.

<!-- rule:libs-testing-runtime-global-ban --> The lint base holds this even where `nodejs_compat` would supply the first two, because a program that
declares one elsewhere typechecks the reference and the stub cannot stop it. The base refuses each outside build-time trees, and the import too,
since an imported name is a local binding the global ban never reaches; in a spec only the runtime namespace stays banned.

### 1c. The Browser Set

**A browser test runs in a real browser under its own verb**, with its own config owning the discovery pattern, project list, and parallelism.

**The set sits outside `unit` because it needs a browser binary or server an install step provides, and at `scheduled` because a step that
starts a browser is heavy (§6c).** Narrowing it would buy almost nothing, since a spec's reach covers nearly every source file; a broken behaviour
is found by the next daily cron run or tag, not by the epic gate, and a tag never ships without the set.

**Chromium is the set's engine, and another engine is a `scheduled` row of the same table** (§6a, §6c), added when consumers need wider
compatibility. Where the environment serves the other engines from their own server, the browser config routes those projects there, and a
`scheduled` run without that server fails rather than skipping (§6e).

<!-- rule:libs-testing-no-dom-shim --> The two runners never share a process either. A shim defines hundreds of globals, shadows the runtime natives
the suite exercises, and certifies components against a platform model lacking the features they are built on. A separate process isolates by
construction, leaving the platform's own `Request` / `Response` / `fetch` semantics exactly as the runtime ships them — those semantics _are_ the
product.

**What each runner is sufficient evidence for:**

| Claim | Proven by |
| --- | --- |
| the server emitted this exact markup | the unit runner, exact-HTML assertion (§3) |
| a pure function returns this value | the unit runner |
| a controller moves focus, writes an attribute, consumes a key | **the browser set only** |

Neither subsumes the other: a component can behave correctly while emitting markup no stylesheet matches, so a markup change _updates_ the
exact-HTML test rather than replacing it with a behaviour test.

<!-- rule:libs-testing-browser-state --> A browser case builds real markup, dispatches a real event through the browser's own input path, and reads
what resulted; a test that counts calls is testing the test's own fixture.

---

## 2. Co-Located Test Files

### 2a. Which Files Get a Test, and the Naming Convention

**Every source file with non-trivial logic has a test file beside it**, same directory, with a test suffix:

    src/security/headers.ts   → src/security/headers.test.ts
    src/ui/core/button.tsx    → src/ui/core/button.test.tsx

<!-- rule:libs-testing-colocated --> Co-location makes coverage visible at a glance and keeps relative imports short (§2c).

**A configuration file gets no test**: a config has no logic, so a test over it can only restate the file and fail when the config legitimately
changes; a property such a test seems to prove belongs to the code that _reads_ the config.

**The browser set follows the same rule with its own suffix.** A subject may have both, and often should: the exact-HTML test proves what the server
emitted, the browser test proves what the markup then does.

**The one exception is a spec with no single subject**: a scenario that exists only _between_ two components sits at the root of the tier it spans,
since co-locating it would name a subject when none is.

**A cross-cutting sweep enumerates the published surface only**: deriving subjects from a barrel's own exports covers a new symbol the day it is
exported, while walking into sub-components a caller does not address makes the subject set something the sweep computes, not the barrel declares.

### 2b. Excluded From Publish

<!-- rule:libs-testing-test-only-unpublished --> The published-files list excludes every test file, which keeps the package lean and stops consumers
importing test helpers.

### 2c. Import Concrete Files in Tests

<!-- rule:libs-testing-concrete-import --> A test beside its subject reaches it with a relative path one segment long.

Importing via the barrel couples the test to the export surface rather than the implementation, and masks exactly the re-export bugs the export gate
exists to catch.

The exceptions are narrow: a **test-fixture namespace** is imported by subpath, because consumer test code sits outside the source tree, and a
**test whose subject _is_ the export surface** reads the published surface, with the lint rule suppressed at that one import and a reason.

---

## 3. Assertion Rules

### 3a. Assert the Escaped Form

A correct renderer escapes **every** string child, static and interpolated alike. **Assert the escaped form, exactly** — the repository's own
`docs/TEST_RUNNERS.md` §3a publishes the character-to-entity map its renderer produces, and that map is the one to assert against.

**Static text in the source is escaped exactly as an interpolated value is**: never assert a raw `&`, `<`, `>`, `'` or `"` because the JSX
literal was written that way.

**The one bypass is an explicitly-trusted HTML value**, which is emitted verbatim. Assert the unescaped form there, and only there.

**URL-bearing attributes are a further exception**: a renderer routes them through a URL sanitizer, so assert the safe placeholder a hostile scheme
renders as.

### 3b. Exact Match — Never Substring Matching

```ts
// BAD — toContain passes even when the entity encoding is wrong
expect(html).toContain("O'Brien");

// BAD — a partial regex hides the same bug
expect(html).toMatch(/O'Brien/);

// GOOD — toBe on the full element catches encoding exactly
expect(html).toBe("<td>O&#39;Brien &amp; Associates</td>");
```

<!-- rule:libs-testing-exact-match --> Substring matching is legitimate on non-markup strings — an error message, a log line, a SQL fragment.

### 3c. Render Once, Assert Once

**Render through the shared render helper and assert the full markup with one exact assertion.**

**Do not call a private render path, render twice to assert two fragments, or fall back to substring matching.**

### 3d. Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees

**The operational check, applied before a test is counted as written: delete the mechanism the test names; a test that still passes was never
testing it.**

The failure shape: the subject is a _mechanism_ — a timer cleared, a list that does not grow, an observer disconnected — and the assertion reads an
_outcome_ a second mechanism also produces, usually a guard clause whose early return makes "nothing visibly happened" true whether or not the
timer was cancelled.

Shapes worth recognising:

- **A guard downstream of the subject.** Remove a disposal guard and every case stays green except the one counting initialisations, because the
  guard and the mechanism produce the observable state identically.
- **An assertion that passes when its subject is absent.** A negative assertion over an optional path — `expect(probe?.[0]).not.toBe("x")` — passes
  when `probe` has been deleted outright, because the expression is then `undefined`.

**Pin the mechanism, and pin that it was armed**, since a mechanism never set up also never runs; one assertion holds both halves:
`expect(timers).toEqual({ scheduled: 1, fired: 0 })`.

This does not weaken §1c: what is counted here is the **platform's** own invocation, which _is_ the mechanism, whereas §1c bans counting calls into
the test's own fixture in place of the DOM state a controller was supposed to produce.

### 3e. Assert the Contract, Not the Implementation Restated

**A literal copied from the source under test is not an expected value.** This is the case §3d cannot reach: a transcription goes red whenever the
source changes, so it is never vacuous by the deletion check, yet it only records that two files agree — §2a's configuration-file rule, applied to
a constant inside a module.

Common shapes:

- **A transcribed constant map.** A frozen array or lookup table read out of the module and asserted back, entry by entry, often with further cases
  derivable from the first. Test what _reads_ the table: the behaviour its entries were chosen to produce.
- **A registration list.** The command or middleware roster copied into the test as an array of names in order. Assert dispatch instead — drive the
  real entry point and pin what it did. Asserting an _identity_ rather than a spelling is what stops two copies of a name drifting apart.
- **A class string hoisted out of a recipe.** A style literal lifted from the source, or out of rendered output, and reassembled in the expected
  value. A token rename then fails the test while changing nothing a reader can see, and a stylesheet carrying no rule for that class fails nothing
  at all.

**The operational test: if this test and the source under test were edited together by the same rename, would anything go red?** If no, the test
pins agreement between two files, not behaviour.

This does not weaken §3a–§3c: an exact assertion on the markup a renderer emitted, written out whole, **is** the contract. What is refused is a
class constant imported or transcribed from the source and recomposed into the expectation, so both sides move together.

**An expected value has to come from somewhere other than the source.** In descending order of strength: a published standard's test vectors, which
make transcription structurally impossible; a table generated from the domain rule rather than from the branches; a real dependency's own answer — a
query plan from a real database, a DOM state after a real event in a real browser; and the observable outcome of a request, asserted whole.

**Where a constant genuinely is the contract, write it as a literal rather than importing it**, since a value read back out of the module under test
cannot fail when it changes; a value this repository does not own is imported, so a dependency's change surfaces as a failure.

**Negative space is evidence.** A refusal that asserts status and body _and_ that nothing downstream ran — no statement issued, no row written, no
outbound call made — pins what the refusal cost, which no restatement of the guard's own constants can.

### 3f. A Deleted Claim Lands in a Test

**A claim removed from a comment is not removed from the system until an assertion holds it.** `CODE_RULES.md` §5e is this rule seen from the source
side: a comment asserting behaviour is prose standing in for a test, and the fix is the test.

So a change that deletes such a comment carries scoped work here:

- **The claim names the assertion.** "Returns the cached value when the entry has not expired" is already a test name and an expectation, only to be
  written.
- **Check first whether it is already pinned.** Frequently the comment was a second, unexecuted copy — §5b's defect — and deleting it costs nothing.
- **Where it is not pinned, the test is part of the change**, not a follow-up or a ledger task: the change is not done while the system has lost the
  claim and gained nothing.

§3d and §3e apply to the resulting test: a claim rewritten as an outcome a second mechanism also produces, or as a literal copied out of the source,
has only been restated in a new syntax.

---

## 4. Fakes Over Mocks

### 4a. Fake Pattern — Implement the Interface

A fake is a minimal in-test implementation of a real interface, written as a plain object literal **annotated with that interface** — every member
present, each body the least it can be.

**TypeScript enforces that every interface member is present**, so interface drift breaks the test at compile time — the whole argument for fakes.

Ship the recurring fakes from a **test-fixture namespace** — an in-memory store fake, a render helper, a request builder, a single-route registrar —
since a fake every suite hand-rolls drifts per suite.

### 4b. Why Fakes Over Mocks

| Concern | Fake | Mock library |
| --- | --- | --- |
| API change detection | Compile error | Silent — passes with a stale signature |
| Readability | An explicit object literal | A chain of `.mockReturnValue(...)` calls |
| Coupling | To the interface contract | To call order, argument matchers, invocation counts |
| Dependencies | None | Requires a mock library |

<!-- rule:libs-testing-no-mock-library --> Use argument-capturing fakes (`CODE_RULES.md` §4b) when you need to inspect calls.

---

## 5. Security Test Requirements

### 5a. Both Pass and Fail Cases Required

**Security-sensitive code requires both a positive case — the guard allows a valid request — and a negative case — the guard blocks an invalid
one**, and a suite with only the happy path must not be merged.

**Build the application under test the way production does: declaratively** — routes declared as a map bound to a controller, path-scoped
middleware registered as production registers it, and requests driven through the app's own entry point so the full chain runs and deferred work
is awaited.

A test that wires a handler by hand proves nothing about the chain, which is where guards actually live.

| Feature | Required positive case | Required negative case |
| --- | --- | --- |
| CSRF protection | Valid token → 200 | Missing or invalid token → 403 |
| Origin check | Same-origin → proceeds | Cross-origin → 403 |
| Rate limiting | Under limit → 200 | Over limit → 429 |
| Input validation | Valid input → renders values | Invalid input → renders field errors |
| Content type | Expected type → proceeds | Wrong or missing → 415 |
| Auth middleware | Valid session → proceeds | Missing or expired session → 401 |

**Keep a row-to-test coverage map in `docs/`**, naming which suite covers each row. A matrix nobody has mapped to real files is a checklist, not
coverage.

### 5b. Negative Case Structure

**The negative case asserts the exact status AND a meaningful body fragment** — not the status alone. That proves the error path _renders_, rather
than merely that the request exited early.

```ts
it("rejects missing CSRF token with 403", async () => {
  const res = await buildApp().request(
    "/contact",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "name=Alice", // no CSRF field
    },
    MINIMUM_ENV,
  );
  expect(res.status).toBe(403);
  expect(await res.text()).toBe("Forbidden");
});
```

**"Body is non-empty" is a code smell**: it asserts nothing, so reserve loose checks for genuinely runtime-dependent values — signed tokens,
generated ids.

### 5c. No Mocking of Security Primitives

**Do not mock a security primitive to make a test pass**; test the real implementation against a fake binding.

If the real implementation is too hard to invoke from a test, that is a **testability signal — refactor to accept injectable dependencies**, not a
licence to mock. A mocked guard is a test that passes when the guard is deleted.

---

## 6. The Verification Gate

### 6a. One Command, Nested Tiers

**There is one gate command, and its tiers — `static`, `unit`, `runtime` and `scheduled` — are selected with `--tier`, not commands**, because
verbs sharing every flag and every line of behaviour, differing only in a membership filter, are tiers of one command. They nest,
`static ⊆ unit ⊆ runtime ⊆ scheduled`, and §6c owns what each holds. **Each moment runs one tier, and `runtime` is what a bare invocation runs:**

| Moment | Runs |
| --- | --- |
| Interim, while writing | `verify:static`, as often as it helps; it closes nothing (`AGENT_WORKFLOW.md` §4) |
| Task close, before review | `verify:unit` |
| Epic close | `verify`, the `runtime` tier, by the verification runner |
| Tag | `verify:scheduled`, run by the release command before it tags; the remote CI then runs `verify:unit` on the tag |
| Daily cron | `verify:scheduled`, run by the ledger host |

`unit` is also the run for a machine with no runtime installed, and no other moment exists to close on. A browser spec between them is the
developing agent's call — one spec on one engine where a UI change needs confirming, never the whole set and never routine.

**The tag and the cron are not an agent's moments, and `verify:scheduled` belongs to them**: an agent never runs it by itself, plans it into a task
or reports it as owed, because the release command runs it before a tag the user asked for and the ledger host runs it daily, filing a break in the
ledger as a task without anyone being told to look.

**The daily cron is the ledger host's, and its verdict lands in the ledger.** It gates a fresh checkout of the default branch with `--report`, never
a developer's work tree; a failure lands as one open task in that project's ledger, rewritten in place by each later failure while it stays open,
and a run that never reached a test is logged and filed as nothing.

### 6b. What Each Tool Catches

Keyed by tool rather than by step, because which steps exist drifts (§6e) and what a tool proves does not.

| Tool | Catches |
| --- | --- |
| The type checker | Type errors, wrong argument types, missing properties |
| The linter | Style violations, banned patterns, the no-sibling-barrel rule |
| The test runner | Functional regressions |
| The project's own validators | Barrel and export-map drift, governing-doc format, asset coverage |

**Fix type failures first** — they cascade into misleading lint and test failures, which is why the step table orders the type check first.

### 6c. The Lines Between the Tiers

**A tier names what a step needs, so a step's tier is predictable from the step alone:**

| Tier | A step belongs here when it |
| --- | --- |
| `static` | judges the source and runs nothing |
| `unit` | runs code in the test process, with nothing installed but the repository's dependencies |
| `runtime` | needs a Worker runtime or a local database, and runs only when the pending changes reach it |
| `scheduled` | is heavy, or judges a finished change; every row at this tier runs whole |

**The kind line is what a step does, not what it costs**: type checking, linting, formatting and every project validator read the source, and a test
suite executes what it builds. So a type-aware lint that takes seconds stays in `static` and a quick suite is still `unit`, which lets a writer
trust one run to judge everything they just wrote. **Every step below `runtime` works on any machine with the repository's dependencies
installed**, so anyone may run those tiers at any time; a step with a `requires` probe on an optional dependency runs wherever that dependency is
installed, and §6e's tier-decided verdict keeps that from weakening the gate an epic closes on.

**A heavy step goes to `scheduled`, and that is the one line cost draws.** A step is heavy when any of these holds:

- it starts a browser, or runs any suite under Playwright — a Worker-runtime suite on Playwright included;
- it runs a Worker-runtime suite on every change, with nothing declaring which changes reach it;
- it is a soak, a live-network or a deep property run;
- its test set takes more than 60 seconds, or one test in it more than 10.

That budget is stated here and nowhere else. **A step that is not heavy stays where what it needs puts it**, however slow it feels, because a tier
whose membership follows taste is a tier nobody can predict. A step that asks whether the tree is ready to ship — a bundle of what deploys, a gate
over a derived tree — also starts at `scheduled`, because it judges a finished change. A changelog's shape is not that question: its headings and
released sections are judged at `static`, and an empty `[Unreleased]` is refused by the release command when it tags, not by a row.

**A heavy test inside `unit` is split out, never dropped**: it becomes a test set of its own in the `scheduled` tier, never deleted, skipped or
ignored out of every automated run.

**The price is stated rather than hidden: a break in a heavy step is found by the next daily cron run or the next tag, not by the epic gate.**
Another browser engine is such a step: Chromium proves the behaviour, and another engine proves only that it holds there too.

**Every repository declares `verify:scheduled`**: the cron runs it, so a repository without it is outside the cron, a gap rather than a choice.

**Below `scheduled`, a step that declares what it reads runs only when the pending changes reach it; at `scheduled` it runs whole.** `selectSteps`'s
TSDoc owns how a change selects it. A step may also trace at run time the paths no glob can name ahead of time; a change reaching one of them runs
it whole, and so does a trace that fails.

**A step's reach is derived from a graph a check already holds — the tool's import graph, the declared namespace graph — never from a hand-kept
path list.** The one hand-kept list names what that graph cannot see — a file a spec reads without importing it, a module reached through a
specifier resolved at run time — and is checked against the tree, so a glob a rename leaves matching nothing is refused. **`scheduled` runs every
step whole on every tag and every cron run**, the backstop for a reach the derivation missed.

**A table declares each tier as its own list, in run order**, and `resolveTiers`'s TSDoc owns how a `tier()` reference expands, which tier an
undeclared one runs as, and what it refuses — refusing the table whole, whichever tier the run asked for. Each tier above `static` leads with the
reference to the tier below by convention, unrefused when omitted: that reference nests the tiers and makes a fail-fast `scheduled` run fail on
the sub-second check rather than after minutes of browser. A row moves tier by moving its entry, never by declaring it twice; a table never spells a
fallback as a tier that only references the one below, since the verdict already names it, as in `verify (as unit)`. A row a tier reaches through a
reference runs whole, because the tier that declared it made no claim about which changes reach it.

### 6d. A Scoped Run Is Not a Gate Run

A narrowed selection brands every summary line as scoped, so a scoped green is never read as a green gate. **A selection resolving to zero steps is
refused outright**: a gate that ran nothing must never be indistinguishable from one that passed.

**Leaving a row untouched at `runtime` is not a scoped selection** but the tier's own definition (§6c), so its green is a gate green; what it ran
depends on the commit, so its receipt records it and answers a reuse only at that commit.

**A run that executes no step is not refused when it cannot pass for a gate that ran**: a reuse run's verdict names the recorded run and the tree
hash it stands on, carried only to bytes that run covered, and an `--affected` run whose changes touch no step says so, exits 0 and carries the
scoped brand.

### 6e. What the Runner Promises

**A config file owns the step table** — every step, how it runs, and the tiers that list it — so read it there rather than in any prose copy; a step
is an external command or a check the runner calls in-process.

**Every step the run actually executed must pass with zero errors before a task is declared complete**; a partial pass such as "types pass, lint has
one warning" is a failure.

**A step may declare a prerequisite, and what an absent one means is the tier's answer rather than the step's**: below `runtime` the step is
**skipped** with the hint that would install its dependency, and from `runtime` up it **fails** with that hint, because those tiers promise a
runtime ran and an epic or a tag may not close on a step nobody ran. **A run in which every selected step skipped is red**, for the reason a
zero-step selection is refused (§6d).

The runner reports each step as it finishes, stops at the first failure, and names it. **That name is the verdict**, read off the summary line and
never inferred from raw tool output; the tier is part of it, because the tiers are different assurances, and so is **a skipped step** — a green
that skipped a step is not the green that ran it.

The gate command's own flag table, printed by `--help`, owns what each flag does.

[boundaries]: ./BOUNDARIES.md
[cr-5d]: ../shared/CODE_RULES.md#5d-tests-are-not-exempt
