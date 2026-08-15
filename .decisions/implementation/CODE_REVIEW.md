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

See [`CODE_REVIEW.md`](../governance/CODE_REVIEW.md) §1 for the review workflow, the green-baseline
requirement, and the finding format.

---

## 2. Blocking Invariants

These are forge's own invariants. **Any one of them blocks a merge regardless of severity
argument.**

| Invariant | Owner |
|---|---|
| No deprecation shim or backward-compatible path before v1.0.0 | `CLAUDE.md` |
| No hardcoded secret, key, or credential in source | §3c |
| `mod.ts` uses named exports only — no `export *` | [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §1b |
| No sibling-barrel import outside the two exemptions | [`NAMESPACES.md`](./NAMESPACES.md) §2 |
| Runtime namespaces use only Web APIs | [`LIBRARY_ARCHITECTURE.md`](../governance/LIBRARY_ARCHITECTURE.md) §1d |
| `valibot` is never imported outside the facade | [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1a |
| Security-critical paths fail closed | [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §5 |
| A state-changing route carries a CSRF guard | [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §3a |
| A security guard has both a pass and a fail test | [`TESTING.md`](./TESTING.md) §5a |
| No props interface types an icon as bare `ForgeIcon` or `ForgeIcon<string>` | §3b |
| No comment outside the permitted budget | [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5a |

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
| Barrel discipline, `export *` ban, export-map drift, `@public` symbols reaching their barrel | `bun run verify --only validate-exports` |
| Leaf/integration classification, undeclared cross-namespace imports, stale declared edges | `bun run verify --only validate-namespace-graph` |
| JSX pragma present and correct in every `.tsx` | `bun run verify --only validate-jsx` |
| Browser-only `ui/client` import reaching a Worker-executed `src/ui` file | `bun run verify --only validate-ssr-boundary` |
| No-sibling-barrel rule (biome `noRestrictedImports`) | `bun run verify --only lint` |
| Governing-doc import paths, numbering, references | `bun run verify --only validate-docs` |
| Tailwind `@source` coverage of every `src/ui/` directory | `bun run verify --only validate-css-sources` |
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
([`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §2c), so this should return nothing. **PCRE2
(`-P`) is required** — the default engine has no lookahead and will silently match everything.

**Web-APIs-only breach in a runtime namespace**

```bash
rg -n '\bBun\.|from "node:' src/ \
  --glob '!src/pkg/**' --glob '!src/cli/**' --glob '!src/assets/**' \
  --glob '!src/ui/assets/**' --glob '!src/**/cli/**'
```

*Triage:* the excluded paths are build-time tooling that runs on a developer's machine, never in
a Worker, and are exempt by design ([`LIBRARY_ARCHITECTURE.md`](../governance/LIBRARY_ARCHITECTURE.md) §1d).
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

**Widest-possible icon prop**

```bash
rg -n '\bicon\??:\s*ForgeIcon(<string>)?\s*[;,]' src/
```

*Triage:* every hit is a defect, and the fix is always to narrow the parameter to the glyph names
the component actually renders — `ForgeIcon<"chevron-down">`, or a `<N | "chevron-down">` threaded
from the props interface when the caller names one. `ForgeIcon<Name>` is a component type, so its
`name` prop is contravariant under `strictFunctionTypes`: the *narrow* declaration is the
*permissive* one, accepting both a narrow sheet and a wide one, while a bare `ForgeIcon` demands a
sheet that accepts every string and rejects the app sheet enumerating just its own symbols. A bare
`ForgeIcon` in a prop position is therefore never a deliberate widening, and it costs the consumer
either a cast or an unchecked glyph that renders an empty `<use>`. **The command is anchored to a
prop position** — `createIcon`'s own overloads return `ForgeIcon<string>` correctly, which is the
one shape a looser pattern picks up as a false positive.

**The unparameterised spelling never reaches review**: `ForgeIcon` declares no default for
`Name`, so `tsgo` rejects a bare `ForgeIcon` at the declaration site and the gate's `typecheck`
step fails before this command runs. The command stays because `ForgeIcon<string>` is still
spellable, still compiles, and is still always wrong in a prop position — catching that explicit
spelling is its remaining job.

**Unbudgeted comment** ([`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5a is the whole
budget; [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5b is what is deleted on sight)

```bash
rg -n '^\s*\*\s*@example' --glob 'src/**/*.ts*' --glob 'config/**/*.ts'
rg -UPn '/\*\*(?:[^*]|\*(?!/)){400,}\*/' --glob 'src/**/*.ts*'
rg -n '^\s*//\s*[-=*_]{3,}' --glob 'src/**/*.ts*'
rg -n '\b(TODO|FIXME|XXX)\b' --glob 'src/**/*.ts*'
rg -n '^\s*//\s*(const|let|function|return|import|export|if|await)\b' --glob 'src/**/*.ts*'
```

*Triage:* the third, fourth, and fifth have **no false-positive class** — every hit is a defect, in
a test file as readily as in production source. The other two do, and both were confirmed on a real
sweep:

- The first is anchored to `^\s*\*\s*@example` — a TSDoc continuation line — precisely because a
  bare `rg "@example"` matches the `you@example.com` in every email fixture in the repo, plus a
  `barrel-parse.test.ts` fixture that feeds the parser a literal `" * @example"` as **test input**.
  Deleting that string would delete the test. Never grep for the bare tag.
- The second needs `-P`: its lookahead is unsupported by the default engine, which errors rather
  than under-matching. Its 400-character threshold is a heuristic floor, not the rule — read each
  hit and keep the one sentence [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5a permits.
  It also matches **template-literal contents** that use
  comment syntax as their payload: `cf-env-registry.ts`'s `HEADER` is the banner the `gen:env`
  command emits into generated files, so shortening it would change generator output. A hit inside
  a backtick string is code, not a comment.

Restating-the-code and narration are not reachable by any command; they belong to §3c.

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. *Does any string look like a
key, token, or hex secret that is not obviously a test value?* A 64-char hex literal is fine in a
test and fatal in `src/*/config.ts`.

**Fail-closed posture.** Read every new `if` around a security dependency. *When the binding,
key, or header is absent, does the code return an error — or continue?* Silent continuation is
the defect ([`BOUNDARIES.md`](../governance/BOUNDARIES.md) §5a).

**Facade intent.** Read the changed `mod.ts`. *Does a new export widen the surface beyond what a
consumer needs, or leak a third-party type into forge's signature?*
([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §4a.)

**Namespace classification.** Read the new imports in the changed namespace. *Does this
introduce a cross-namespace edge that the classification does not declare?*
([`NAMESPACES.md`](./NAMESPACES.md) §4b.)

**Guard placement.** Read the controller, not the handler. *Is the guard in the action's
`middleware` array, or inline inside the handler?* Inline guards are invisible to a reader
auditing the route map ([`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §1b).

**Async lifetime.** Read every function whose returned promise reaches `executionCtx.waitUntil()`
or `Logger.flush()`. *Does the returned promise cover every piece of work the function started, or
only the headline one?* A `void work().catch(…)` branch is untracked, so the isolate may suspend
before it settles — the shape to look for is a probabilistic or opportunistic side task detached
from the promise the caller awaits ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §6).

---

## 4. Severity Calibration

See [`CODE_REVIEW.md`](../governance/CODE_REVIEW.md) §4 for severity calibration, and for the
deliberate asymmetry that makes excess prose Major and its absence Minor.

---

## 5. Verification Protocol

See [`CODE_REVIEW.md`](../governance/CODE_REVIEW.md) §5 for the verification protocol every finding
must survive before it is reported.

---

## 6. Valid Patterns — Do Not Flag

These look wrong and are correct. Each has been mistaken for a defect before.

| Pattern | Why it is correct |
|---|---|
| `new Forge<Env>()` in a test | `Forge` is exported from `src/app/mod.ts` with a public constructor. The no-bare-constructor rule targets *config holders* — [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §1d |
| `@y-core/forge/context` imported by a consumer | `context` **is** a public subpath. Any claim that it is internal is stale |
| A reference to `@y-core/forge/crypto` being absent | That subpath **never existed**. `crypto` is sealed-internal — [`NAMESPACES.md`](./NAMESPACES.md) §3b |
| `import { v } from "../validation/mod"` in forge source | One of the two sanctioned barrel exemptions — [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §2c |
| `import … from "../crypto/mod"` in forge source | The other sanctioned exemption |
| `*.test.ts` beside its source rather than in `tests/` | Co-location is the rule, not a lapse — [`TESTING.md`](../governance/TESTING.md) §2a |
| `node:fs` / `node:path` in `pkg`, `cli`, `assets`, `ui/assets` | Build-time tooling, exempt from Web-APIs-only — §3b |
| `export const X = "…"` at module scope | A constant is not mutable state — [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §1c |
| A mutable module-scope `WeakMap` / `Map` cache in `ui/client` | Browser-only modules are exempt from the zero-global-state rule — [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §1e. Keying on `Document` keeps it test-isolated without a reset export; live instance `inFlightStylesheets` in `src/ui/client/lazy.ts` |
| `contextVar` used inside forge source | It is the intended mechanism for a namespace's own accessors — [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §4a |
| `sideEffects` entries in `package.json` | A deliberate bundler hint — [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §4 |
| A non-null assertion in a test file | Permitted by the `**/*.test.ts` biome override, which sets `noNonNullAssertion: off`; the rule is `error` in production source |
| `ok` / `err` not following `create*` | The one documented naming exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1a |
| `serveObject` returning a `Response`, not a `Result` | A ratified boundary exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e |
| `Input` exported from both `ui/core` and `ui/controls` | Deliberate shadowing — [`NAMESPACES.md`](./NAMESPACES.md) §5b |
| `@public` / `@internal` on a TSDoc line | Machine-readable visibility markers, explicitly budgeted — [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5a |
| A one-line inline comment carrying an external *why* | The third budgeted form, subject to the four conditions in [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5a |
| A one-line note on an adversarial test fixture | The one test-side addition to the budget — [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5d |
