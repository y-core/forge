---
title: Testing Discipline
description: "Test placement, the exact-match assertion rule, fakes over mocks, security-test requirements, and the one-command verification gate."
---

# Testing Discipline

> Owns test file placement, the assertion rules, the fakes-over-mocks posture, the security-test
> requirements, and the verification gate. Other documents link here rather than restating them.
>
> Defers to: the gate's step-list config for which steps exist;
> [`BOUNDARIES.md`](./BOUNDARIES.md) for the boundaries a security test must exercise;
> [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §5d for the comment budget inside tests.

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
- §4 Fakes Over Mocks: implement the interface, add no libraries
- §4a Fake Pattern — Implement the Interface: compile-time drift detection
- §4b Why Fakes Over Mocks: the comparison, and the no-mock-library rule
- §4c Capturing Arguments in Fakes: captures over call assertions
- §5 Security Test Requirements: both directions, always
- §5a Both Pass and Fail Cases Required: the requirement matrix
- §5b Negative Case Structure: assert status and body
- §5c No Mocking of Security Primitives: a testability signal, not a mocking one
- §6 The Verification Gate: what must pass before a task is complete
- §6a One Command, Two Modes: the gate and the release gate
- §6b What Each Tool Catches: the failure classes
- §6c The Prerequisite Line: what separates a fast run from a full one
- §6d A Scoped Run Is Not a Gate Run: why a narrowed selection brands itself

---

## 1. Test Runners

**There may be more than one runner, and they answer different questions.** A unit runner proves
that a function returns what it should and that the server emitted the markup it promised. A
browser runner proves that a controller does what it claims **to a keystroke**. Neither
substitutes for the other, and both are kept.

### 1a. Runner Primitives

**Import all test utilities from the runner itself** — never from a third-party assertion or
mocking library layered over a runner that already has both. A browser driver is the one
legitimate external test dependency, because driving a real browser needs one and there is no
in-house equivalent to reach for.

**Keep suite nesting to at most two levels.** Deeper nesting costs more readability than the
grouping buys.

### 1b. No Runtime-Specific Type Package

Use a **hand-written declaration stub** for the runner's globals rather than the runtime's
published type package. This is a hard requirement, not a preference:

- Such a package typically overrides a standard global's signature with runtime-specific
  properties — `fetch` is the usual casualty.
- That override breaks type-checking of Worker code and of test fakes that implement platform
  interfaces.
- The stub declares exactly the lifecycle and assertion globals in use, and nothing more.

**A change that adds the runtime's type package must be rejected**, including as a transitive
dependency of a convenience plugin.

### 1c. The Browser Set

**A browser test runs in a real browser under its own verb**, with its own config owning the
discovery pattern, project list, and parallelism.

**The set sits outside the fast gate, and the reason is a prerequisite, not cost.** It needs a
browser binary an install step fetches, and a prerequisite is the only legitimate ground for a
set to stand outside the fast run (§6c). **Cost never is.** It **is** a step of the release
gate, which is permitted to carry a prerequisite.

**This is why a DOM shim is rejected, and why the two runners never share a process.** A shim
defines hundreds of globals, shadows the runtime natives the rest of the suite exercises, and
certifies components against a model of the platform that lacks the very features they are built
on; one retargeting rule backwards makes the central assertion pass for the wrong reason. A
separate process guarantees the isolation by construction instead — no global redefined, and the
platform's own `Request` / `Response` / `fetch` semantics left exactly as the runtime ships them,
which matters because those semantics *are* the product.

**What each runner is sufficient evidence for:**

| Claim | Proven by |
|---|---|
| the server emitted this exact markup | the unit runner, exact-HTML assertion (§3) |
| a pure function returns this value | the unit runner |
| a controller moves focus, writes an attribute, consumes a key | **the browser set only** |

Neither subsumes the other: a component can behave correctly while emitting markup no stylesheet
matches, so a markup change *updates* the exact-HTML test rather than replacing it with a
behaviour test. **A browser case asserts a DOM or focus state, never a call count** — it builds
real markup, dispatches a real event through the browser's own input path, and reads what
resulted. A test that counts calls is testing the test's own fixture.

---

## 2. Co-Located Test Files

### 2a. Test File Naming Convention

**Every source file with non-trivial logic has a test file beside it**, same directory, with a
test suffix:

    src/security/headers.ts   → src/security/headers.test.ts
    src/ui/core/button.tsx    → src/ui/core/button.test.tsx

**Test files never go in a top-level `__tests__/` or `tests/` directory.** Co-location makes
coverage visible at a glance and keeps relative imports short (§2c).

**A configuration file gets no test.** A config names values; it has no logic to exercise, so a
test over it can only restate the file back to itself and fail whenever the config legitimately
changes. Where such a test looks like it proves something, the property belongs to the code that
*reads* the config, and the fix is to enforce it there.

**The browser set follows the same rule with its own suffix.** A subject may have both, and
often should: the exact-HTML test proves what the server emitted, the browser test proves what
the markup then does.

**The one exception is a spec with no single subject.** A test for a scenario that exists only
*between* two components sits at the root of the tier it spans rather than beside an arbitrary
participant. Choosing a co-location for it would name one component as the subject when none is.

**A cross-cutting sweep enumerates the published surface only.** Deriving subjects from a
barrel's own exports means a new symbol is covered the day it is exported, and a hand-kept list
never rots. Walking further — into sub-components a caller does not address directly — makes the
subject set something the sweep computes rather than something the barrel declares.

### 2b. Excluded From Publish

The published-files list excludes every test file, so tests exist only in the source repository.
This keeps the package lean and stops consumers importing test helpers.

### 2c. Import Concrete Files in Tests

**Always import the concrete source file** — never the namespace barrel, and never the package
name. A test beside its subject reaches it with a relative path one segment long.

Importing via the barrel couples the test to the export surface rather than the implementation,
and masks exactly the re-export bugs the export gate exists to catch.

Two exceptions, both narrow. A **test-fixture namespace** is imported by subpath, because
consumer test code sits outside the source tree. And a **test whose subject *is* the export
surface** must read the published surface — suppress the lint rule at that import with a reason,
and nowhere else.

---

## 3. Assertion Rules

### 3a. Assert the Escaped Form

A correct renderer escapes **every** string child, static and interpolated alike. **Assert the
escaped form, exactly** — the repository's own `implementation/TESTING.md` §3a publishes the
character-to-entity map its renderer produces, and that map is the one to assert against.

**Static text in the source is escaped exactly as an interpolated value is.** Never assert a raw
`&`, `<`, `>`, `'` or `"` on the strength of a literal having been written that way in the JSX.

**The one bypass is an explicitly-trusted HTML value**, which is emitted verbatim. Assert the
unescaped form there, and only there.

**URL-bearing attributes are a further exception:** a renderer routes them through a URL
sanitizer, so a hostile scheme renders as a safe placeholder. Assert the sanitized form.

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
that.** Never shorten an assertion by switching to a substring match. Substring matching is
legitimate on non-markup strings — an error message, a log line, a SQL fragment.

### 3c. Render Once, Assert Once

**Render through the shared render helper and assert the full markup with one exact
assertion.**

**Do not call a private render path, do not render twice to assert two fragments, and do not
fall back to substring matching.** A single entity-aware exact assertion on the full output is
the only accepted shape.

### 3d. Assert the Mechanism, Not an Outcome a Second Mechanism Also Guarantees

**The operational check, applied before a test is counted as written: delete the mechanism the
test names; a test that still passes was never testing it.**

The failure shape is always the same. The subject is a *mechanism* — a timer cleared, a list
that does not grow, an observer disconnected — and the assertion reads an *outcome* that a
second, independent mechanism also produces. A guard clause is the usual second mechanism: an
early return at the top of a callback makes "nothing visibly happened" true whether or not the
timer that calls it was ever cancelled.

Two shapes worth recognising:

- **A guard downstream of the subject.** Remove a disposal guard and every case stays green
  except the one counting initialisations, because the guard and the mechanism produce the
  observable state identically.
- **An assertion that passes when its subject is absent.** A negative assertion over an optional
  path — `expect(probe?.[0]).not.toBe("x")` — passes when `probe` has been deleted outright,
  because the expression is then `undefined`. A negative assertion over an optional path asserts
  nothing.

**Pin the mechanism, and pin that it was armed.** "The timer never fired" is worth nothing
without "a timer was scheduled" — a mechanism never set up also never runs. Both halves in one
assertion is the cheapest form: `expect(timers).toEqual({ scheduled: 1, fired: 0 })`.

This does not weaken §1c's rule that a browser case asserts DOM state rather than a call count.
What is counted here is the **platform's** own invocation, which *is* the mechanism; §1c bans
substituting a count of calls into the test's own fixture for the DOM state a controller was
supposed to produce.

---

## 4. Fakes Over Mocks

### 4a. Fake Pattern — Implement the Interface

A fake is a minimal in-test implementation of a real interface, written as a plain object
literal **annotated with that interface** — every member present, each body the least it can be.

**TypeScript enforces that every interface member is present**, so interface drift breaks the
test at compile time — which is the whole of the argument for fakes.

Ship the recurring fakes from a **test-fixture namespace** rather than re-deriving them per
suite: an in-memory store fake, a render helper, a request builder, a single-route registrar.
A fake that every suite hand-rolls is a fake that drifts per suite.

### 4b. Why Fakes Over Mocks

| Concern | Fake | Mock library |
|---|---|---|
| API change detection | Compile error | Silent — passes with a stale signature |
| Readability | An explicit object literal | A chain of `.mockReturnValue(...)` calls |
| Coupling | To the interface contract | To call order, argument matchers, invocation counts |
| Dependencies | None | Requires a mock library |

**Mock libraries are not installed and must not be added.** Use argument-capturing fakes (§4c)
when you need to inspect calls.

### 4c. Capturing Arguments in Fakes

**Use a capture variable at the top of the test block**, and reset it in a lifecycle hook when
the fake is shared across cases. The fake's method assigns the argument; the assertion is an
exact `toBe` on the captured value, not a claim about how many times it was called.

---

## 5. Security Test Requirements

### 5a. Both Pass and Fail Cases Required

**Security-sensitive code requires both a positive case — the guard allows a valid request —
and a negative case — the guard blocks an invalid one.** A suite with only the happy path is
incomplete and must not be merged.

**Build the application under test the way production does: declaratively.** Routes are declared
as a map bound to a controller and installed as a unit; path-scoped middleware is registered the
same way production registers it; requests are driven through the app's own request entry point
so the full chain runs and any deferred work is awaited.

A test that wires a handler by hand proves the handler works and proves nothing about the chain,
which is where guards actually live.

| Feature | Required positive case | Required negative case |
|---|---|---|
| CSRF protection | Valid token → 200 | Missing or invalid token → 403 |
| Origin check | Same-origin → proceeds | Cross-origin → 403 |
| Rate limiting | Under limit → 200 | Over limit → 429 |
| Input validation | Valid input → renders values | Invalid input → renders field errors |
| Content type | Expected type → proceeds | Wrong or missing → 415 |
| Auth middleware | Valid session → proceeds | Missing or expired session → 401 |

**Keep a row-to-test coverage map in `implementation/`**, naming which suite covers each row. A
matrix nobody has mapped to real files is a checklist, not coverage.

### 5b. Negative Case Structure

**The negative case asserts the exact status AND a meaningful body fragment** — not the status
alone. That proves the error path *renders*, rather than merely that the request exited early.

```typescript
it("rejects missing CSRF token with 403", async () => {
  const res = await buildApp().request("/contact", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "name=Alice",                       // no CSRF field
  }, MINIMUM_ENV)
  expect(res.status).toBe(403)
  expect(await res.text()).toBe("Forbidden")
})
```

**"Body is non-empty" is a code smell.** An assertion that the body is not the empty string
asserts nothing. Reserve loose checks for genuinely runtime-dependent values — signed tokens,
generated ids.

### 5c. No Mocking of Security Primitives

**Do not mock a security primitive to make a test pass.** Test the real implementation against a
fake binding.

If the real implementation is too hard to invoke from a test, that is a **testability signal —
refactor to accept injectable dependencies**, not a licence to mock. A mocked guard is a test
that passes when the guard is deleted.

---

## 6. The Verification Gate

### 6a. One Command, Two Modes

**There is one gate command with a fast mode and a full mode — not two commands.** Two verbs
sharing every flag and every line of behaviour, differing only in a membership filter, is a mode
by definition.

**A config file owns the step list** — every step, how it runs, and whether it is full-only.
Read it there rather than trusting any prose copy. A step is one of two things: an external
command, or a check the runner calls in-process.

**Every step must pass with zero errors before a task is declared complete.** A partial pass —
"types pass, lint has one warning" — is a failure, and skipping a step is not permitted.

The runner reports each step as it finishes, stops at the first failure, and names it. **That
name is the verdict** — read off the summary line, never inferred from raw tool output. The mode
is part of the verdict, because the two modes are different assurances.

| Flag | Effect |
|---|---|
| `--full` | Also run the full-only steps — the ones that may require a machine prerequisite |
| `--only <a,b>` | Run only those steps; an unknown label is refused, with the known ones listed |
| `--list` | Print the resolved selection and exit, running nothing |
| `--fix` | Run each selected step's fixer, then re-run to confirm |

### 6b. What Each Tool Catches

Keyed by tool rather than by step: which steps exist drifts, and §6a already says where that
list lives. What a given tool proves does not drift.

| Tool | Catches |
|---|---|
| The type checker | Type errors, wrong argument types, missing properties |
| The linter | Style violations, banned patterns, the no-sibling-barrel rule |
| The test runner | Functional regressions |
| The project's own validators | Barrel and export-map drift, governing-doc format, asset coverage |

**Fix type failures first** — they cascade into misleading lint and test failures. The step table
encodes this by ordering the type check first, so a fail-fast run stops there without being told
to.

### 6c. The Prerequisite Line

**This is the line between the modes, and it is an objective property rather than a judgement.**
Every step in a fast run works on any machine with the repository's dependencies installed —
nothing to fetch, no binary beyond the declared dev dependencies. That is what makes the fast run
the gate anyone may run at any time, and **why cost is never grounds for moving a step out of
it**.

The full run is the release gate and **is** permitted a prerequisite. A step needing one is
full-only; a step needing nothing carries no flag and runs in both. **The runner refuses a step
table that breaks this**, before the mode is applied — so the rule holds for every project that
consumes the runner, and no repository writes a test of its own to assert it.

The mode enum is closed and the full-only marker is a **boolean, not a list of modes**. There is
consequently no way to express a step the fast run has and the full run does not, so "full is a
superset of fast" is structural rather than something a test has to catch after the fact.

### 6d. A Scoped Run Is Not a Gate Run

A narrowed selection brands every summary line as scoped and not the gate, so a scoped green can
never be read as a green gate. **A selection resolving to zero steps is refused outright**: a
gate that ran nothing must never be indistinguishable from a gate that passed.
