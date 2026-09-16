---
title: Code Review Standards
description: "How to review an application: the blocking invariants, tiered detection with a command per rule, severity calibration, verification, and known false positives."
---

# Code Review Standards

> Owns the review process: what blocks a merge, how to _detect_ each violation rather than hand-inspect for it, how to calibrate severity, and which
> suspicious-looking patterns are correct.
>
> **This document restates no rule.** Every item below is either a `detect:` command or a link to the document that owns the rule. To know _why_ a
> rule exists, follow the link.

---

## 0. Quick Reference

- §1 Review Workflow: what to do before and while reviewing
- §1a Pre-Review Preparation: establish a green baseline and read the route map
- §1b Review Output Format: the six fields a finding carries, impact first
- §2 Blocking Invariants: the violations that always block a merge
- §3 Detection by Tier: how each rule is actually checked
- §3a Tier 1 — Gated: rules a gate step already proves
- §3b Tier 2 — Ripgrep With Triage: commands and their false-positive classes
- §3c Tier 3 — Judgement: what to read when no command can decide
- §4 Severity Calibration: critical, major, minor, informational
- §5 Verification Protocol: try to disprove a finding; the default is reject
- §6 Valid Patterns — Do Not Flag: correct code that looks wrong

---

## 1. Review Workflow

### 1a. Pre-Review Preparation

1. **Establish a green baseline** — run the gate before reviewing, so pre-existing failures are not attributed to the change
   ([`TESTING.md`][testing-6] §6).
2. **Read the route map, then the controller binding.** Together they answer "which routes exist and what guards each one" — the single question
   most review findings turn on.
3. **Read each changed handler end to end** before judging any line in it.
4. **Note which library capabilities are imported versus re-implemented** ([`FORGE_CONSUMPTION.md`][fc-1a] §1a).
5. Work §2, then §3a → §3b → §3c. **Verify per §5 before reporting; classify per §4.**

**A pre-review that skips step 2 produces the single most common false positive**: claiming a guard is missing when it is present in the route's
middleware list.

### 1b. Review Output Format

**Name the consequence, not the rule.** A finding that only cites a rule number gives the author nothing to weigh, and a reader who has to look the
rule up before they can judge the finding will not look it up.

Every finding carries six fields, in this order. The order is the point: a busy engineer decides in about ninety seconds whether to act, and impact
is what decides it.

- **Impact** — what an attacker gets, or what breaks, in one sentence. First, because it sets priority.
- **Where** — `path/file.ts:123`, and the function name.
- **What** — two or three sentences: the untrusted source, the dangerous operation it reaches, and why nothing in between stops it.
- **Exploit scenario** — concrete. Not "an attacker could inject SQL": what they send, what the code then does, and what they get back.
- **Preconditions** — what has to be true for this to work: an authenticated session, a feature flag, a specific deployment. An empty list is worth
  writing, because "none" is the strongest version of this field.
- **Fix** — stated as an outcome, and aimed at the root cause. The sink is where the fix belongs; patching one caller leaves the next one.

**If you cannot write the exploit scenario, downgrade the severity.** The scenario is the test of whether the finding is real. A finding whose
scenario reads "an attacker could somehow" is a §5 question, not a finding.

Not this:

    [api/users.ts:88] Possible SQL injection
    Severity: High
    The query may be vulnerable to injection. Consider parameterized queries as a best practice.

This:

    Impact: Any unauthenticated caller can read the whole users table, password hashes included.
    Where: api/users.ts:88, in `searchUsers`.
    What: `req.query.q` is concatenated into the SQL string at line 88. It is never escaped or
      parameterised, and the only validation on the path is a length cap applied at line 61.
    Exploit scenario: GET /api/users?q=' UNION SELECT email, password_hash FROM users-- returns
      every row in the response body, which the endpoint renders without filtering.
    Preconditions: none — the endpoint is unauthenticated.
    Fix: parameterise the query in `searchUsers`. Every caller reaches the sink through this one
      function, so fixing it there closes the class rather than this instance.

Group by file, then severity, critical first. **Never write a secret's value into a finding** (`AGENT_WORKFLOW.md` §7).

---

## 2. Blocking Invariants

**Any one of these blocks a merge regardless of severity argument.**

| Invariant | Owner |
| --- | --- |
| No deprecation shim or backward-compatible path before v1.0.0 | `CLAUDE.md` |
| No hardcoded secret, key, or credential in source | §3c |
| Every state-changing route carries its guards in the route's middleware list | [`BOUNDARIES.md`][boundaries-2b] §2b |
| Untrusted input is validated at the boundary; services take typed objects | [`BOUNDARIES.md`][boundaries-3a] §3a |
| Security-critical paths fail closed, and no verification error is swallowed | [`BOUNDARIES.md`][boundaries-5] §5 |
| No PII reaches a log record | [`BOUNDARIES.md`][boundaries-4] §4 |
| Browser-only code is never imported from a Worker path | [`BOUNDARIES.md`][boundaries-1] §1 |
| No module-level mutable state written per request | [`CODE_RULES.md`][cr-1a] §1a |
| A wrapped dependency is never imported outside the library facade | [`FORGE_CONSUMPTION.md`][fc-2a] §2a |
| A security surface is never worked around locally | [`FORGE_CONSUMPTION.md`][fc-3d] §3d |
| A security guard has both a pass and a fail test | [`TESTING.md`][testing-5a] §5a |
| No comment outside the permitted budget | [`CODE_RULES.md`][cr-5a] §5a |

**The pre-1.0 shim ban is the one most often argued away.** A shim shipped to production is unrecoverable once anything depends on it, which is
precisely what a pre-1.0 version exists to avoid.

---

## 3. Detection by Tier

### 3a. Tier 1 — Gated

**A rule with a gate step is not a review item.** Do not hand-review these; run the gate and read its output.

| Rule class | detect |
| --- | --- |
| Type correctness across every changed signature | the typecheck step |
| Style violations and banned import patterns | the lint step |
| Behaviour of the changed route or service | the test runner, scoped to the changed path |
| Markup referencing an asset the pipeline does not produce | the asset build |

**If a Tier-1 check passes and you still believe the rule is violated, the check is wrong — fix the check, not the review.**

### 3b. Tier 2 — Ripgrep With Triage

**Every command here has a known false-positive class, stated with it. A command without its triage note is worse than no command** — it gets run
once, returns noise, and is never run again.

**Raw environment access for a configured value**

```bash
rg -n 'c\.env\.[A-Z_]+' src/ --glob '!src/app/config.ts'
```

_Triage:_ accessing a **binding object** — a KV namespace, a database, a rate limiter — is correct and expected. A hit reading a **secret or a
scalar setting** bypasses schema validation and is a defect ([`APP_ARCHITECTURE.md`][aa-3a] §3a).

**Handler calling out directly instead of through a service**

```bash
rg -n '\bfetch\(' src/controllers/
```

_Triage:_ a hit forwarding an incoming `Request` unchanged, or calling a library helper that happens to be named `fetch`, is fine. A hit
constructing an outbound call to an external API is a layer violation ([`APP_ARCHITECTURE.md`][aa-2c] §2c).

**Facade breach — a wrapped dependency imported directly**

```bash
rg -n 'from "<wrapped-pkg>"' src/ tests/
```

_Triage:_ any hit is a breach, **including in a test**. A test that imports the wrapped package bypasses the facade exactly as production code would
([`FORGE_CONSUMPTION.md`][fc-2a] §2a).

**Browser-only import in a Worker-reachable file**

```bash
rg -n 'from "[^"]*/client(/|")' src/ --glob '!src/client/**'
```

_Triage:_ the application's own browser entry directory is the legitimate importer. A hit in a view or a controller is the failure
[`BOUNDARIES.md`][boundaries-1b] §1b names — it typechecks and fails on the first real request.

**Inline script without a nonce**

```bash
rg -n '<script(?![^>]*nonce)' src/views/
```

_Triage:_ needs `-P`. A `<script src=…>` with no inline body still needs the nonce under a strict policy, so it is a true positive; a `<script>`
inside a string that is documentation, not markup, is not.

**Substring assertion on rendered markup**

```bash
rg -n 'toContain\(|toMatch\(' --glob '*.test.ts*'
```

_Triage:_ legitimate on non-markup strings — an error message, a log line. **A hit asserting on rendered markup is a defect**
([`TESTING.md`][testing-3a] §3a).

**Unbudgeted comment** ([`CODE_RULES.md`][cr-5a] §5a is the whole budget; [`CODE_RULES.md`][cr-5b] §5b is what is deleted on sight)

```bash
rg -n '^\s*\*\s*@example' --glob 'src/**/*.ts*'
rg -UPn '/\*\*(?:[^*]|\*(?!/)){400,}\*/' --glob 'src/**/*.ts*'
rg -n '^\s*//\s*[-=*_]{3,}' --glob 'src/**/*.ts*'
rg -n '\b(TODO|FIXME|XXX)\b' --glob 'src/**/*.ts*'
```

_Triage:_ the third and fourth have **no false-positive class** — every hit is a defect. The first is anchored to a TSDoc continuation line because
a bare search for the tag matches the `you@example.com` in every email fixture in the repository. The second needs `-P`; its character threshold is
a heuristic floor, and it also matches template-literal contents that use comment syntax as their payload, which is code rather than a comment.

Restating-the-code and narration are reachable by no command; they belong to §3c.

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. _Does any string look like a key, token, or hex secret that is not obviously a
test value?_ A 64-character hex literal is fine in a fixture and fatal in a config module ([`TESTING.md`][testing-2c] §2c).

**Guard placement and order.** Read the controller binding, not the handler. _Is every guard in the route's middleware list, and in the order
[`BOUNDARIES.md`][boundaries-2c] §2c requires?_ An inline guard is invisible to a route-map audit even when it works.

**Fail-closed posture.** Read every new conditional around a security dependency, and every `try`. _When the binding, key, or header is absent, does
the code refuse — or continue?_ A `catch` that proceeds is the defect ([`BOUNDARIES.md`][boundaries-5c] §5c).

**Validation reach.** Read each service signature. _Does any parameter accept raw form data, a query string, or an unvalidated record?_
([`BOUNDARIES.md`][boundaries-3a] §3a.)

**Re-implementation.** For each new utility, _does the shared library already publish it?_ Search the library's export map before accepting a local
one ([`FORGE_CONSUMPTION.md`][fc-1a] §1a).

**Async lifetime.** Read every function whose promise reaches a post-response hook. _Does the returned promise cover every piece of work the
function started, or only the headline one?_ ([`WORKERS_PLATFORM.md`][wp-2c] §2c.)

**Test sufficiency — the deletion check.** For each new test, _if the mechanism it names were deleted, would it still pass?_ A negative case that
omits several things at once passes as soon as any guard fires ([`TESTING.md`][testing-5b] §5b).

**Name reachability.** Read each new export. _Could a reader who knows the domain but not this codebase name this symbol from the question it
answers — and conversely, does the name carry a word that earns nothing?_ ([`CODE_RULES.md`][cr-7] §7.)

---

## 4. Severity Calibration

- **Critical — blocks merge.** Any §2 invariant; a hardcoded secret; a missing guard on a state-changing route; an inline script without a nonce; a
  service accepting raw form data; module-level mutable state written per request.
- **Major — fix before merge.** A handler calling an external API directly; a view containing business logic or a service call; a route defined
  outside the route map; a re-implementation of a library capability; a missing fail-case test on a guarded route; wrong guard order; a raw
  environment read for a configured value; any gate step failing; a comment outside the [`CODE_RULES.md`][cr-5a] §5a budget.
- **Minor — consider fixing.** An exported function with no TSDoc line at all; a substring assertion where an exact one is possible; an unused
  import; an imperative loop where an array method reads better.
- **Informational — note only.** Alternative interaction patterns; future integration suggestions; additional edge-case tests; performance
  observations with no security impact.

**Excess prose is Major, absence is Minor — the asymmetry is deliberate.** A missing summary line costs one read; an unbudgeted one is re-read on
every pass, is reachable by no gate, and goes stale silently. **Never report "expand this comment" as a finding.**

**Calibrate by consequence, not by effort.** A one-character fix to a fail-closed check is Critical; a large refactor that improves readability is
Minor.

---

## 5. Verification Protocol

**The verification pass tries to disprove the finding, and the finding survives only if that attempt fails.** The default is reject. A review that
verifies by looking for confirmation will confirm almost everything it looked at, which is how a report arrives long, plausible and mostly wrong —
and a reader who finds two false positives stops trusting the other thirty.

Before reporting any finding:

1. **Read the whole function, not the flagged line** — surrounding guards or validation often already address the concern.
2. **Check the controller binding before claiming a guard is missing.** This is the highest-yield check in the list.
3. **Run the gate** to distinguish a type error from a style preference.
4. **Search for the library export before claiming something is re-implemented** — it may already be used elsewhere in the same file.
5. **Check the runtime** before flagging an API as unavailable — `crypto.subtle`, streams, and `URL` are all present in Workers.

**A finding you could not verify is a question, not a finding.** Report it as one.

---

## 6. Valid Patterns — Do Not Flag

These look wrong and are correct. Each has been mistaken for a defect before.

| Pattern | Why it is correct |
| --- | --- |
| Graceful degradation on a rate-limit binding | The one sanctioned use of the option — [`BOUNDARIES.md`][boundaries-5b] §5b, [`WORKERS_PLATFORM.md`][wp-3b] §3b |
| A minimum test environment missing optional bindings | Deliberate — it is what proves degradation — [`TESTING.md`][testing-2d] §2d |
| A separate dev entry layering a weaker policy | The dev/production split is structural, not accidental — [`APP_ARCHITECTURE.md`][aa-1c] §1c |
| An intentionally trusted raw HTML value for an inline script | Required where the script must run before paint; it carries a nonce and no interpolation |
| `export const X = …` at module scope | A constant is not mutable state — [`CODE_RULES.md`][cr-1c] §1c |
| A mutable module-scope cache in a browser-only module | Browser-only modules are exempt — [`CODE_RULES.md`][cr-1e] §1e |
| A value constructor not following `create*` | The documented naming exception — [`ERROR_HANDLING.md`][eh-1a] §1a |
| A page view composing its own layout | Presentation belongs to the view — [`APP_ARCHITECTURE.md`][aa-2d] §2d |
| A raw binding read for a binding _object_ | Only configured scalars must go through config — [`APP_ARCHITECTURE.md`][aa-3a] §3a |
| No ambient type packages in the compiler config | Deliberate: platform types come from generated declarations |
| A non-null assertion in a test file | Permitted where the lint config relaxes it for tests; it stays an error in production source |
| `@public` / `@internal` on a TSDoc line | Machine-readable markers, explicitly budgeted — [`CODE_RULES.md`][cr-5a] §5a |

**This table is extended, never replaced, by the application's own `docs/` review doc.** A repository-specific pattern — an editor workaround, a
documented gap, a fail-open surface ratified under [`BOUNDARIES.md`][boundaries-5d] §5d — is recorded there with the same two columns, and a
reviewer reads both.

[aa-1c]: ./APP_ARCHITECTURE.md#1c-the-dev-and-production-entry-split
[aa-2c]: ./APP_ARCHITECTURE.md#2c-no-layer-skipping
[aa-2d]: ./APP_ARCHITECTURE.md#2d-views-are-pure
[aa-3a]: ./APP_ARCHITECTURE.md#3a-typed-config-access
[boundaries-1]: ./BOUNDARIES.md#1-ssr-versus-browser--the-hard-runtime-boundary
[boundaries-1b]: ./BOUNDARIES.md#1b-splitting-a-component-across-the-boundary
[boundaries-2b]: ./BOUNDARIES.md#2b-guards-live-in-the-routes-middleware-list
[boundaries-2c]: ./BOUNDARIES.md#2c-guard-order-within-a-route
[boundaries-3a]: ./BOUNDARIES.md#3a-the-boundary-rule
[boundaries-4]: ./BOUNDARIES.md#4-no-pii-in-logs
[boundaries-5]: ./BOUNDARIES.md#5-fail-closed
[boundaries-5b]: ./BOUNDARIES.md#5b-required-false--non-security-features-only
[boundaries-5c]: ./BOUNDARIES.md#5c-no-silent-error-swallowing
[boundaries-5d]: ./BOUNDARIES.md#5d-recording-a-fail-open-exception
[cr-1a]: ../shared/CODE_RULES.md#1a-no-module-level-mutable-variables
[cr-1c]: ../shared/CODE_RULES.md#1c-constants-are-acceptable
[cr-1e]: ../shared/CODE_RULES.md#1e-browser-only-modules-are-exempt
[cr-5a]: ../shared/CODE_RULES.md#5a-the-entire-permitted-budget
[cr-5b]: ../shared/CODE_RULES.md#5b-forbidden-outright
[cr-7]: ../shared/CODE_RULES.md#7-name-distinctiveness-rule
[eh-1a]: ./ERROR_HANDLING.md#1a-the-unified-result-primitive
[fc-1a]: ./FORGE_CONSUMPTION.md#1a-the-check-before-writing-code
[fc-2a]: ./FORGE_CONSUMPTION.md#2a-import-through-the-library-subpath-always
[fc-3d]: ./FORGE_CONSUMPTION.md#3d-what-is-never-worked-around-locally
[testing-2c]: ./TESTING.md#2c-the-minimum-environment-fixture
[testing-2d]: ./TESTING.md#2d-optional-bindings-are-deliberately-absent
[testing-3a]: ./TESTING.md#3a-exact-match--never-substring-matching-on-markup
[testing-5a]: ./TESTING.md#5a-both-pass-and-fail-cases-required
[testing-5b]: ./TESTING.md#5b-one-test-per-rejection-path
[testing-6]: ./TESTING.md#6-the-verification-gate
[wp-2c]: ./WORKERS_PLATFORM.md#2c-cover-every-started-promise
[wp-3b]: ./WORKERS_PLATFORM.md#3b-graceful-degradation-is-scoped-to-this
