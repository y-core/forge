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
- §2a Test File Naming Convention: same name, same directory, test suffix
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
- §4c Capturing Arguments in Fakes: captures over call assertions
- §5 Security Test Requirements: both directions, always
- §5a Both Pass and Fail Cases Required: the requirement matrix
- §5b Negative Case Structure: assert status and body
- §5c No Mocking of Security Primitives: a testability signal, not a mocking one
- §6 The Verification Gate: what must pass before a task closes, and before a commit
- §6a One Command, Nested Tiers: which tier each moment runs, the daily cron, and an absent prerequisite
- §6b What Each Tool Catches: the failure classes
- §6c The Lines Between the Tiers: what a step needs, the heavy step, the price of running it late, and how a table nests its tiers
- §6d A Scoped Run Is Not a Gate Run: why a narrowed selection brands itself

---

## 1. Test Runners

**There may be more than one runner, and they answer different questions.** A unit runner proves that a function returns what it should and that the
server emitted the markup it promised. A browser runner proves that a controller does what it claims **to a keystroke**. Neither substitutes for the
other, and both are kept.

### 1a. Runner Primitives

**Import all test utilities from the runner itself** — never from a third-party assertion or mocking library layered over a runner that already has
both. A browser driver is the one legitimate external test dependency, because driving a real browser needs one and there is no in-house equivalent
to reach for.

**Keep suite nesting to at most two levels.** Deeper nesting costs more readability than the grouping buys.

### 1b. No Runtime-Specific Type Package

Use a **hand-written declaration stub** for the runner's globals rather than the runtime's published type package. This is a hard requirement, not a
preference:

- Such a package typically overrides a standard global's signature with runtime-specific properties — `fetch` is the usual casualty.
- That override breaks type-checking of Worker code and of test fakes that implement platform interfaces.
- The stub declares exactly the lifecycle and assertion globals in use, and nothing more.

**A change that adds the runtime's type package must be rejected**, including as a transitive dependency of a convenience plugin.

### 1c. The Browser Set

**A browser test runs in a real browser under its own verb**, with its own config owning the discovery pattern, project list, and parallelism.

**The set sits outside `unit` because it needs a browser binary or server an install step provides, and at `scheduled` because a step that
starts a browser is heavy (§6c).** Narrowing it would buy almost nothing, because a spec's reach covers nearly every source file. A broken behaviour
is therefore found by the next daily cron run or the next tag, not by the commit gate, and a tag still never ships without the set.

**Chromium is the set's engine, and another engine is a `scheduled` row of the same table**, so a tag and the cron run both take it (§6a, §6c).
A library adds one when its consumers need wider compatibility. Where the environment serves the other engines from their own server, the browser
config routes those projects there. A run at `scheduled` without that server fails rather than skipping (§6a).

**This is why a DOM shim is rejected, and why the two runners never share a process.** A shim defines hundreds of globals, shadows the runtime
natives the rest of the suite exercises, and certifies components against a model of the platform that lacks the very features they are built on;
one retargeting rule backwards makes the central assertion pass for the wrong reason. A separate process guarantees the isolation by construction
instead — no global redefined, and the platform's own `Request` / `Response` / `fetch` semantics left exactly as the runtime ships them, which
matters because those semantics _are_ the product.

**What each runner is sufficient evidence for:**

| Claim | Proven by |
| --- | --- |
| the server emitted this exact markup | the unit runner, exact-HTML assertion (§3) |
| a pure function returns this value | the unit runner |
| a controller moves focus, writes an attribute, consumes a key | **the browser set only** |

Neither subsumes the other: a component can behave correctly while emitting markup no stylesheet matches, so a markup change _updates_ the
exact-HTML test rather than replacing it with a behaviour test. **A browser case asserts a DOM or focus state, never a call count** — it builds real
markup, dispatches a real event through the browser's own input path, and reads what resulted. A test that counts calls is testing the test's own
fixture.

---

## 2. Co-Located Test Files

### 2a. Test File Naming Convention

**Every source file with non-trivial logic has a test file beside it**, same directory, with a test suffix:

    src/security/headers.ts   → src/security/headers.test.ts
    src/ui/core/button.tsx    → src/ui/core/button.test.tsx

**Test files never go in a top-level `__tests__/` or `tests/` directory.** Co-location makes coverage visible at a glance and keeps relative imports
short (§2c).

**A configuration file gets no test.** A config names values; it has no logic to exercise, so a test over it can only restate the file back to
itself and fail whenever the config legitimately changes. Where such a test looks like it proves something, the property belongs to the code that
_reads_ the config, and the fix is to enforce it there.

**The browser set follows the same rule with its own suffix.** A subject may have both, and often should: the exact-HTML test proves what the server
emitted, the browser test proves what the markup then does.

**The one exception is a spec with no single subject.** A test for a scenario that exists only _between_ two components sits at the root of the tier
it spans rather than beside an arbitrary participant. Choosing a co-location for it would name one component as the subject when none is.

**A cross-cutting sweep enumerates the published surface only.** Deriving subjects from a barrel's own exports means a new symbol is covered the day
it is exported, and a hand-kept list never rots. Walking further — into sub-components a caller does not address directly — makes the subject set
something the sweep computes rather than something the barrel declares.

### 2b. Excluded From Publish

The published-files list excludes every test file, so tests exist only in the source repository. This keeps the package lean and stops consumers
importing test helpers.

### 2c. Import Concrete Files in Tests

**Always import the concrete source file** — never the namespace barrel, and never the package name. A test beside its subject reaches it with a
relative path one segment long.

Importing via the barrel couples the test to the export surface rather than the implementation, and masks exactly the re-export bugs the export gate
exists to catch.

The exceptions are narrow. A **test-fixture namespace** is imported by subpath, because consumer test code sits outside the source tree. And a
**test whose subject _is_ the export surface** must read the published surface — suppress the lint rule at that import with a reason, and nowhere
else.

---

## 3. Assertion Rules

### 3a. Assert the Escaped Form

A correct renderer escapes **every** string child, static and interpolated alike. **Assert the escaped form, exactly** — the repository's own
`docs/TEST_RUNNERS.md` §3a publishes the character-to-entity map its renderer produces, and that map is the one to assert against.

**Static text in the source is escaped exactly as an interpolated value is.** Never assert a raw `&`, `<`, `>`, `'` or `"` on the strength of a
literal having been written that way in the JSX.

**The one bypass is an explicitly-trusted HTML value**, which is emitted verbatim. Assert the unescaped form there, and only there.

**URL-bearing attributes are a further exception:** a renderer routes them through a URL sanitizer, so a hostile scheme renders as a safe
placeholder. Assert the sanitized form.

### 3b. Exact Match — Never Substring Matching

```ts
// BAD — toContain passes even when the entity encoding is wrong
expect(html).toContain("O'Brien");

// BAD — a partial regex hides the same bug
expect(html).toMatch(/O'Brien/);

// GOOD — toBe on the full element catches encoding exactly
expect(html).toBe("<td>O&#39;Brien &amp; Associates</td>");
```

**If the assertion string is too long, extract the relevant fragment and assert `toBe` on that.** Never shorten an assertion by switching to a
substring match. Substring matching is legitimate on non-markup strings — an error message, a log line, a SQL fragment.

### 3c. Render Once, Assert Once

**Render through the shared render helper and assert the full markup with one exact assertion.**

**Do not call a private render path, do not render twice to assert two fragments, and do not fall back to substring matching.** A single
entity-aware exact assertion on the full output is the only accepted shape.

### 3d. Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees

**The operational check, applied before a test is counted as written: delete the mechanism the test names; a test that still passes was never
testing it.**

The failure shape is always the same. The subject is a _mechanism_ — a timer cleared, a list that does not grow, an observer disconnected — and the
assertion reads an _outcome_ that a second, independent mechanism also produces. A guard clause is the usual second mechanism: an early return at
the top of a callback makes "nothing visibly happened" true whether or not the timer that calls it was ever cancelled.

Shapes worth recognising:

- **A guard downstream of the subject.** Remove a disposal guard and every case stays green except the one counting initialisations, because the
  guard and the mechanism produce the observable state identically.
- **An assertion that passes when its subject is absent.** A negative assertion over an optional path — `expect(probe?.[0]).not.toBe("x")` — passes
  when `probe` has been deleted outright, because the expression is then `undefined`. A negative assertion over an optional path asserts nothing.

**Pin the mechanism, and pin that it was armed.** "The timer never fired" is worth nothing without "a timer was scheduled" — a mechanism never set
up also never runs. Both halves in one assertion is the cheapest form: `expect(timers).toEqual({ scheduled: 1, fired: 0 })`.

This does not weaken §1c's rule that a browser case asserts DOM state rather than a call count. What is counted here is the **platform's** own
invocation, which _is_ the mechanism; §1c bans substituting a count of calls into the test's own fixture for the DOM state a controller was supposed
to produce.

### 3e. Assert the Contract, Not the Implementation Restated

**A literal copied from the source under test is not an expected value.** This is the case §3d cannot reach. A transcription goes red the moment the
source changes, so it is never vacuous by the deletion check's measure — it merely records that two files agree with each other, which is a fact
about the repository rather than about the software. The rule §2 states for a configuration file is the same rule: a test that can only restate its
subject back to itself proves nothing, whether the subject is a config or a constant inside a module.

These shapes are all common:

- **A transcribed constant map.** A frozen array or lookup table read out of the module and asserted back, entry by entry, often with further cases
  derivable from the first. Test what _reads_ the table: the behaviour its entries were chosen to produce.
- **A registration list.** The command or middleware roster copied into the test as an array of names in order. Assert dispatch instead — drive the
  real entry point and pin what it did. Asserting an _identity_ rather than a spelling is what stops two copies of a name drifting apart.
- **A class string hoisted out of a recipe.** A style literal lifted from the source, or out of rendered output, and reassembled in the expected
  value. A token rename then fails the test while changing nothing a reader can see, and a stylesheet carrying no rule for that class fails nothing
  at all.

**The operational test: if this test and the source under test were edited together by the same rename, would anything go red?** If no, the test
pins agreement between two files, not behaviour.

This does not weaken §3a–§3c. An exact assertion on the markup a renderer emitted **is** the contract — the whole string, written out in the test
where a reader can see the entity encoding. What this section refuses is the derived form: a class constant imported or transcribed from the source
and recomposed into the expectation, so both sides move together and neither is ever checked against an outcome.

**An expected value has to come from somewhere other than the source.** In descending order of strength: a published standard's test vectors, which
make transcription structurally impossible; a table generated from the domain rule rather than from the branches; a real dependency's own answer — a
query plan from a real database, a DOM state after a real event in a real browser; and the observable outcome of a request, asserted whole.

**Where a constant genuinely is the contract, write it as a literal rather than importing it.** A test that reads the value back out of the module
under test cannot fail when that value changes, which is the whole point of pinning it. The reverse holds for a value this repository does not own:
import it, so a dependency's change surfaces as a failure rather than as silent disagreement.

**Negative space is evidence.** A refusal that asserts status and body _and_ that nothing downstream ran — no statement issued, no row written, no
outbound call made — pins what the refusal cost, which no restatement of the guard's own constants can.

### 3f. A Deleted Claim Lands in a Test

**A claim removed from a comment is not removed from the system until an assertion holds it.** `CODE_RULES.md` §5e is this rule seen from the source
side: a comment asserting behaviour is prose standing in for a test, and the fix is the test. This section is the receiving end.

So a change that deletes such a comment carries work here, and the work is scoped, not incidental:

- **The claim names the assertion.** "Returns the cached value when the entry has not expired" is already a test name and an expectation; it does
  not need to be redesigned, only written.
- **Check first whether it is already pinned.** Frequently it is, and the comment was a second, unexecuted copy — §5b's defect, not a missing test.
  Deleting it then costs nothing and adds nothing.
- **Where it is not pinned, the test is part of the change.** Not a follow-up, not a ledger task: the claim was load-bearing enough to be written
  down once, and the change is not done while the system has lost it and gained nothing.

§3d and §3e both apply to the test that results. A claim rewritten as an assertion that reads an outcome a second mechanism also produces, or as a
literal copied back out of the source, has not landed — it has been restated in a new syntax.

---

## 4. Fakes Over Mocks

### 4a. Fake Pattern — Implement the Interface

A fake is a minimal in-test implementation of a real interface, written as a plain object literal **annotated with that interface** — every member
present, each body the least it can be.

**TypeScript enforces that every interface member is present**, so interface drift breaks the test at compile time — which is the whole of the
argument for fakes.

Ship the recurring fakes from a **test-fixture namespace** rather than re-deriving them per suite: an in-memory store fake, a render helper, a
request builder, a single-route registrar. A fake that every suite hand-rolls is a fake that drifts per suite.

### 4b. Why Fakes Over Mocks

| Concern | Fake | Mock library |
| --- | --- | --- |
| API change detection | Compile error | Silent — passes with a stale signature |
| Readability | An explicit object literal | A chain of `.mockReturnValue(...)` calls |
| Coupling | To the interface contract | To call order, argument matchers, invocation counts |
| Dependencies | None | Requires a mock library |

**Mock libraries are not installed and must not be added.** Use argument-capturing fakes (§4c) when you need to inspect calls.

### 4c. Capturing Arguments in Fakes

**Use a capture variable at the top of the test block**, and reset it in a lifecycle hook when the fake is shared across cases. The fake's method
assigns the argument; the assertion is an exact `toBe` on the captured value, not a claim about how many times it was called.

---

## 5. Security Test Requirements

### 5a. Both Pass and Fail Cases Required

**Security-sensitive code requires both a positive case — the guard allows a valid request — and a negative case — the guard blocks an invalid
one.** A suite with only the happy path is incomplete and must not be merged.

**Build the application under test the way production does: declaratively.** Routes are declared as a map bound to a controller and installed as a
unit; path-scoped middleware is registered the same way production registers it; requests are driven through the app's own request entry point so
the full chain runs and any deferred work is awaited.

A test that wires a handler by hand proves the handler works and proves nothing about the chain, which is where guards actually live.

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

**"Body is non-empty" is a code smell.** An assertion that the body is not the empty string asserts nothing. Reserve loose checks for genuinely
runtime-dependent values — signed tokens, generated ids.

### 5c. No Mocking of Security Primitives

**Do not mock a security primitive to make a test pass.** Test the real implementation against a fake binding.

If the real implementation is too hard to invoke from a test, that is a **testability signal — refactor to accept injectable dependencies**, not a
licence to mock. A mocked guard is a test that passes when the guard is deleted.

---

## 6. The Verification Gate

### 6a. One Command, Nested Tiers

**There is one gate command, and its tiers — `static`, `unit`, `runtime` and `scheduled` — are selected with `--tier`, not commands.** Verbs
sharing every flag and every line of behaviour, differing only in a membership filter, are tiers of one command by definition. They are nested,
`static ⊆ unit ⊆ runtime ⊆ scheduled`. Each tier above `static` includes the tier below it, as its first entry (§6c). What each tier holds is
§6c's. **Each moment runs one tier, and `runtime` is what a bare invocation runs:**

| Moment | Runs |
| --- | --- |
| Write loop and task close | `verify:static`, plus each touched test file run by file (`AGENT_WORKFLOW.md` §4) |
| Commit | `verify`, the `runtime` tier |
| Tag | `verify:scheduled`, run by the release command before it tags; the remote CI then runs `verify:unit` on the tag |
| Daily cron | `verify:scheduled`, run by the ledger host |

`unit` is the run for a machine with no runtime installed. No other moment exists to close on, an epic's end included.

**The daily cron is the ledger host's, and its verdict lands in the ledger.** It gates a fresh checkout of the default branch, never a developer's
work tree, with `--report`. A failure lands as one open task in the ledger of the project it ran for, rewritten in place by each later failure while
it stays open. A run that never reached a test is logged and filed as nothing.

**A config file owns the step table**: every step, how it runs, and the tiers that list it. Read it there rather than trusting any prose copy. A
step is one of two things: an external command, or a check the runner calls in-process.

**Every step the run actually executed must pass with zero errors before a task is declared complete.** A partial pass — "types pass, lint has one
warning" — is a failure.

**A step may declare a prerequisite, and what an absent one means is the tier's answer rather than the step's.** The runner probes once per step.
Below `runtime` the step is **skipped**, named as skipped with the hint that would install its dependency; from `runtime` up it **fails** with that
same hint, because those tiers promise that a runtime ran, and a commit or a tag may not be assured by a step nobody ran. **A
run in which every selected step skipped is red** — for the reason a zero-step selection is refused (§6d): it proves nothing.

The runner reports each step as it finishes, stops at the first failure, and names it. **That name is the verdict** — read off the summary line,
never inferred from raw tool output. The tier is part of the verdict, because the tiers are different assurances, and **a skipped step is part
of it too** — a green that skipped a step is not the green that ran it.

| Flag | Effect |
| --- | --- |
| `--tier <static\|unit\|runtime\|scheduled>` | Select the tier; omitted, the run is `runtime` |
| `--only <a,b>` | Run only those steps; an unknown label is refused, with the known ones listed |
| `--list` | Print the resolved selection and exit, running nothing |
| `--fix` | Run each selected step's fixer instead of the step, and name the steps that have none; a plain run then confirms |
| `--reuse` | Exit green at once when the gate's own receipt shows a passing run of these exact bytes at this tier or higher; otherwise run the gate |
| `--affected` | Run only the steps whose declared paths the working tree's changes touch; always a scoped run |
| `--report <dir>` | Write `report.json` — tier, commit, tree, verdict, and each step's status, duration, log and failing tests — and every step's whole log into `<dir>`, whatever the verdict |

### 6b. What Each Tool Catches

Keyed by tool rather than by step: which steps exist drifts, and §6a already says where that list lives. What a given tool proves does not drift.

| Tool | Catches |
| --- | --- |
| The type checker | Type errors, wrong argument types, missing properties |
| The linter | Style violations, banned patterns, the no-sibling-barrel rule |
| The test runner | Functional regressions |
| The project's own validators | Barrel and export-map drift, governing-doc format, asset coverage |

**Fix type failures first** — they cascade into misleading lint and test failures. The step table encodes this by ordering the type check first, so
a fail-fast run stops there without being told to.

### 6c. The Lines Between the Tiers

**A tier names what a step needs, so a step's tier is predictable from the step alone:**

| Tier | A step belongs here when it |
| --- | --- |
| `static` | judges the source and runs nothing |
| `unit` | runs code in the test process, with nothing installed but the repository's dependencies |
| `runtime` | needs a Worker runtime or a local database, and runs narrowed to the pending changes |
| `scheduled` | is heavy, or judges a finished change; every row at this tier runs whole |

**The kind line is what a step does, not what it costs.** Type checking, linting, formatting and every project validator read the source and say
something about it; a test suite executes what the source builds. A type-aware lint that takes seconds stays in `static`, and a suite that happens
to be quick is still `unit`, which is what lets a writer trust one run to judge everything they just wrote. **Every step below `runtime` works on
any machine with the repository's dependencies installed**, which makes those runs the gate anyone may run at any time. A step that declares a
`requires` probe on an optional dependency runs wherever that dependency happens to be installed, and §6a's tier-decided verdict keeps that from
weakening the gate a commit closes on.

**A heavy step goes to `scheduled`, and that is the one line cost draws.** A step is heavy when any of these holds:

- it starts a browser, or runs any suite under Playwright — a Worker-runtime suite on Playwright included;
- it runs a Worker-runtime suite whole on every change, with no way to narrow;
- it is a soak, a live-network or a deep property run;
- its test set takes more than 60 seconds, or one test in it more than 10.

That budget is stated here and nowhere else. **A step that is not heavy stays where what it needs puts it**, however slow it feels, because a tier
whose membership follows taste is a tier nobody can predict. A step that asks whether the tree is ready to ship — a bundle of what deploys, a gate
over a derived tree — also starts at `scheduled`, because it judges a finished change rather than one in progress. A changelog's shape is not that
question: its headings and released sections are judged at `static`, and an empty `[Unreleased]` is refused by the release command when it tags, not
by a row.

**A heavy test inside `unit` is split out, never dropped.** It becomes a test set of its own, listed in the `scheduled` tier. It is never deleted,
skipped or ignored out of every automated run.

**The price is stated rather than hidden: a break in a heavy step is found by the next daily cron run or the next tag, not by the commit gate.** A
step worth proving only before a tag and on the cron run goes in the `scheduled` tier of `config/steps.config.ts`. Another browser engine is that
kind of step: Chromium proves the behaviour, and another engine proves only that it holds there too.

**Every repository declares `verify:scheduled`.** The cron runs it, so a repository without it is outside the cron, and that is a gap rather than a
choice.

**Below `scheduled`, a step that declares how to narrow runs only over the pending changes; at `scheduled` it runs whole.** Under `runtime` such a
step runs whole when a change touches one of the gate's own inputs or a path the step declares wide. Otherwise its tool is asked what the narrowed
run would select: the step runs nothing when the answer is nothing, runs narrowed to the specs the changes reach when it is something, and runs
whole when the answer cannot be read.

**A step's reach is derived from a graph a check already holds — the tool's import graph, the declared namespace graph — and never from a path
list kept by hand.** The only hand-kept list names what that graph cannot see: a file a spec reads without importing it, or a module it reaches
through a specifier resolved at run time. That list is checked against the tree, so a rename that leaves one of its globs matching nothing is
refused rather than silently narrowing the step. **`scheduled` runs every step whole on every tag and every cron run**, which is the backstop for a
reach the derivation missed.

**A table declares each tier as its own list, in run order, and a tier includes a lower one by reference, expanded in place.** Nothing sorts a
tier. Each tier above `static` leads with the reference to the tier below, by convention: nothing refuses a table that omits it, and such a tier
runs only the rows it lists. That reference is what nests the tiers, and it is what makes a fail-fast `scheduled` run fail on the sub-second
check rather than after minutes of browser. A row moves to another tier by moving its entry, never by declaring it twice.

**A reference may name only a lower tier, and one resolved tier never holds a label twice.** The table is refused whole when either breaks,
whichever tier the run asked for, so a malformed `scheduled` tier fails a `static` run too. Below `scheduled`, a row narrows only in the tier that
declares it directly. A row a tier reaches through a reference runs whole, because the tier that declared it made no claim about narrowing it.

### 6d. A Scoped Run Is Not a Gate Run

A narrowed selection brands every summary line as scoped and not the gate, so a scoped green can never be read as a green gate. **A selection
resolving to zero steps is refused outright**: a gate that ran nothing must never be indistinguishable from a gate that passed.

**The `runtime` tier's narrowing is not a scoped selection.** It is the tier's own definition (§6c), fixed by the tree and the commit it sits on,
so its green is a gate green. What it ran depends on that commit, so its receipt records it, and a `runtime` receipt answers a reuse only at the
same commit.

**A run that executes no step is not refused when it cannot pass for a gate that ran.** A reuse run's verdict names the recorded run it stands on
and the tree hash that run judged, so its green is that run's green, carried only to bytes it covered. An `--affected` run whose changes touch no
step says so, exits 0 and carries the scoped brand, so it is never a green gate.

[boundaries]: ./BOUNDARIES.md
[cr-5d]: ../shared/CODE_RULES.md#5d-tests-are-not-exempt
