---
title: Code Review Standards
description: "How to review an application: the blocking invariants, tiered detection with a command per rule, severity calibration, verification, and known false positives."
---

# Code Review Standards

> Owns the review process: what blocks a merge, how to _detect_ each violation rather than
> hand-inspect for it, how to calibrate severity, and which suspicious-looking patterns are
> correct.
>
> **This document restates no rule.** Every item below is either a `detect:` command or a link
> to the document that owns the rule. To know _why_ a rule exists, follow the link.

---

## 0. Quick Reference

- §1 Review Workflow: what to do before and while reviewing
- §1a Pre-Review Preparation: establish a green baseline and read the route map
- §1b Review Output Format: the finding shape
- §2 Blocking Invariants: the violations that always block a merge
- §3 Detection by Tier: how each rule is actually checked
- §3a Tier 1 — Gated: rules a gate step already proves
- §3b Tier 2 — Ripgrep With Triage: commands and their false-positive classes
- §3c Tier 3 — Judgement: what to read when no command can decide
- §4 Severity Calibration: critical, major, minor, informational
- §5 Verification Protocol: prove a finding before reporting it
- §6 Valid Patterns — Do Not Flag: correct code that looks wrong

---

## 1. Review Workflow

### 1a. Pre-Review Preparation

1. **Establish a green baseline** — run the gate before reviewing, so pre-existing failures are
   not attributed to the change ([`TESTING.md`](./TESTING.md) §6).
2. **Read the route map, then the controller binding.** Together they answer "which routes exist
   and what guards each one" — the single question most review findings turn on.
3. **Read each changed handler end to end** before judging any line in it.
4. **Note which library capabilities are imported versus re-implemented**
   ([`FORGE_CONSUMPTION.md`](./FORGE_CONSUMPTION.md) §1a).
5. Work §2, then §3a → §3b → §3c. **Verify per §5 before reporting; classify per §4.**

**A pre-review that skips step 2 produces the single most common false positive**: claiming a
guard is missing when it is present in the route's middleware list.

### 1b. Review Output Format

    [FILE:LINE] ISSUE_TITLE
    Severity: Critical | Major | Minor | Informational
    What is wrong, and the consequence.
    Suggested fix, briefly.

Group by file, critical first within each file. End with a summary table: file, finding count,
highest severity. **Name the consequence, not just the rule** — a finding that only cites a rule
number gives the author nothing to weigh.

---

## 2. Blocking Invariants

**Any one of these blocks a merge regardless of severity argument.**

| Invariant | Owner |
| --- | --- |
| No deprecation shim or backward-compatible path before v1.0.0 | `CLAUDE.md` |
| No hardcoded secret, key, or credential in source | §3c |
| Every state-changing route carries its guards in the route's middleware list | [`BOUNDARIES.md`](./BOUNDARIES.md) §2b |
| Untrusted input is validated at the boundary; services take typed objects | [`BOUNDARIES.md`](./BOUNDARIES.md) §3a |
| Security-critical paths fail closed, and no verification error is swallowed | [`BOUNDARIES.md`](./BOUNDARIES.md) §5 |
| No PII reaches a log record | [`BOUNDARIES.md`](./BOUNDARIES.md) §4 |
| Browser-only code is never imported from a Worker path | [`BOUNDARIES.md`](./BOUNDARIES.md) §1 |
| No module-level mutable state written per request | [`CODE_RULES.md`](./CODE_RULES.md) §1a |
| A wrapped dependency is never imported outside the library facade | [`FORGE_CONSUMPTION.md`](./FORGE_CONSUMPTION.md) §2a |
| A security surface is never worked around locally | [`FORGE_CONSUMPTION.md`](./FORGE_CONSUMPTION.md) §3d |
| A security guard has both a pass and a fail test | [`TESTING.md`](./TESTING.md) §5a |
| No comment outside the permitted budget | [`CODE_RULES.md`](./CODE_RULES.md) §5a |

**The pre-1.0 shim ban is the one most often argued away.** A shim shipped to production is
unrecoverable once anything depends on it, which is precisely what a pre-1.0 version exists to
avoid.

---

## 3. Detection by Tier

### 3a. Tier 1 — Gated

**A rule with a gate step is not a review item.** Do not hand-review these; run the gate and read
its output.

| Rule class | detect |
| --- | --- |
| Type correctness across every changed signature | the typecheck step |
| Style violations and banned import patterns | the lint step |
| Behaviour of the changed route or service | the test runner, scoped to the changed path |
| Markup referencing an asset the pipeline does not produce | the asset build |

**If a Tier-1 check passes and you still believe the rule is violated, the check is wrong — fix
the check, not the review.**

### 3b. Tier 2 — Ripgrep With Triage

**Every command here has a known false-positive class, stated with it. A command without its
triage note is worse than no command** — it gets run once, returns noise, and is never run again.

**Raw environment access for a configured value**

```bash
rg -n 'c\.env\.[A-Z_]+' src/ --glob '!src/app/config.ts'
```

_Triage:_ accessing a **binding object** — a KV namespace, a database, a rate limiter — is
correct and expected. A hit reading a **secret or a scalar setting** bypasses schema validation
and is a defect ([`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §3a).

**Handler calling out directly instead of through a service**

```bash
rg -n '\bfetch\(' src/controllers/
```

_Triage:_ a hit forwarding an incoming `Request` unchanged, or calling a library helper that
happens to be named `fetch`, is fine. A hit constructing an outbound call to an external API is
a layer violation ([`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §2c).

**Facade breach — a wrapped dependency imported directly**

```bash
rg -n 'from "<wrapped-pkg>"' src/ tests/
```

_Triage:_ any hit is a breach, **including in a test**. A test that imports the wrapped package
bypasses the facade exactly as production code would
([`FORGE_CONSUMPTION.md`](./FORGE_CONSUMPTION.md) §2a).

**Browser-only import in a Worker-reachable file**

```bash
rg -n 'from "[^"]*/client(/|")' src/ --glob '!src/client/**'
```

_Triage:_ the application's own browser entry directory is the legitimate importer. A hit in a
view or a controller is the failure [`BOUNDARIES.md`](./BOUNDARIES.md) §1b names — it typechecks
and fails on the first real request.

**Inline script without a nonce**

```bash
rg -n '<script(?![^>]*nonce)' src/views/
```

_Triage:_ needs `-P`. A `<script src=…>` with no inline body still needs the nonce under a
strict policy, so it is a true positive; a `<script>` inside a string that is documentation, not
markup, is not.

**Substring assertion on rendered markup**

```bash
rg -n 'toContain\(|toMatch\(' --glob '*.test.ts*'
```

_Triage:_ legitimate on non-markup strings — an error message, a log line. **A hit asserting on
rendered markup is a defect** ([`TESTING.md`](./TESTING.md) §3a).

**Unbudgeted comment** ([`CODE_RULES.md`](./CODE_RULES.md) §5a is the whole
budget; [`CODE_RULES.md`](./CODE_RULES.md) §5b is what is deleted on sight)

```bash
rg -n '^\s*\*\s*@example' --glob 'src/**/*.ts*'
rg -UPn '/\*\*(?:[^*]|\*(?!/)){400,}\*/' --glob 'src/**/*.ts*'
rg -n '^\s*//\s*[-=*_]{3,}' --glob 'src/**/*.ts*'
rg -n '\b(TODO|FIXME|XXX)\b' --glob 'src/**/*.ts*'
```

_Triage:_ the third and fourth have **no false-positive class** — every hit is a defect. The
first is anchored to a TSDoc continuation line because a bare search for the tag matches the
`you@example.com` in every email fixture in the repository. The second needs `-P`; its character
threshold is a heuristic floor, and it also matches template-literal contents that use comment
syntax as their payload, which is code rather than a comment.

Restating-the-code and narration are reachable by no command; they belong to §3c.

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. _Does any string look like a
key, token, or hex secret that is not obviously a test value?_ A 64-character hex literal is fine
in a fixture and fatal in a config module ([`TESTING.md`](./TESTING.md) §2b).

**Guard placement and order.** Read the controller binding, not the handler. _Is every guard in
the route's middleware list, and in the order [`BOUNDARIES.md`](./BOUNDARIES.md) §2c requires?_ An
inline guard is invisible to a route-map audit even when it works.

**Fail-closed posture.** Read every new conditional around a security dependency, and every
`try`. _When the binding, key, or header is absent, does the code refuse — or continue?_ A
`catch` that proceeds is the defect ([`BOUNDARIES.md`](./BOUNDARIES.md) §5c).

**Validation reach.** Read each service signature. _Does any parameter accept raw form data, a
query string, or an unvalidated record?_ ([`BOUNDARIES.md`](./BOUNDARIES.md) §3a.)

**Re-implementation.** For each new utility, _does the shared library already publish it?_ Search
the library's export map before accepting a local one
([`FORGE_CONSUMPTION.md`](./FORGE_CONSUMPTION.md) §1a).

**Async lifetime.** Read every function whose promise reaches a post-response hook. _Does the
returned promise cover every piece of work the function started, or only the headline one?_
([`WORKERS_PLATFORM.md`](./WORKERS_PLATFORM.md) §2c.)

**Test sufficiency — the deletion check.** For each new test, _if the mechanism it names were
deleted, would it still pass?_ A negative case that omits several things at once passes as soon
as any guard fires ([`TESTING.md`](./TESTING.md) §5b).

**Name reachability.** Read each new export. _Could a reader who knows the domain but not this
codebase name this symbol from the question it answers — and conversely, does the name carry a
word that earns nothing?_ ([`CODE_RULES.md`](./CODE_RULES.md) §7.)

---

## 4. Severity Calibration

- **Critical — blocks merge.** Any §2 invariant; a hardcoded secret; a missing guard on a
  state-changing route; an inline script without a nonce; a service accepting raw form data;
  module-level mutable state written per request.
- **Major — fix before merge.** A handler calling an external API directly; a view containing
  business logic or a service call; a route defined outside the route map; a re-implementation of
  a library capability; a missing fail-case test on a guarded route; wrong guard order; a raw
  environment read for a configured value; any gate step failing; a comment outside the
  [`CODE_RULES.md`](./CODE_RULES.md) §5a budget.
- **Minor — consider fixing.** An exported function with no TSDoc line at all; a substring
  assertion where an exact one is possible; an unused import; an imperative loop where an array
  method reads better.
- **Informational — note only.** Alternative interaction patterns; future integration
  suggestions; additional edge-case tests; performance observations with no security impact.

**Excess prose is Major, absence is Minor — the asymmetry is deliberate.** A missing summary line
costs one read; an unbudgeted one is re-read on every pass, is reachable by no gate, and goes
stale silently. **Never report "expand this comment" as a finding.**

**Calibrate by consequence, not by effort.** A one-character fix to a fail-closed check is
Critical; a large refactor that improves readability is Minor.

---

## 5. Verification Protocol

Before reporting any finding:

1. **Read the whole function, not the flagged line** — surrounding guards or validation often
   already address the concern.
2. **Check the controller binding before claiming a guard is missing.** This is the highest-yield
   check in the list.
3. **Run the gate** to distinguish a type error from a style preference.
4. **Search for the library export before claiming something is re-implemented** — it may already
   be used elsewhere in the same file.
5. **Check the runtime** before flagging an API as unavailable — `crypto.subtle`, streams, and
   `URL` are all present in Workers.

**A finding you could not verify is a question, not a finding.** Report it as one.

---

## 6. Valid Patterns — Do Not Flag

These look wrong and are correct. Each has been mistaken for a defect before.

| Pattern | Why it is correct |
| --- | --- |
| Graceful degradation on a rate-limit binding | The one sanctioned use of the option — [`BOUNDARIES.md`](./BOUNDARIES.md) §5b, [`WORKERS_PLATFORM.md`](./WORKERS_PLATFORM.md) §3b |
| A minimum test environment missing optional bindings | Deliberate — it is what proves degradation — [`TESTING.md`](./TESTING.md) §2c |
| A separate dev entry layering a weaker policy | The dev/production split is structural, not accidental — [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §1c |
| An intentionally trusted raw HTML value for an inline script | Required where the script must run before paint; it carries a nonce and no interpolation |
| `export const X = …` at module scope | A constant is not mutable state — [`CODE_RULES.md`](./CODE_RULES.md) §1c |
| A mutable module-scope cache in a browser-only module | Browser-only modules are exempt — [`CODE_RULES.md`](./CODE_RULES.md) §1e |
| A value constructor not following `create*` | The documented naming exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1a |
| A page view composing its own layout | Presentation belongs to the view — [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §2d |
| A raw binding read for a binding _object_ | Only configured scalars must go through config — [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §3a |
| No ambient type packages in the compiler config | Deliberate: platform types come from generated declarations |
| A non-null assertion in a test file | Permitted where the lint config relaxes it for tests; it stays an error in production source |
| `@public` / `@internal` on a TSDoc line | Machine-readable markers, explicitly budgeted — [`CODE_RULES.md`](./CODE_RULES.md) §5a |

**This table is extended, never replaced, by the application's own `docs/` review
doc.** A repository-specific pattern — an editor workaround, a documented gap, a fail-open
surface ratified under [`BOUNDARIES.md`](./BOUNDARIES.md) §5d — is recorded there with the same
two columns, and a reviewer reads both.
