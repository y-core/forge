---
title: Testing Discipline
description: "The app-request pattern, environment fixtures, exact-match assertions and entity encoding, fakes over mocks, fail-closed expectations, and the gate."
---

# Testing Discipline

> Owns how an application is tested: driving the composition root through its own request entry,
> the environment fixture, the assertion rules, the security cases every guarded route needs,
> and the verification gate.
>
> Defers to: [`BOUNDARIES.md`](./BOUNDARIES.md) §2d for the status each refusal returns;
> [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §1 for the composition root under test;
> [`CODE_RULES.md`](./CODE_RULES.md) §5d for the comment budget inside tests.

---

## 0. Quick Reference

- §1 The App-Request Pattern: driving the real app without a network
- §1a Why the Composition Root Is the Subject: what a hand-wired handler cannot prove
- §1b The Request Entry Point: path, init, environment
- §1c What Is Still a Unit Test: pure functions and schemas
- §2 Test Placement and the Environment Fixture: where tests live and what they inject
- §2a Test Placement Is a Repository Decision, Stated Once: and why
- §2b The Minimum Environment Fixture: the smallest env that boots the app
- §2c Optional Bindings Are Deliberately Absent: proving graceful degradation
- §3 Assertion Rules: exactness, and what nondeterminism is allowed to change
- §3a Exact Match — Never Substring Matching on Markup: the rule
- §3b Nondeterministic Output: normalise, then assert exactly
- §3c The Entity Encoding Map: character to entity
- §3d Headers and Status Are Always Exact: no range assertions
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
- §6 The Verification Gate: what must pass before a task is complete
- §6a One Command, Two Modes: the gate and the release gate
- §6b What Each Tool Catches: the failure classes
- §6c A Scoped Run Is Not a Gate Run: why a narrowed selection brands itself

---

## 1. The App-Request Pattern

### 1a. Why the Composition Root Is the Subject

**A handler test that wires the handler by hand proves the handler works and proves nothing about
the chain** — and the chain is where guards, headers, and context live
([`BOUNDARIES.md`](./BOUNDARIES.md) §2).

The default subject is therefore the **composition root**: the real app, with its real middleware
registration and its real route map. A test that would still pass with every guard removed is not
testing the route.

### 1b. The Request Entry Point

The app exposes a request entry that bypasses the network entirely and drives the Worker
directly — no dev server required. It takes a path, a request init, and an **environment
object**, so bindings and secrets are under test control.

```ts
import app from "../src/worker";

it("returns 200", async () => {
  const res = await app.request("/", {}, MINIMUM_ENV);
  expect(res.status).toBe(200);
});
```

**The environment is an argument, not a global.** That is what makes a missing-binding case
testable at all, and it is why §2b's fixture is a value rather than an ambient setup step.

### 1c. What Is Still a Unit Test

Pure functions, schemas, and formatters are tested directly, with no app and no request. **Do not
route a pure-function test through the app** — the request adds nothing but a slower failure
message.

The dividing question: _does the behaviour depend on the middleware chain, the route map, or the
environment?_ If no, test the function.

---

## 2. Test Placement and the Environment Fixture

### 2a. Test Placement Is a Repository Decision, Stated Once

**Whether tests sit beside their source or in a dedicated directory is a per-repository choice,
recorded in that repository's `docs/` docs, and it is not re-argued per file.**

What this document requires is that the choice be **uniform and stated**. A repository with some
tests co-located and some in a test directory has neither convention, and a reader cannot tell
whether a missing neighbour means missing coverage.

Where the choice is a dedicated directory, the reason is usually that tests are grouped by the
_question they answer_ — unit, integration, end-to-end — rather than by the file they cover. That
is a legitimate taxonomy, and it is the one thing co-location cannot express.

**Whichever directory the repository chooses, a test file's name matches the name of the source
file it covers** — `headers.ts` is tested by `headers.test.ts`, wherever that file sits. Grouping
by question is a choice about _placement_; it is not a licence to name a test after the question
instead, which leaves the source file with no test findable from its own name.

### 2b. The Minimum Environment Fixture

**Define one shared fixture holding the smallest environment that boots the app**, and derive
every variant from it by spreading and overriding.

```ts
const MINIMUM_ENV = {
  ASSETS: { fetch: async () => new Response("", { status: 200 }) },
  BASE_URL: "https://example.com",
  CSRF_SECRET: "…64 hex characters…",
};
```

Two properties make it useful rather than ceremonial:

- **Every value is obviously a test value.** A secret that looks like a real secret will
  eventually be treated as one ([`CODE_REVIEW.md`](./CODE_REVIEW.md) §3c).
- **A field is present only because its absence breaks the boot.** A fixture that lists every
  binding the app has ever had stops telling a reader what is required.

**The fixture's required fields are documented in `docs/`** with what each one must
satisfy — a key length, a URL scheme — because those constraints are real and a wrong value
produces a confusing failure rather than a clear one.

### 2c. Optional Bindings Are Deliberately Absent

**Bindings the application degrades gracefully without are left out of the minimum fixture on
purpose** — a logging store, a rate limiter. Their absence is what proves the degradation path
works ([`BOUNDARIES.md`](./BOUNDARIES.md) §5b).

Add such a binding only in the specific test that exercises it, never to the shared fixture.
Adding it globally silently deletes the coverage.

---

## 3. Assertion Rules

### 3a. Exact Match — Never Substring Matching on Markup

```ts
// BAD — passes even when the entity encoding is wrong
expect(html).toContain("O'Brien");

// GOOD — catches encoding exactly
expect(html).toBe("<td>O&#39;Brien &amp; Associates</td>");
```

**If an assertion string is too long, extract the relevant element and assert exactly on that.**
Never shorten an assertion by switching to a substring match. Substring matching stays legitimate
on non-markup strings — an error message, a log line, a query fragment.

### 3b. Nondeterministic Output

A full page contains per-request values — a CSP nonce, a CSRF token, a generated id — so a
whole-document exact assertion would break on every run. **The answer is to remove the
nondeterminism, not to weaken the assertion.**

Two accepted shapes, in order of preference:

1. **Normalise, then assert exactly.** Replace each nondeterministic token with a fixed
   placeholder, then assert the whole document with one exact comparison. This keeps every
   surrounding character under test, including the encoding.
2. **Extract the deterministic element and assert exactly on it.** Where normalisation would be
   more machinery than the test is worth, assert the exact markup of the element under test
   rather than the page.

**Assert the nondeterministic value's _shape_ separately** — that a nonce is present, non-empty,
and different across two requests. A test that skips this proves the placeholder was substituted
and nothing about the value.

### 3c. The Entity Encoding Map

A correct renderer escapes **every** string child, static and interpolated alike. Assert the
escaped forms:

| Character | Escaped form |
| --- | --- |
| `'` (apostrophe) | `&#39;` |
| `&` (ampersand) | `&amp;` |
| `<` (less-than) | `&lt;` |
| `>` (greater-than) | `&gt;` |
| `"` in attributes | `&#34;` or `&quot;` |

**Never assert a raw `&`, `<`, `>`, `'` or `"` on the strength of a literal having been written
that way in the source.** URL-bearing attributes are a further exception: a renderer routes them
through a sanitizer, so a hostile scheme renders as a safe placeholder — assert the sanitized
form.

### 3d. Headers and Status Are Always Exact

Security headers are deterministic strings and HTTP status is an integer constant. **Use exact
equality for both** — never a substring match on a header, never a range comparison on a status.

```ts
expect(res.headers.get("x-content-type-options")).toBe("nosniff");
expect(res.status).toBe(403);
```

A range assertion on a status passes for `403` when the test meant `422`, which is precisely the
distinction [`BOUNDARIES.md`](./BOUNDARIES.md) §2d exists to keep.

---

## 4. Fakes Over Mocks

### 4a. Fake Pattern — Implement the Interface

A fake is a minimal in-test implementation of a real interface, written as a plain object literal
typed to that interface. **TypeScript enforces that every member is present**, so interface drift
breaks the test at compile time — which is the whole of the argument for fakes over mocks.

**Mock libraries are not installed and must not be added.** They detect no API change, couple the
test to call order and argument matchers, and pass happily against a stale signature.

**Prefer the shared library's fixtures over hand-rolled ones** — in-memory storage fakes, a
render helper, a request builder. A fake every suite writes for itself is a fake that drifts per
suite ([`FORGE_CONSUMPTION.md`](./FORGE_CONSUMPTION.md) §1b).

### 4b. Stubbing an Outbound Call

**Stub at the network seam, not at the service.** Replacing the global fetch for the duration of
a test keeps the service's own logic — its request shaping, its error mapping, its `Result`
construction — under test. Replacing the service deletes exactly the code the test was for.

The exception is a **handler** test, where the service is legitimately a collaborator: inject a
fake service and assert the handler's branch on each outcome.

### 4c. Capturing Arguments in Fakes

Use a capture variable at the top of the test block, and reset it in a lifecycle hook when the
fake is shared:

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

**Security-sensitive code requires both a positive case — the guard allows a valid request — and
a negative case — the guard blocks an invalid one.** A suite with only the happy path is
incomplete and must not be merged.

| Feature | Required positive case | Required negative case |
| --- | --- | --- |
| CSRF protection | Valid token → 200 | Missing or invalid token → 403 |
| Origin check | Same-origin → proceeds | Cross-origin → 403 |
| Expected client hints | Present → proceeds | Absent → 403 |
| Rate limiting | Under limit → 200 | Over limit → 429 |
| Honeypot | Empty → proceeds | Filled → 400 |
| Input validation | Valid input → renders values | Invalid input → renders field errors |
| Content type | Expected type → proceeds | Wrong or missing → 415 |
| Body size | Under cap → proceeds | Over cap → 413 |

**Keep a row-to-test coverage map in `docs/`**, naming which suite covers each row. A
matrix nobody has mapped to real files is a checklist, not coverage.

### 5b. One Test Per Rejection Path

**Write a separate case for each way a request can be refused**, not one case that omits
everything at once.

A single "invalid request" test passes as soon as _any_ guard fires, so it stays green after the
guard it was written for is deleted — the deletion check
([`CODE_REVIEW.md`](./CODE_REVIEW.md) §3c) fails it immediately. Each case must be valid in every
respect except the one it is testing.

### 5c. Negative Case Structure

**The negative case asserts the exact status AND a meaningful body fragment** — not the status
alone. That proves the error path _renders_, rather than merely that the request exited early.

**"Body is non-empty" is a code smell.** An assertion that the body is not the empty string
asserts nothing. Reserve loose checks for genuinely runtime-dependent values.

### 5d. No 200 on Guard Failure

**If a test expects a guard to fire and the response is 200, the guard has a hole.** Treat an
unexpected 200 from a guarded route as a defect requiring root-cause investigation.

**Never adjust the assertion to match the observed status.** That is how a real security
regression becomes a permanent, documented behaviour.

### 5e. No Mocking of Security Primitives

**Do not mock a security primitive to make a test pass.** Test the real implementation against a
fake binding — mint a real token with the same utility the app uses, and let the real verifier
check it.

If the real implementation is too hard to invoke from a test, that is a **testability signal —
refactor to accept injectable dependencies**, not a licence to mock. A mocked guard is a test
that passes when the guard is deleted.

---

## 6. The Verification Gate

### 6a. One Command, Two Modes

**There is one gate command with a fast mode and a full mode — not two commands.** A config file
owns the step list: every step, how it runs, and whether it is full-only. Read it there rather
than trusting any prose copy.

**Every step must pass with zero errors before a task is declared complete.** A partial pass —
"types pass, lint has one warning" — is a failure, and skipping a step is not permitted.

**The line between the modes is a machine prerequisite, never cost.** Every step in a fast run
works on any machine with the repository's dependencies installed. A step needing a fetched
browser binary or a live service is full-only. "This suite got slow" has no bearing on the
question.

### 6b. What Each Tool Catches

| Tool | Catches |
| --- | --- |
| The type checker | Type errors, wrong argument types, missing properties |
| The linter | Style violations and banned patterns |
| The test runner | Functional regressions across routes and services |
| The asset build | Markup referencing an asset the pipeline does not produce |

**Fix type failures first** — they cascade into misleading lint and test failures. The step table
encodes this by ordering the type check first, so a fail-fast run stops there without being told
to.

### 6c. A Scoped Run Is Not a Gate Run

A narrowed selection brands every summary line as scoped, so a scoped green can never be read as
a green gate. **A selection resolving to zero steps is refused outright**: a gate that ran nothing
must never be indistinguishable from a gate that passed.
