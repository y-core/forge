---
title: Code Review Standards
description: "How to review: the blocking invariants, tiered detection with a command per rule, severity calibration, the verification protocol, and known false positives."
---

# Code Review Standards

> Owns the review process: what blocks a merge, how to *detect* each violation rather than
> hand-inspect for it, how to calibrate severity, and which suspicious-looking patterns are
> correct.
>
> **This document restates no rule.** Every item below is either a `detect:` command or a link
> to the document that owns the rule. To know *why* a rule exists, follow the link.

---

## 0. Quick Reference

- §1 Review Workflow: what to do before and while reviewing
- §1a Pre-Review Preparation: establish a green baseline first
- §1b Review Output Format: the finding shape
- §2 Blocking Invariants: the violations that always block a merge
- §3 Detection by Tier: how each rule is actually checked
- §3a Tier 1 — Gated: rules a gate step already proves
- §3b Tier 2 — Ripgrep With Triage: where the commands live, and the triage classes each states
- §3c Tier 3 — Judgement: what to read when no command can decide
- §4 Severity Calibration: critical, major, minor, informational
- §5 Verification Protocol: prove a finding before reporting it
- §6 Valid Patterns — Do Not Flag: correct code that looks wrong

---

## 1. Review Workflow

### 1a. Pre-Review Preparation

1. **Establish a green baseline** — run the gate before reviewing, so pre-existing failures are
   not attributed to the change ([`TESTING.md`](./TESTING.md) §6).
2. Identify the affected namespaces and read their barrels — the public surface is where a
   change does lasting damage.
3. Work §2, then §3a → §3b → §3c. **Verify per §5 before reporting; classify per §4.**

### 1b. Review Output Format

    [FILE:LINE] ISSUE_TITLE
    Severity: Critical | Major | Minor | Informational
    What is wrong, and the consequence.

Group by file, then severity, critical first. **Name the consequence, not the rule** — a finding
that only cites a rule number gives the author nothing to weigh.

---

## 2. Blocking Invariants

**Any one of these blocks a merge regardless of severity argument.**

| Invariant | Owner |
|---|---|
| No deprecation shim or backward-compatible path before v1.0.0 | `CLAUDE.md` |
| No hardcoded secret, key, or credential in source | §3c |
| A barrel uses named exports only — no `export *` | [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §1b |
| No sibling-barrel import outside the named exemptions | [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §2 |
| Runtime namespaces use only Web APIs | [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §1d |
| A wrapped dependency is never imported outside its facade | [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §1a |
| Browser-only code is never imported from a Worker path | [`BOUNDARIES.md`](./BOUNDARIES.md) §1 |
| Security-critical paths fail closed | [`BOUNDARIES.md`](./BOUNDARIES.md) §5 |
| Untrusted input is validated at the boundary | [`BOUNDARIES.md`](./BOUNDARIES.md) §3 |
| No PII reaches a log record | [`BOUNDARIES.md`](./BOUNDARIES.md) §4 |
| A security guard has both a pass and a fail test | [`TESTING.md`](./TESTING.md) §5a |
| No comment outside the permitted budget | [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §5a |

**The pre-1.0 shim ban is the one most often argued away.** A published shim is unrecoverable:
once a consumer depends on it, removing it is a breaking change — which is precisely what a
pre-1.0 version number exists to avoid.

---

## 3. Detection by Tier

### 3a. Tier 1 — Gated

**A rule with a gate step is not a review item.** Do not hand-review these; run the gate and
read its output.

| Rule class | detect |
|---|---|
| Barrel discipline, `export *` ban, export-map drift | the export-validation step |
| Leaf/integration classification, undeclared or stale edges | the namespace-graph step |
| Governing-doc numbering, references, and registration | the docs step |
| Banned import patterns, including the no-sibling-barrel rule | the lint step |
| A browser-only import reaching a Worker-executed file | the SSR-boundary step, where one exists |
| Type correctness across every changed signature | the typecheck step |
| Behaviour of the changed unit | the test runner, scoped to the changed path |

The repository's step-list config names the current steps
([`TESTING.md`](./TESTING.md) §6a); the labels above are rule classes, not step names.

**If a Tier-1 check passes and you still believe the rule is violated, the check is wrong — fix
the check, not the review.** A review finding that a gate should have caught is a gate defect
first and a code defect second.

### 3b. Tier 2 — Ripgrep With Triage

**Every §2 invariant that no gate step proves carries a command in the repository's own
`implementation/` review document.** A rule detected by hand-inspection is a rule that gets
reviewed on the passes somebody remembered it, and the commands are written with the
repository's real package names, namespace directories, and exemption globs — which makes them
implementation by construction, and is why none of them lives here.

**Every command is written with its false-positive class, stated beside it. A command without
its triage note is worse than no command** — it gets run once, returns noise, and is never run
again. Three triage classes account for nearly all of them, and each dictates something about
how the command is written:

- **An exempt tier.** A rule that holds for runtime source but not for build-time tooling, or
  for production source but not for tests, needs its exemption in the command as exclusion
  globs. Without them the command returns dozens of legitimate hits and will be ignored — the
  exclusions are the difference between a command that is run and one that is not.
- **A regex engine that must be named.** A command using a lookahead requires PCRE2 (`-P`); the
  default engine either errors or silently matches everything, and the second failure mode is
  the one that produces a false green.
- **A pattern that also occurs as data.** A search for a marker matches the same marker inside a
  test fixture that feeds it in as **input**, and inside template-literal contents a generator
  emits into its output. Anchor the pattern narrowly, and read the hit before deleting anything:
  a hit inside a backtick string is code, not a comment.

A command whose threshold is numeric — a character count, a line count — is a **heuristic
floor, not the rule.** Read every hit against the rule the owning document states.

Violations reachable by no command at all — restating the code, narration, a judgement about
surface — belong to §3c.

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. *Does any string look like a
key, token, or hex secret that is not obviously a test value?* A 64-character hex literal is fine
in a test and fatal in a config module.

**Fail-closed posture.** Read every new conditional around a security dependency. *When the
binding, key, or header is absent, does the code return an error — or continue?* Silent
continuation is the defect ([`BOUNDARIES.md`](./BOUNDARIES.md) §5a).

**Facade intent.** Read the changed barrel. *Does a new export widen the surface beyond what a
consumer needs, or leak a third-party type into a library signature?*
([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §4a.)

**Namespace classification.** Read the new imports in the changed namespace. *Does this
introduce a cross-namespace edge the classification does not declare?*
([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §3b.)

**Guard placement.** Read the controller, not the handler. *Is the guard in the route's
middleware list, or inline inside the handler?* Inline guards are invisible to a reader auditing
the route map.

**Async lifetime.** Read every function whose returned promise reaches a `waitUntil` or a flush.
*Does the returned promise cover every piece of work the function started, or only the headline
one?* [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §6 owns the rule and the failure it
prevents.

**Test sufficiency.** For each new test, apply the deletion check: *if the mechanism this test
names were deleted, would it still pass?* ([`TESTING.md`](./TESTING.md) §3d.)

**Name reachability.** Read each new export. *Could a reader who knows the domain but not this
codebase name this symbol from the question it answers — and conversely, does the name carry a
word that earns nothing?* ([`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §7.)

---

## 4. Severity Calibration

- **Critical — blocks merge.** Any §2 invariant; a hardcoded secret; a missing guard on a
  state-changing endpoint; an unchecked error on a security-critical path.
- **Major — fix before merge.** A new export missing from its barrel; a security test missing
  its fail case; an undeclared cross-namespace edge; wrong entity encoding in an assertion; a
  route registered outside the declarative pattern; any gate step failing; a comment outside the
  [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §5a budget.
- **Minor — consider fixing.** An export with no TSDoc line at all; an imperative loop where an
  array method reads better; a name breaking the
  [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4b suffix convention.
- **Informational — note only.** Future namespace splits, alternative API designs, performance
  observations with no security impact.

**Excess prose is Major, absence is Minor — the asymmetry is deliberate.** A missing summary line
costs one read; an unbudgeted one is re-read on every pass, is reachable by no gate, and goes
stale silently. **Never report "expand this comment" as a finding.**

**Calibrate by consequence, not by effort.** A one-character fix to a fail-closed check is
Critical; a large refactor that improves readability is Minor.

---

## 5. Verification Protocol

Before reporting any finding:

1. **Read the whole file, not the diff** — the guard you think is missing is often three lines
   above the hunk.
2. **Check the lint and compiler configuration** before flagging style or a type pattern; most
   repositories override several defaults, and often differently in test files.
3. **Check the export map** before claiming a symbol is unexported or a subpath does not exist.
4. **Check the runtime** before flagging an API as unavailable — `crypto.subtle`, streams, and
   `URL` are all present in Workers.

**A finding you could not verify is a question, not a finding.** Report it as one.

---

## 6. Valid Patterns — Do Not Flag

These look wrong and are correct. Each has been mistaken for a defect before.

| Pattern | Why it is correct |
|---|---|
| A test file beside its source rather than in `tests/` | Co-location is the rule — [`TESTING.md`](./TESTING.md) §2a |
| `export const X = "…"` at module scope | A constant is not mutable state — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1c |
| A mutable module-scope cache in a browser-only module | Browser-only modules are exempt from zero-global-state — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1e |
| Node built-ins in build-time tooling | Exempt by reachability — [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §1e |
| A value constructor not following `create*` | The documented naming exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1a |
| An HTTP-boundary method returning a `Response`, not a `Result` | A ratified boundary exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e |
| A barrel import of a facade or sealed-internal module | A sanctioned exemption — [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §2c |
| Duplicated markup or constants across a leaf boundary | An accepted cost — [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §3e |
| The same symbol name exported from two barrels | Deliberate shadowing where a bound and unbound variant coexist |
| `@public` / `@internal` on a TSDoc line | Machine-readable markers, explicitly budgeted — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §5a |
| A one-line inline comment carrying an external *why* | The third budgeted form, under its four conditions — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §5a |
| A one-line note on an adversarial test fixture | The one test-side addition to the budget — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §5d |
| A non-null assertion in a test file | Permitted where the lint config relaxes it for tests; it stays an error in production source |

**This table is extended, never replaced, by the repository's own `implementation/` review
doc.** A repository-specific pattern — a named carve-out, a public constructor, a fail-open
surface ratified under [`BOUNDARIES.md`](./BOUNDARIES.md) §5c — is recorded there with the same
two columns, and a reviewer reads both.
