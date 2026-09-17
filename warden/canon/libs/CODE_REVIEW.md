---
title: Code Review Standards
description: "How to review: the blocking invariants, tiered detection with a command per rule, severity calibration, the verification protocol, and known false positives."
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
- §1a Pre-Review Preparation: establish a green baseline first
- §1b Review Output Format: the six fields a finding carries, impact first
- §2 Blocking Invariants: the violations that always block a merge
- §3 Detection by Tier: how each rule is actually checked
- §3a Tier 1 — Gated: rules a gate step already proves
- §3b Tier 2 — Ripgrep With Triage: where the commands live, and the triage classes each states
- §3c Tier 3 — Judgement: what to read when no command can decide
- §4 Severity Calibration: critical, major, minor, informational
- §5 Verification Protocol: try to disprove a finding; the default is reject
- §6 Valid Patterns — Do Not Flag: correct code that looks wrong

---

## 1. Review Workflow

### 1a. Pre-Review Preparation

1. **Establish a green baseline** — run the gate before reviewing, so pre-existing failures are not attributed to the change
   ([`TESTING.md`][testing-6] §6).
2. Identify the affected namespaces and read their barrels — the public surface is where a change does lasting damage.
3. Work §2, then §3a → §3b → §3c. **Verify per §5 before reporting; classify per §4.**

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
| No deprecation shim or backward-compatible path before v1.0.0 | `CLAUDE.md`, and the structure document it cites |
| No hardcoded secret, key, or credential in source | §3c |
| A barrel uses named exports only — no `export *` | [`NAMESPACE_DESIGN.md`][nd-1b] §1b |
| No sibling-barrel import outside the named exemptions | [`NAMESPACE_DESIGN.md`][nd-2] §2 |
| Runtime namespaces use only Web APIs | [`LIBRARY_ARCHITECTURE.md`][la-1d] §1d |
| A wrapped dependency is never imported outside its facade | [`LIBRARY_ARCHITECTURE.md`][la-1a] §1a |
| Browser-only code is never imported from a Worker path | [`BOUNDARIES.md`][boundaries-1] §1 |
| Security-critical paths fail closed | [`BOUNDARIES.md`][boundaries-5] §5 |
| Untrusted input is validated at the boundary | [`BOUNDARIES.md`][boundaries-3] §3 |
| No PII reaches a log record | [`BOUNDARIES.md`][boundaries-4] §4 |
| A security guard has both a pass and a fail test | [`TESTING.md`][testing-5a] §5a |
| No comment outside the permitted budget | [`CODE_RULES.md`][cr-5a] §5a |
| A behavioural claim deleted from a comment is landed as an assertion | [`CODE_RULES.md`][cr-5e] §5e, [`TESTING.md`][testing-3f] §3f |
| No interface field carries a gloss that spells its own name back | [`CODE_RULES.md`][cr-5f] §5f |

**The pre-1.0 shim ban is the one most often argued away.** A published shim is unrecoverable: once a consumer depends on it, removing it is a
breaking change — which is precisely what a pre-1.0 version number exists to avoid.

---

## 3. Detection by Tier

### 3a. Tier 1 — Gated

**A rule with a gate step is not a review item.** Do not hand-review these; run the gate and read its output.

| Rule class | detect |
| --- | --- |
| Barrel discipline, `export *` ban, export-map drift | the export-validation step |
| Leaf/integration classification, undeclared or stale edges | the namespace-graph step |
| Governing-doc numbering, references, and registration | the docs step |
| Banned import patterns, including the no-sibling-barrel rule | the lint step |
| A browser-only import reaching a Worker-executed file | the SSR-boundary step, where one exists |
| Type correctness across every changed signature | the typecheck step |
| Behaviour of the changed unit | the test runner, scoped to the changed path |

The repository's step-list config names the current steps ([`TESTING.md`][testing-6a] §6a); the labels above are rule classes, not step names.

**If a Tier-1 check passes and you still believe the rule is violated, the check is wrong — fix the check, not the review.** A review finding that a
gate should have caught is a gate defect first and a code defect second.

### 3b. Tier 2 — Ripgrep With Triage

**Every §2 invariant that no gate step proves carries a command in the repository's own `docs/` review document.** A rule detected by
hand-inspection is a rule that gets reviewed on the passes somebody remembered it, and the commands are written with the repository's real package
names, namespace directories, and exemption globs — which makes them implementation by construction, and is why none of them lives here.

**Every command is written with its false-positive class, stated beside it. A command without its triage note is worse than no command** — it gets
run once, returns noise, and is never run again. These triage classes account for nearly all of them, and each dictates something about how the
command is written:

- **An exempt tier.** A rule that holds for runtime source but not for build-time tooling, or for production source but not for tests, needs its
  exemption in the command as exclusion globs. Without them the command returns dozens of legitimate hits and will be ignored — the exclusions are
  the difference between a command that is run and one that is not.
- **A regex engine that must be named.** A command using a lookahead requires PCRE2 (`-P`); the default engine either errors or silently matches
  everything, and the second failure mode is the one that produces a false green.
- **A pattern that also occurs as data.** A search for a marker matches the same marker inside a test fixture that feeds it in as **input**, and
  inside template-literal contents a generator emits into its output. Anchor the pattern narrowly, and read the hit before deleting anything: a hit
  inside a backtick string is code, not a comment.

A command whose threshold is numeric — a character count, a line count — is a **heuristic floor, not the rule.** Read every hit against the rule the
owning document states.

**Where a repository wires a comment-budget gate step, the budget is Tier 1 and not a review item at all** — §3a governs it, and no command for it
belongs here. What the step cannot decide — whether a sentence earns its place — stays with §3c either way.

Violations reachable by no command at all — restating the code, narration, a judgement about surface — belong to §3c.

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. _Does any string look like a key, token, or hex secret that is not obviously a
test value?_ A 64-character hex literal is fine in a test and fatal in a config module.

**Fail-closed posture.** Read every new conditional around a security dependency. _When the binding, key, or header is absent, does the code return
an error — or continue?_ Silent continuation is the defect ([`BOUNDARIES.md`][boundaries-5a] §5a).

**Facade intent.** Read the changed barrel. _Does a new export widen the surface beyond what a consumer needs, or leak a third-party type into a
library signature?_ ([`LIBRARY_ARCHITECTURE.md`][la-4a] §4a.)

**Namespace classification.** Read the new imports in the changed namespace. _Does this introduce a cross-namespace edge the classification does not
declare?_ ([`NAMESPACE_DESIGN.md`][nd-3b] §3b.)

**Guard placement.** Read the controller, not the handler. _Is the guard in the route's middleware list, or inline inside the handler?_ Inline
guards are invisible to a reader auditing the route map.

**Async lifetime.** Read every function whose returned promise reaches a `waitUntil` or a flush. _Does the returned promise cover every piece of
work the function started, or only the headline one?_ [`LIBRARY_ARCHITECTURE.md`][la-6] §6 owns the rule and the failure it prevents.

**Test sufficiency.** For each new test, apply the deletion check: _if the mechanism this test names were deleted, would it still pass?_
([`TESTING.md`][testing-3d] §3d.)

**Name reachability.** Read each new export. _Could a reader who knows the domain but not this codebase name this symbol from the question it
answers — and conversely, does the name carry a word that earns nothing?_ ([`CODE_RULES.md`][cr-7] §7.)

**Prose that earns nothing.** Read every comment and every README paragraph in the diff. _Does this sentence say something the name, the type, the
signature, or a test does not?_ A per-field gloss, a per-symbol restatement, and a paragraph narrating how the code works are the same defect at
different scales ([`CODE_RULES.md`][cr-5b] §5b, [`AGENT_GUIDE.md`][ag-6c] §6c). Where the sentence asserts behaviour, the question is sharper:
_which test pins this?_ — and where none does, the finding is the missing assertion ([`CODE_RULES.md`][cr-5e] §5e).

**Net entropy.** Read the change as a whole, after the items above. _Is the repository more ordered for it, or less?_ A second way to do a thing
that had one, a rule nothing checks, a claim no test holds, or a pattern added beside the one it should have retired is entropy added, and a green
gate does not clear it. The reverse holds too: disorder fixed outside the change's footprint is a widened diff, not a merit
(`AGENT_WORKFLOW.md` §1b).

---

## 4. Severity Calibration

- **Critical — blocks merge.** Any §2 invariant; a hardcoded secret; a missing guard on a state-changing endpoint; an unchecked error on a
  security-critical path.
- **Major — fix before merge.** A new export missing from its barrel; a security test missing its fail case; an undeclared cross-namespace edge;
  wrong entity encoding in an assertion; a route registered outside the declarative pattern; any gate step failing; a comment outside the
  [`CODE_RULES.md`][cr-5a] §5a budget.
- **Minor — consider fixing.** An export with no TSDoc line at all; an imperative loop where an array method reads better; a name breaking the
  [`NAMESPACE_DESIGN.md`][nd-4b] §4b suffix convention.
- **Informational — note only.** Future namespace splits, alternative API designs, performance observations with no security impact.

**Excess prose is Major, absence is Minor — the asymmetry is deliberate.** A missing summary line costs one read; an unbudgeted one is re-read on
every pass, is reachable by no gate, and goes stale silently. **Never report "expand this comment" as a finding.**

**The asymmetry reaches README prose on the same terms.** A section restating a signature, narrating how the code works, or re-housing prose the
comment budget evicted is Major; a task a README does not yet teach is Minor. "Document this more fully" is not a finding.

**Calibrate by consequence, not by effort.** A one-character fix to a fail-closed check is Critical; a large refactor that improves readability is
Minor.

---

## 5. Verification Protocol

**The verification pass tries to disprove the finding, and the finding survives only if that attempt fails.** The default is reject. A review that
verifies by looking for confirmation will confirm almost everything it looked at, which is how a report arrives long, plausible and mostly wrong —
and a reader who finds two false positives stops trusting the other thirty.

Before reporting any finding:

1. **Read the whole file, not the diff** — the guard you think is missing is often three lines above the hunk.
2. **Check the lint and compiler configuration** before flagging style or a type pattern; most repositories override several defaults, and often
   differently in test files.
3. **Check the export map** before claiming a symbol is unexported or a subpath does not exist.
4. **Check the runtime** before flagging an API as unavailable — `crypto.subtle`, streams, and `URL` are all present in Workers.

**A finding you could not verify is a question, not a finding.** Report it as one.

---

## 6. Valid Patterns — Do Not Flag

These look wrong and are correct. Each has been mistaken for a defect before.

| Pattern | Why it is correct |
| --- | --- |
| A test file beside its source rather than in `tests/` | Co-location is the rule — [`TESTING.md`][testing-2a] §2a |
| `export const X = "…"` at module scope | A constant is not mutable state — [`CODE_RULES.md`][cr-1c] §1c |
| A mutable module-scope cache in a browser-only module | Browser-only modules are exempt from zero-global-state — [`CODE_RULES.md`][cr-1e] §1e |
| Node built-ins in build-time tooling | Exempt by reachability — [`LIBRARY_ARCHITECTURE.md`][la-1e] §1e |
| A value constructor not following `create*` | The documented naming exception — [`ERROR_HANDLING.md`][eh-1a] §1a |
| An HTTP-boundary method returning a `Response`, not a `Result` | A ratified boundary exception — [`ERROR_HANDLING.md`][eh-5e] §5e |
| A barrel import of a facade or sealed-internal module | A sanctioned exemption — [`NAMESPACE_DESIGN.md`][nd-2c] §2c |
| Duplicated markup or constants across a leaf boundary | An accepted cost — [`NAMESPACE_DESIGN.md`][nd-3e] §3e |
| The same symbol name exported from two barrels | Deliberate shadowing where a bound and unbound variant coexist |
| `@public` / `@internal` on a TSDoc line | Machine-readable markers, explicitly budgeted — [`CODE_RULES.md`][cr-5a] §5a |
| A one-line inline comment carrying an external _why_ | The third budgeted form, under its stated conditions — [`CODE_RULES.md`][cr-5a] §5a |
| A one-line note on an adversarial test fixture | The one test-side addition to the budget — [`CODE_RULES.md`][cr-5d] §5d |
| A non-null assertion in a test file | Permitted where the lint config relaxes it for tests; it stays an error in production source |

**This table is extended, never replaced, by the repository's own `docs/` review doc.** A repository-specific pattern — a named carve-out, a public
constructor, a fail-open surface ratified under [`BOUNDARIES.md`][boundaries-5c] §5c — is recorded there with the same two columns, and a reviewer
reads both.

[ag-6c]: ../shared/AGENT_GUIDE.md#6c-decisions-versus-usage--the-readme-boundary
[boundaries-1]: ./BOUNDARIES.md#1-ssr-versus-browser--the-hard-runtime-boundary
[boundaries-3]: ./BOUNDARIES.md#3-validate-at-the-boundary
[boundaries-4]: ./BOUNDARIES.md#4-no-pii-in-logs
[boundaries-5]: ./BOUNDARIES.md#5-fail-closed
[boundaries-5a]: ./BOUNDARIES.md#5a-fail-closed-on-missing-critical-context
[boundaries-5c]: ./BOUNDARIES.md#5c-recording-a-fail-open-exception
[cr-1c]: ../shared/CODE_RULES.md#1c-constants-are-acceptable
[cr-1e]: ../shared/CODE_RULES.md#1e-browser-only-modules-are-exempt
[cr-5a]: ../shared/CODE_RULES.md#5a-the-entire-permitted-budget
[cr-5b]: ../shared/CODE_RULES.md#5b-forbidden-outright
[cr-5d]: ../shared/CODE_RULES.md#5d-tests-are-not-exempt
[cr-5e]: ../shared/CODE_RULES.md#5e-a-behavioural-claim-is-an-assertion
[cr-5f]: ../shared/CODE_RULES.md#5f-a-field-is-a-symbol
[cr-7]: ../shared/CODE_RULES.md#7-name-distinctiveness-rule
[eh-1a]: ./ERROR_HANDLING.md#1a-the-unified-result-primitive
[eh-5e]: ./ERROR_HANDLING.md#5e-startup-invariants--resolvers-throw
[la-1a]: ./LIBRARY_ARCHITECTURE.md#1a-facade-over-dependencies
[la-1d]: ./LIBRARY_ARCHITECTURE.md#1d-web-apis-only-constraint
[la-1e]: ./LIBRARY_ARCHITECTURE.md#1e-the-build-time-exemption-is-reachability
[la-4a]: ./LIBRARY_ARCHITECTURE.md#4a-re-export-rules-for-facade-namespaces
[la-6]: ./LIBRARY_ARCHITECTURE.md#6-cloudflare-workers-runtime-model
[nd-1b]: ./NAMESPACE_DESIGN.md#1b-export-star-ban
[nd-2]: ./NAMESPACE_DESIGN.md#2-no-sibling-barrel-import-rule
[nd-2c]: ./NAMESPACE_DESIGN.md#2c-granting-an-exemption
[nd-3b]: ./NAMESPACE_DESIGN.md#3b-integration-namespace-rules
[nd-3e]: ./NAMESPACE_DESIGN.md#3e-duplication-across-a-leaf-boundary
[nd-4b]: ./NAMESPACE_DESIGN.md#4b-option-and-shape-type-suffixes
[testing-2a]: ./TESTING.md#2a-test-file-naming-convention
[testing-3d]: ./TESTING.md#3d-assert-the-mechanism-not-an-outcome-a-second-mechanism-also-guarantees
[testing-3f]: ./TESTING.md#3f-a-deleted-claim-lands-in-a-test
[testing-5a]: ./TESTING.md#5a-both-pass-and-fail-cases-required
[testing-6]: ./TESTING.md#6-the-verification-gate
[testing-6a]: ./TESTING.md#6a-one-command-three-modes
