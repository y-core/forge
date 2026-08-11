---
title: Code Review Standards
description: "How to review forge code: the blocking invariants, a detection command per rule, severity calibration, and the known false positives."
---

# Code Review Standards

> Owns the review process: what blocks a merge, how to *detect* each violation rather than
> hand-inspect for it, how to calibrate severity, and which suspicious-looking patterns are
> correct.
>
> **This document restates no rule.** Every item below is either a `detect:` command or a link
> to the document that owns the rule. If you want to know *why* a rule exists, follow the link.

---

## 0. Quick Reference

- §1 Review Workflow: what to do before and while reviewing
- §1a Pre-Review Preparation: establish a green baseline first
- §1b Review Output Format: the finding shape
- §2 Blocking Invariants: the violations that always block a merge
- §3 Detection by Tier: how each rule is actually checked
- §3a Tier 1 — Gated: rules a gate step already proves
- §3b Tier 2 — Ripgrep with Triage: commands and their false-positive classes
- §3c Tier 3 — Judgement: what to read when no command can decide
- §4 Severity Calibration: critical, major, minor, informational
- §5 Verification Protocol: prove a finding before reporting it
- §6 Valid Patterns — Do Not Flag: correct code that looks wrong

---

## 1. Review Workflow

### 1a. Pre-Review Preparation

1. **Establish a green baseline** — run the gate before reviewing, so pre-existing failures are
   not attributed to the change ([`TESTING.md`](./TESTING.md) §6).
2. Identify the affected namespaces and read their `mod.ts` files — the public surface is where
   a change does lasting damage.
3. Work §2, then §3a → §3b → §3c. **Verify per §5 before reporting; classify per §4.**

### 1b. Review Output Format

    [FILE:LINE] ISSUE_TITLE
    Severity: Critical | Major | Minor | Informational
    What is wrong, and the consequence.

Group by file, then severity, critical first.

---

## 2. Blocking Invariants

These are forge's own invariants. **Any one of them blocks a merge regardless of severity
argument.**

| Invariant | Owner |
|---|---|
| No deprecation shim or backward-compatible path before v1.0.0 | `CLAUDE.md` |
| No hardcoded secret, key, or credential in source | §3c |
| `mod.ts` uses named exports only — no `export *` | [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §1b |
| No sibling-barrel import outside the two exemptions | [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §2 |
| Runtime namespaces use only Web APIs | [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §1d |
| `valibot` is never imported outside the facade | [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1a |
| Security-critical paths fail closed | [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §4 |
| A state-changing route carries a CSRF guard | [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §3a |
| A security guard has both a pass and a fail test | [`TESTING.md`](./TESTING.md) §5a |

**The pre-1.0 shim ban is the one most often argued away.** A published shim is unrecoverable:
once a consumer depends on it, removing it is a breaking change, which is precisely what a
pre-1.0 version number exists to avoid.

---

## 3. Detection by Tier

### 3a. Tier 1 — Gated

**A rule with a gate step is not a review item.** Do not hand-review these; run the gate and
read its output.

| Rule | detect |
|---|---|
| Barrel discipline, `export *` ban, export-map drift, `@public` symbols reaching their barrel | `bun run check --only validate-exports` |
| Leaf/integration classification, undeclared cross-namespace imports, stale declared edges | `bun run check --only validate-namespace-graph` |
| JSX pragma present and correct in every `.tsx` | `bun run check --only validate-jsx` |
| No-sibling-barrel rule (biome `noRestrictedImports`) | `bun run check --only lint` |
| Governing-doc import paths, numbering, references | `bun run check --only validate-docs` |
| Tailwind `@source` coverage of every `src/ui/` directory | `bun run check --only validate-css-sources` |
| Behaviour of the changed unit | `bun test <path>` |

**If a Tier-1 check passes and you still believe the rule is violated, the check is wrong — fix
the check, not the review.**

### 3b. Tier 2 — Ripgrep with Triage

**Every command here has a known false-positive class, stated with it.** A command without its
triage note is worse than no command.

**Valibot facade breach**

```bash
rg -n 'from "valibot"|from \x27valibot\x27' src/ --glob '!src/validation/**'
```

*Triage:* any hit is a breach, including in a `*.test.ts`. A test that imports valibot directly
bypasses the facade exactly as production code would, and will not follow a version bump.

**Sibling-barrel import**

```bash
rg -nP 'from "\.\./(?!validation/mod|crypto/mod)[a-z-]+/mod"' src/
```

*Triage:* the negative lookahead already excludes the two sanctioned exemptions
([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §2c), so this should return nothing. **PCRE2
(`-P`) is required** — the default engine has no lookahead and will silently match everything.

**Web-APIs-only breach in a runtime namespace**

```bash
rg -n '\bBun\.|from "node:' src/ \
  --glob '!src/pkg/**' --glob '!src/cli/**' --glob '!src/assets/**' \
  --glob '!src/ui/assets/**' --glob '!src/**/cli/**'
```

*Triage:* the excluded paths are build-time tooling that runs on a developer's machine, never in
a Worker, and are exempt by design ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §1d).
**Without those globs the command returns dozens of legitimate hits and will be ignored.** A hit
in any other namespace is a genuine runtime-portability break.

**Timer handle not cleared by its disposer**

```bash
rg -n 'setTimeout\(|setInterval\(' src/ui/client/
```

*Triage:* a hit is only a defect if the handle it returns is not cleared in the module's disposer
— **read the disposer, not the call site**
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2d). A timer paired with a poll must also be
cleared when the poll **succeeds**, not only when it times out.

**Substring assertion on rendered HTML**

```bash
rg -n 'toContain\(|toMatch\(' src/ --glob '*.test.ts*'
```

*Triage:* legitimate on non-HTML strings — an error message, a log line, a SQL fragment. **A hit
asserting on rendered markup is a defect** ([`TESTING.md`](./TESTING.md) §3b).

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. *Does any string look like a
key, token, or hex secret that is not obviously a test value?* A 64-char hex literal is fine in a
test and fatal in `src/*/config.ts`.

**Fail-closed posture.** Read every new `if` around a security dependency. *When the binding,
key, or header is absent, does the code return an error — or continue?* Silent continuation is
the defect ([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §4a).

**Facade intent.** Read the changed `mod.ts`. *Does a new export widen the surface beyond what a
consumer needs, or leak a third-party type into forge's signature?*
([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §4a.)

**Namespace classification.** Read the new imports in the changed namespace. *Does this
introduce a cross-namespace edge that the classification does not declare?*
([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4b.)

**Guard placement.** Read the controller, not the handler. *Is the guard in the action's
`middleware` array, or inline inside the handler?* Inline guards are invisible to a reader
auditing the route map ([`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §1b).

**Async lifetime.** Read every function whose returned promise reaches `executionCtx.waitUntil()`
or `Logger.flush()`. *Does the returned promise cover every piece of work the function started, or
only the headline one?* A `void work().catch(…)` branch is untracked, so the isolate may suspend
before it settles — as a probabilistic purge detached from the write promise did in
`src/logging/kv-channel.ts` ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §6).

---

## 4. Severity Calibration

- **Critical — blocks merge.** Any §2 invariant; a hardcoded secret; a missing guard on a
  state-changing endpoint; an unchecked error on a security-critical path.
- **Major — fix before merge.** A new export missing from its barrel; a security test missing
  its fail case; an undeclared cross-namespace edge; wrong entity encoding in an assertion; a
  route registered outside the map + controller pattern; any gate step failing.
- **Minor — consider fixing.** Missing TSDoc on an export; an imperative loop where an array
  method reads better; a name that breaks the [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5e
  suffix convention.
- **Informational — note only.** Future namespace splits, alternative API designs, performance
  observations with no security impact.

**Calibrate by consequence, not by effort.** A one-character fix to a fail-closed check is
Critical; a large refactor that improves readability is Minor.

---

## 5. Verification Protocol

Before reporting any finding:

1. **Read the whole file, not the diff** — the guard you think is missing is often three lines
   above the hunk.
2. **Check `biome.json` and `tsconfig.json`** before flagging style or a type pattern; forge
   overrides several defaults, including in test files.
3. **Check `package.json` `exports`** before claiming a symbol is unexported or a subpath does
   not exist.
4. **Check the Workers runtime** before flagging an API as unavailable — `crypto.subtle`,
   streams, and `URL` are all present.

**A finding you could not verify is a question, not a finding.** Report it as one.

---

## 6. Valid Patterns — Do Not Flag

These look wrong and are correct. Each has been mistaken for a defect before.

| Pattern | Why it is correct |
|---|---|
| `new Forge<Env>()` in a test | `Forge` is exported from `src/app/mod.ts` with a public constructor. The no-bare-constructor rule targets *config holders* — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1d |
| `@y-core/forge/context` imported by a consumer | `context` **is** a public subpath. Any claim that it is internal is stale |
| A reference to `@y-core/forge/crypto` being absent | That subpath **never existed**. `crypto` is sealed-internal — [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §3b |
| `import { v } from "../validation/mod"` in forge source | One of the two sanctioned barrel exemptions — [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §2c |
| `import … from "../crypto/mod"` in forge source | The other sanctioned exemption |
| `*.test.ts` beside its source rather than in `tests/` | Co-location is the rule, not a lapse — [`TESTING.md`](./TESTING.md) §2a |
| `node:fs` / `node:path` in `pkg`, `cli`, `assets`, `ui/assets` | Build-time tooling, exempt from Web-APIs-only — §3b |
| `export const X = "…"` at module scope | A constant is not mutable state — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1c |
| A mutable module-scope `WeakMap` / `Map` cache in `ui/client` | Browser-only modules are exempt from the zero-global-state rule — [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1e. Keying on `Document` keeps it test-isolated without a reset export; live instance `inFlightStylesheets` in `src/ui/client/lazy.ts` |
| `contextVar` used inside forge source | It is the intended mechanism for a namespace's own accessors — [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §4a |
| `sideEffects` entries in `package.json` | A deliberate bundler hint — [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §4 |
| A non-null assertion in a test file | Permitted by the `**/*.test.ts` biome override, which sets `noNonNullAssertion: off`; the rule is `error` in production source |
| `ok` / `err` not following `create*` | The one documented naming exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1a |
| `serveObject` returning a `Response`, not a `Result` | A ratified boundary exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e |
| `Input` exported from both `ui/core` and `ui/controls` | Deliberate shadowing — [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5b |
