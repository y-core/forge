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
- §4c Capturing Arguments in Fakes: captures over call assertions
- §5 Security and Fail-Closed Expectations: both directions, every guard
- §5a Both Pass and Fail Cases Required: the requirement matrix
- §5b One Test Per Rejection Path: never one test for the whole guard stack
- §5c Negative Case Structure: assert status and body
- §5d No 200 on Guard Failure: never adjust the assertion to match
- §5e No Mocking of Security Primitives: a testability signal, not a mocking one
- §6 The Verification Gate: what must pass before a task closes, and before a commit
- §6a One Command, Nested Tiers: the lines between them, and what an absent prerequisite means
- §6b What Each Tool Catches: the failure classes
- §6c A Scoped Run Is Not a Gate Run: why a narrowed selection brands itself, and where a runtime row's reach comes from
- §6d Local Ports Are Slots, and a Slot Is a Port and a Bind Address: what each half is, and who overrides which
- §6e One Tier per Moment: which tier each moment takes, why the browser set waits for `release`, and the cron run

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

Pure functions, schemas, and formatters are tested directly, with no app and no request. **Do not route a pure-function test through the app** — the
request adds nothing but a slower failure message.

The dividing question: _does the behaviour depend on the middleware chain, the route map, or the environment?_ If no, test the function.

---

## 2. Test Placement and the Environment Fixture

### 2a. Test Placement Is a Repository Decision, Stated Once

**Whether tests sit beside their source or in a dedicated directory is a per-repository choice, recorded in that repository's `docs/` docs, and it
is not re-argued per file.**

What this document requires is that the choice be **uniform and stated**. A repository with some tests co-located and some in a test directory has
neither convention, and a reader cannot tell whether a missing neighbour means missing coverage.

Where the choice is a dedicated directory, the reason is usually that tests are grouped by the _question they answer_ — unit, integration,
end-to-end — rather than by the file they cover. That is a legitimate taxonomy, and it is the one thing co-location cannot express.

**Whichever directory the repository chooses, a test file's name matches the name of the source file it covers** — `headers.ts` is tested by
`headers.test.ts`, wherever that file sits. Grouping by question is a choice about _placement_; it is not a licence to name a test after the
question instead, which leaves the source file with no test findable from its own name.

**Where a repository does dedicate a directory to the browser set, it is named `browser/`** — the same word as the `test:browser` verb that runs it,
so the directory and the command a reader types are one name. That is a naming rule for a directory that exists, not a requirement to grow one.

### 2b. The Browser-Spec Suffix Is `*.browser.ts`

**A browser spec is named `*.browser.ts`, and this is fleet-wide rather than a repository's choice.** The unit runner collects `*.test.*`,
`*_test.*`, `*.spec.*` and `*_spec.*` — never `*.browser.ts`. A browser spec named `.spec.ts` is therefore collected by a bare unit run, inside
which it cannot execute, and every repository that hits this reaches for the same workaround: hand-scoping the gate's test paths around its own
specs. With `.browser.ts` the collision is impossible by construction rather than avoided by configuration.

**A repository consequently never narrows the preset's `tests` option to dodge the unit collector.** Narrowing it for a deliberate tier split — a
set whose every spec starts a real runtime, held to its own step — stays legitimate; those specs keep the `.test.ts` suffix, because their own
runner has to collect them.

The suffix also makes a helper safe to keep beside the specs it serves: a driver or a fixture module under the browser directory is collected by
neither runner, where the same file beside a `.spec.ts` would be.

### 2c. The Minimum Environment Fixture

**Define one shared fixture holding the smallest environment that boots the app**, and derive every variant from it by spreading and overriding.

```ts
const MINIMUM_ENV = {
  ASSETS: { fetch: async () => new Response("", { status: 200 }) },
  BASE_URL: "https://example.com",
  CSRF_SECRET: "…64 hex characters…",
};
```

These properties make it useful rather than ceremonial:

- **Every value is obviously a test value.** A secret that looks like a real secret will eventually be treated as one ([`CODE_REVIEW.md`][cr-3c]
  §3c).
- **A field is present only because its absence breaks the boot.** A fixture that lists every binding the app has ever had stops telling a reader
  what is required.

**The fixture's required fields are documented in `docs/`** with what each one must satisfy — a key length, a URL scheme — because those constraints
are real and a wrong value produces a confusing failure rather than a clear one.

### 2d. Optional Bindings Are Deliberately Absent

**Bindings the application degrades gracefully without are left out of the minimum fixture on purpose** — a log store resolved with
`required: false`, say. Their absence is what proves the degradation path works ([`BOUNDARIES.md`][boundaries-5b] §5b).

A rate limiter is not one of them: outside `forge cf dev` its absence answers `503`, so leaving it out asserts the refusal rather than a
degradation ([`WORKERS_PLATFORM.md`][wp-3b] §3b).

Add such a binding only in the specific test that exercises it, never to the shared fixture. Adding it globally silently deletes the coverage.

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

**If an assertion string is too long, extract the relevant element and assert exactly on that.** Never shorten an assertion by switching to a
substring match. Substring matching stays legitimate on non-markup strings — an error message, a log line, a query fragment.

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

**Never assert a raw `&`, `<`, `>`, `'` or `"` on the strength of a literal having been written that way in the source.** URL-bearing attributes are
a further exception: a renderer routes them through a sanitizer, so a hostile scheme renders as a safe placeholder — assert the sanitized form.

### 3d. Headers and Status Are Always Exact

Security headers are deterministic strings and HTTP status is an integer constant. **Use exact equality for both** — never a substring match on a
header, never a range comparison on a status.

```ts
expect(res.headers.get("x-content-type-options")).toBe("nosniff");
expect(res.status).toBe(403);
```

A range assertion on a status passes for `403` when the test meant `422`, which is precisely the distinction [`BOUNDARIES.md`][boundaries-2d] §2d
exists to keep.

### 3e. Assert the Contract, Not the Implementation Restated

**Both checks are applied before a test is counted as written, and each catches what the other misses.**

**The deletion check: delete the mechanism the test names; a test that still passes was never testing it.** The failure shape is always the same —
the subject is a _mechanism_, and the assertion reads an _outcome_ that a second, independent mechanism also produces. A guard clause is the usual
second mechanism: an early return at the top of a callback makes "nothing visibly happened" true whether or not the thing that calls it was ever
there. **Pin the mechanism, and pin that it was armed**: "the timer never fired" is worth nothing without "a timer was scheduled", and both halves
in one assertion is the cheapest form. A negative assertion over an optional path — `expect(probe?.[0]).not.toBe("x")` — passes when `probe` is
absent outright, so it asserts nothing at all.

**The copied-literal check: a literal copied from the source under test is not an expected value.** This is the case the deletion check cannot
reach. A transcription goes red the moment the source changes, so it is never vacuous by that measure — it merely records that two files agree with
each other, which is a fact about the repository rather than about the software. These shapes are all common:

- **A transcribed constant map.** A frozen array or lookup table read out of the module and asserted back, entry by entry, often with further cases
  that are derivable from the first. Test what _reads_ the table: the behaviour its entries were chosen to produce.
- **A registration list.** The middleware roster or command list copied into the test as an array of names in order. Assert dispatch instead — drive
  a request through the real stack and pin what it did: which mount got which guard, which status the refusal returned, what the command wrote.
  Asserting an _identity_ rather than a spelling is what stops two copies of a name drifting apart.
- **A class string hoisted out of a recipe.** A style literal lifted from the source, or out of rendered output, and reassembled in the expected
  value. A token rename then fails the test while changing nothing a reader can see, and a stylesheet carrying no rule for that class fails nothing
  at all.

**The operational test: if this test and the source under test were edited together by the same rename, would anything go red?** If no, the test
pins agreement between two files, not behaviour.

This does not weaken §3a. An exact assertion on the markup a view emitted **is** the contract — the whole string, written out in the test where a
reader can see the entity encoding. What §3e refuses is the derived form: a class constant imported or transcribed from the source and recomposed
into the expectation, so that both sides move together and neither is ever checked against an outcome.

**An expected value has to come from somewhere other than the source.** In descending order of strength:

- **A published standard's test vectors.** Literals from a standards body make transcription structurally impossible.
- **A table generated from the domain rule** — every shape a discriminator can produce, enumerated from the rule rather than from the branches.
- **A real dependency's own answer** — a query plan from a real database over real migrations, a DOM state after a real event in a real browser.
  Neither side of that comparison was transcribed by anyone.
- **The observable outcome of a request**, asserted whole: status, body, and headers, per §3a and §3d.

**Where a constant genuinely is the contract, write it as a literal rather than importing it.** A test that reads the value back out of the module
under test cannot fail when that value changes, which is the whole point of pinning it. The reverse holds for a value the repository does not own: a
cap or a limit defined by the shared library is imported, so a library change surfaces as a failure here rather than as silent disagreement.

**Negative space is evidence.** A refusal that asserts status and body _and_ that nothing downstream ran — no statement issued, no row written, no
outbound call made — pins what the refusal cost, which no restatement of the guard's own constants can.

### 3f. A Deleted Claim Lands in a Test

**A claim removed from a comment is not removed from the system until an assertion holds it.** `CODE_RULES.md` §5e is this rule seen from the source
side: a comment asserting behaviour is prose standing in for a test, and the fix is the test. This section is the receiving end.

So a change that deletes such a comment carries work here, and the work is scoped, not incidental:

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

**Mock libraries are not installed and must not be added.** They detect no API change, couple the test to call order and argument matchers, and pass
happily against a stale signature.

**Prefer the shared library's fixtures over hand-rolled ones** — in-memory storage fakes, a render helper, a request builder. A fake every suite
writes for itself is a fake that drifts per suite ([`FORGE_CONSUMPTION.md`][fc-1b] §1b).

### 4b. Stubbing an Outbound Call

**Stub at the network seam, not at the service.** Replacing the global fetch for the duration of a test keeps the service's own logic — its request
shaping, its error mapping, its `Result` construction — under test. Replacing the service deletes exactly the code the test was for.

The exception is a **handler** test, where the service is legitimately a collaborator: inject a fake service and assert the handler's branch on each
outcome.

### 4c. Capturing Arguments in Fakes

Use a capture variable at the top of the test block, and reset it in a lifecycle hook when the fake is shared:

```ts
let capturedKey = "";
const kv: KVNamespace = {
  put: async (key) => {
    capturedKey = key;
  } /* …rest */,
};

await handler(fakeContext);
expect(capturedKey).toBe("session:abc123");
```

---

## 5. Security and Fail-Closed Expectations

### 5a. Both Pass and Fail Cases Required

**Security-sensitive code requires both a positive case — the guard allows a valid request — and a negative case — the guard blocks an invalid
one.** A suite with only the happy path is incomplete and must not be merged.

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
check ([`CODE_REVIEW.md`][cr-3c] §3c) fails it immediately. Each case must be valid in every respect except the one it is testing.

### 5c. Negative Case Structure

**The negative case asserts the exact status AND a meaningful body fragment** — not the status alone. That proves the error path _renders_, rather
than merely that the request exited early.

**"Body is non-empty" is a code smell.** An assertion that the body is not the empty string asserts nothing. Reserve loose checks for genuinely
runtime-dependent values.

### 5d. No 200 on Guard Failure

**If a test expects a guard to fire and the response is 200, the guard has a hole.** Treat an unexpected 200 from a guarded route as a defect
requiring root-cause investigation.

**Never adjust the assertion to match the observed status.** That is how a real security regression becomes a permanent, documented behaviour.

### 5e. No Mocking of Security Primitives

**Do not mock a security primitive to make a test pass.** Test the real implementation against a fake binding — mint a real token with the same
utility the app uses, and let the real verifier check it.

If the real implementation is too hard to invoke from a test, that is a **testability signal — refactor to accept injectable dependencies**, not a
licence to mock. A mocked guard is a test that passes when the guard is deleted.

---

## 6. The Verification Gate

### 6a. One Command, Nested Tiers

**There is one gate command, and its tiers — `static`, `unit`, `runtime` and `release` — are selected with `--tier`, not commands.** They are
nested: `static ⊆ unit ⊆ runtime ⊆ release`. **A bare invocation is `runtime`**, and that is the gate a commit closes on; §6e says
which tier each other moment takes. A config file owns the step list: every step, how it runs, and the tier it runs from. Read it there rather than
trusting any prose copy.

**Every step the run actually executed must pass with zero errors before a task is declared complete.** A partial pass — "types pass, lint has one
warning" — is a failure.

**What separates one tier from the next is a property of the step alone, and never cost:**

| Line | A step is above it when |
| --- | --- |
| `static` \| `unit` | it runs the code rather than judging the source |
| `unit` \| `runtime` | it needs a runtime prerequisite — workerd, a local database |
| `runtime` \| `release` | it runs whole: below `release` a runtime row runs only over the pending changes, and a row that judges a finished change — a changelog entry, the deployed bundle — starts here, as does the browser set (§6e) |

"This suite got slow" has no bearing on any of them, with one stated exception: the browser set, whose placement §6e owns. **An absent prerequisite
is a skip below `runtime` and a failure from `runtime` up**, because those tiers promise that a runtime ran, and a commit may not be assured by a
step nobody ran.

**The tier is part of the verdict**, since the tiers are different assurances — and so is a skipped step: a green that skipped one is not the green
that ran it.

**Execution order is tier-stable, not table order: within a tier the table's declared order holds, and across tiers the lower tier runs first.**
The selector sorts by tier after filtering, so where a preset emits a `release` row is not where it runs — an appended `unit` row still runs ahead
of it. That is what makes a fail-fast `release` run fail on the sub-second check rather than after minutes of browser. A repository consequently
never declines a preset's opt-in to get sensible ordering, and never re-declares a row it only wanted moved.

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

A narrowed selection brands every summary line as scoped, so a scoped green can never be read as a green gate. **A selection resolving to zero steps
is refused outright**: a gate that ran nothing must never be indistinguishable from a gate that passed.

**The `runtime` tier's narrowing is not a scoped selection.** It is the tier's own definition (§6a), fixed by the tree and the commit it sits on,
so its green is a gate green. What it ran depends on that commit, so its receipt records it, and a `runtime` receipt answers a reuse only at the
same commit.

**A runtime row's reach is derived, never declared by hand.** The runner asks the row's tool what the narrowed run would select: the row runs
nothing when the answer is nothing, runs narrowed when it is something, and runs whole when the answer cannot be read. A change to one of the gate's
own inputs, or to a path the row declares wide, runs it whole. The only hand-kept list names what the tool's graph cannot see — a file a spec reads
without importing it, or a module it reaches through a specifier resolved at run time — and it is checked against the tree, so a rename that leaves
one of its globs matching nothing is refused rather than silently narrowing the row. **`release` runs every row whole on every tag**, which is the
backstop for a reach the derivation missed. A row whose tool cannot be asked runs whole on every change.

**A spec reaches the application through the server it starts and the assets that server serves, so a runtime row's reach includes both.** The
server half is the import graph of the Worker's entry. The asset half is what the asset build reads: each bundle's inputs, and every file the
stylesheets' source declarations cover. Both are derived from what the build already declares, never listed beside it. A Worker-runtime row takes
the asset half only when the Worker serves the assets. A stylesheet left on automatic source detection covers the whole tree, so every change runs
the row whole — narrowing comes from the stylesheet naming its sources. **A browser row has no reach to derive**: it starts at `release`, where
every row runs whole (§6e).

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
application, against the real bindings, and writing into the database the next run wipes. Stating only the port number permits exactly the failure
this rule exists for.

**The origin is spelled to match the bind address — `127.0.0.1`, never `localhost`.** An application's allowed-origin check compares strings, so
`https://localhost:8788` is not `https://127.0.0.1:8788` and a browser run on the wrong spelling fails its own origin guard for a reason that has
nothing to do with the code under test.

**The override lives in the browser runner's config, never in the Worker config.** The port a harness listens on is a property of the harness;
moving the number the application declares moves the application.

**A fixed port is for a server a human starts or attaches to. A server a spec starts per run takes an ephemeral port and never a number** — the
`listen()` of wrangler's `createTestHarness` takes a free one from the OS, which is why a per-run set has no port problem to solve. A fixed 8788
still collides when two repositories' browser sets run at once; an environment-variable override covers that in one line.

**`reuseExistingServer` is `false`.** The dev command builds the stylesheet as it boots, so a reused server serves the CSS the source had at boot
time — a run against edited views then measures the previous layout and reports it as current. A repository that cannot make `false` work records
the exception with its compensating control, rather than leaving the reuse undocumented.

### 6e. One Tier per Moment

**Each moment takes one tier of the same gate.** The task check adds the touched test files, run by file, to `static` (`AGENT_WORKFLOW.md`
§4); every later moment takes a whole tier and never a scoped run:

| Moment | Command | Runs |
| --- | --- | --- |
| Write and task close | `bun run verify:static`, plus `bun test <file>` on each touched test file | every row that judges the source; each test file the change adds, edits or directly exercises |
| Commit | `bun run verify` | the unit and seam sets, plus every runtime row the pending changes touch; no browser spec |
| Tag | `bun run verify:release`, on the remote | every runtime row whole, every browser spec on Chromium, and the rows that judge a finished change |
| Cron | `bun run verify:release`, then `bun run verify:cron`, run by the ledger host | the tag's run, plus every browser spec on each other engine the application runs, over the default branch as committed |

**The browser set starts at `release`, and that is the one tier line drawn by cost.** §6a's rule holds for every other row. The whole browser set is
the slowest row in the gate and the one a change least often breaks, and narrowing it at `runtime` bought almost nothing: its reach was the Worker's
whole import graph plus the asset build's inputs, so nearly every source edit ran it whole. **The price is stated rather than hidden: a broken page
is found by the next cron run, not by the pre-commit gate.** A tag still never ships without the set, because `release` runs it. While iterating
on a page, one spec on one engine — `playwright test --project=chromium <spec>` — is the loop, and the task check runs a touched spec the same way;
it is a scoped run, never a gate green (§6c).

**The cron run is the ledger host's, and its verdict lands in the ledger rather than in anyone's terminal.** It gates a fresh checkout of the
default branch, never a developer's work tree, and asks the gate for a structured report beside its logs. A failing step or spec becomes a task in
the project it ran for, kept to one open task that each later failure rewrites in place; a run that never reached a test — the server it needs did
not come up — is logged and filed as nothing, because it says nothing about the code.

**Chromium is the browser set's engine, and `test:browser` is its row and the gate's only browser row.** `browser: true` emits it. An application
that needs wider compatibility runs Firefox and WebKit by hand or on the cron run, from `config/cron.ts` default-exporting `[crossEngineStep()]`,
never as a gate row.

**Firefox and WebKit run on a second Playwright server, started only on request, whose endpoint `PLAYWRIGHT_COMPAT_WS_ENDPOINT` names.** The test
runner reads only the primary server's variable, so the application's `playwright.config.ts` points its `firefox` and `webkit` projects at the
second through `use.connectOptions`, which replaces the environment's connection whole, and declares them only when the variable is set.

**An application that opts into Firefox and WebKit runs every spec on them; it tags no cross-engine subset.** An engine difference found there is
fixed, or skipped as the first line of the case with `test.skip(browserName === "…", "<task-id>: <symptom on this engine>")`, the task filed before
the skip is written. A spec that needs a Chromium-only Playwright capability — the CDP virtual WebAuthn authenticator has no Firefox or WebKit
equivalent — is skipped on the other two the same way.

**A browser run takes no retries, and never more workers than its Playwright server's client limit.** `retries` is `0`, because a retry turns an
intermittent failure into a green. The worker count defaults to the client limit, read from the environment, because a worker past it only queues;
a set whose specs share one database across workers sets `1` and says why.

[aa-1]: ./APP_ARCHITECTURE.md#1-the-composition-root
[boundaries-2]: ./BOUNDARIES.md#2-middleware-ordering-and-guard-placement
[boundaries-2d]: ./BOUNDARIES.md#2d-rejection-status-discipline
[boundaries-5b]: ./BOUNDARIES.md#5b-required-false--non-security-features-only
[cr-3c]: ./CODE_REVIEW.md#3c-tier-3--judgement
[cr-5d]: ../shared/CODE_RULES.md#5d-tests-are-not-exempt
[fc-1b]: ./FORGE_CONSUMPTION.md#1b-capability-classes-the-library-owns
[wp-3b]: ./WORKERS_PLATFORM.md#3b-an-absent-limiter-fails-closed
