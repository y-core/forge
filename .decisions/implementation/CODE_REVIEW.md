---
title: Code Review Standards
description: "How to review forge code: the blocking invariants, a detection command per rule, severity calibration, and the known false positives."
---

# Code Review Standards

> Owns the review process: what blocks a merge, how to _detect_ each violation rather than
> hand-inspect for it, how to calibrate severity, and which suspicious-looking patterns are
> correct.
>
> **This document restates no rule.** Every item below is either a `detect:` command or a link
> to the document that owns the rule. If you want to know _why_ a rule exists, follow the link.

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
- §7 The oxlint Rule Set: why `suspicious` is off and which of its rules are named individually
- §7a Why `categories.suspicious` is off: the default-deny, and the three rules that dominate its volume
- §7b The two rules taken from it: what `preserve-caught-error` and `no-shadow` caught
- §7c Why `jsx-a11y` is on, and what it does not see: the one rule off, the two site suppressions, the named blind spots, and the vocabulary-versus-composition split

---

## 1. Review Workflow

See [`CODE_REVIEW.md`](../governance/CODE_REVIEW.md) §1 for the review workflow, the green-baseline
requirement, and the finding format.

---

## 2. Blocking Invariants

These are forge's own invariants. **Any one of them blocks a merge regardless of severity
argument.**

| Invariant                                                                   | Owner                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| No deprecation shim or backward-compatible path before v1.0.0               | `CLAUDE.md`                                                            |
| No hardcoded secret, key, or credential in source                           | §3c                                                                    |
| `mod.ts` uses named exports only — no `export *`                            | [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §1b         |
| No sibling-barrel import outside the two exemptions                         | [`NAMESPACES.md`](./NAMESPACES.md) §2                                  |
| Runtime namespaces use only Web APIs                                        | [`LIBRARY_ARCHITECTURE.md`](../governance/LIBRARY_ARCHITECTURE.md) §1d |
| `valibot` is never imported outside the facade                              | [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1a                     |
| Security-critical paths fail closed                                         | [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §5                      |
| A state-changing route carries a CSRF guard                                 | [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §3a                     |
| A security guard has both a pass and a fail test                            | [`TESTING.md`](./TESTING.md) §5a                                       |
| No props interface types an icon as bare `ForgeIcon` or `ForgeIcon<string>` | §3b                                                                    |
| No comment outside the permitted budget                                     | [`CODE_RULES.md`](../governance/CODE_RULES.md) §5a                     |

**The pre-1.0 shim ban is the one most often argued away.** A published shim is unrecoverable:
once a consumer depends on it, removing it is a breaking change, which is precisely what a
pre-1.0 version number exists to avoid.

---

## 3. Detection by Tier

### 3a. Tier 1 — Gated

**A rule with a gate step is not a review item.** Do not hand-review these; run the gate and
read its output.

| Rule                                                                                                                                                                                                                                                                                                                                         | detect                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Barrel discipline, `export *` ban, export-map drift, `@public` symbols reaching their barrel                                                                                                                                                                                                                                                 | `bun run verify --only validate-exports`         |
| Leaf/integration classification, undeclared cross-namespace imports, stale declared edges                                                                                                                                                                                                                                                    | `bun run verify --only validate-namespace-graph` |
| JSX pragma present and correct in every `.tsx`                                                                                                                                                                                                                                                                                               | `bun run verify --only validate-jsx`             |
| A literal `data-slot` written before a bare-identifier spread                                                                                                                                                                                                                                                                                | `bun run verify --only lint`                     |
| Browser-only `ui/client` import reaching a Worker-executed `src/ui` file                                                                                                                                                                                                                                                                     | `bun run verify --only validate-ssr-boundary`    |
| No-sibling-barrel rule (oxlint `no-restricted-imports`)                                                                                                                                                                                                                                                                                      | `bun run verify --only lint`                     |
| Governing-doc import paths, numbering, references                                                                                                                                                                                                                                                                                            | `bun run verify --only validate-docs`            |
| `src/ui/README.md` export tables against the barrels they document, both directions                                                                                                                                                                                                                                                          | `bun run verify --only validate-readme-exports`  |
| Tailwind `@source` coverage of every `src/ui/` directory                                                                                                                                                                                                                                                                                     | `bun run verify --only validate-css-sources`     |
| Every corpus rule the plugin owns — the markup family (`forge-ui-a11y-*`, `-no-inline-style`, `-no-nested-card`, `-catalog-wrong-raw-input`) and the class-string family (`-spacing-scale-only`, `-color-token-only`, `-color-theme-no-raw-utility`, `-reduced-motion`, `-focus-ring`, `-interaction-focus-visible`, the four `-platform-*`) | `bun run verify --only lint`                     |
| The corpus against forge's API, and both rule registers against the plugin                                                                                                                                                                                                                                                                   | `bun run verify --only validate-design`          |
| ARIA vocabulary validity — attribute names, role names, value shapes                                                                                                                                                                                                                                                                         | `bun run verify --only lint`                     |
| Behaviour of the changed unit                                                                                                                                                                                                                                                                                                                | `bun test <path>`                                |

**If a Tier-1 check passes and you still believe the rule is violated, the check is wrong — fix
the check, not the review.**

### 3b. Tier 2 — Ripgrep with Triage

**Every command here has a known false-positive class, stated with it.** A command without its
triage note is worse than no command.

**Hand-spelled focus ring or disabled paint in `src/ui`**

```bash
rg -n 'focus-visible:ring-2|has-\[:focus-visible\]:ring|peer-focus-visible:ring|disabled:opacity-50|has-\[:disabled\]:opacity' src/ui --glob '!*.test.*' --glob '!forge-ui.css'
```

_Triage:_ any hit is a component re-spelling a recipe `forge-ui.css` publishes as an `@utility`
(`focus-ring`, `state-disabled`, `state-invalid`, `state-busy`, `field-chrome`) — see
[`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §3h. The one legitimate spelling that is not a
hit is `Switch`'s `peer-focus-visible:ring-2` on the track, which reaches across a sibling that
`&:has()` cannot; it is excluded by the `!forge-ui.css` glob only because the utility itself lives
there. The design corpus under `src/ui/design` is excluded by the same reasoning as every other
Tier 2 command.

**Valibot facade breach**

```bash
rg -n 'from "valibot"|from \x27valibot\x27' src/ --glob '!src/validation/**'
```

_Triage:_ any hit is a breach, including in a `*.test.ts`. A test that imports valibot directly
bypasses the facade exactly as production code would, and will not follow a version bump.

**Sibling-barrel import**

```bash
rg -nP 'from "\.\./(?!validation/mod|crypto/mod)[a-z-]+/mod"' src/
```

_Triage:_ the negative lookahead already excludes the two sanctioned exemptions
([`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §2c), so this should return nothing. **PCRE2
(`-P`) is required** — the default engine has no lookahead and will silently match everything.

**Web-APIs-only breach in a runtime namespace**

```bash
rg -n '\bBun\.|from "node:' src/ \
  --glob '!src/tooling/**' --glob '!src/ui/assets/build/**' \
  --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.browser.ts' --glob '!**/*.md'
```

_Triage:_ `src/tooling/` is the build-time container — membership _is_ the exemption
([`NAMESPACES.md`](./NAMESPACES.md) §4a) — and `ui/assets/build` is the one runtime-owned namespace
that carries the same exemption behind its own subpath. Tests and `.browser.ts` specs run under Bun
or Playwright, never in a Worker. **Without those globs the command returns dozens of legitimate
hits and will be ignored.** A hit anywhere else is a genuine runtime-portability break.

_The direction that matters most is already a gate step._ `validate-build-time-boundary` fails any
runtime module that imports a build-time one, so a review does not have to find that by hand; run
this command for the case the step cannot see — a Node API used **inside** a runtime namespace
without an import crossing any boundary.

**Timer handle not cleared by its disposer**

```bash
rg -n 'setTimeout\(|setInterval\(' src/ui/client/
```

_Triage:_ a hit is only a defect if the handle it returns is not cleared in the module's disposer
— **read the disposer, not the call site**
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2d). A timer paired with a poll must also be
cleared when the poll **succeeds**, not only when it times out.

**Substring assertion on rendered HTML**

```bash
rg -n 'toContain\(|toMatch\(' src/ --glob '*.test.ts*'
```

_Triage:_ legitimate on non-HTML strings — an error message, a log line, a SQL fragment. **A hit
asserting on rendered markup is a defect** ([`TESTING.md`](./TESTING.md) §3b).

**Widest-possible icon prop**

```bash
rg -n '\bicon\??:\s*ForgeIcon(<string>)?\s*[;,]' src/
```

_Triage:_ every hit is a defect, and the fix is always to narrow the parameter to the glyph names
the component actually renders — `ForgeIcon<"chevron-down">`, or a `<N | "chevron-down">` threaded
from the props interface when the caller names one. `ForgeIcon<Name>` is a component type, so its
`name` prop is contravariant under `strictFunctionTypes`: the _narrow_ declaration is the
_permissive_ one, accepting both a narrow sheet and a wide one, while a bare `ForgeIcon` demands a
sheet that accepts every string and rejects the app sheet enumerating just its own symbols. A bare
`ForgeIcon` in a prop position is therefore never a deliberate widening, and it costs the consumer
either a cast or an unchecked glyph that renders an empty `<use>`. **The command is anchored to a
prop position** — `createIcon`'s own overloads return `ForgeIcon<string>` correctly, which is the
one shape a looser pattern picks up as a false positive.

**The unparameterised spelling never reaches review**: `ForgeIcon` declares no default for
`Name`, so `tsc` rejects a bare `ForgeIcon` at the declaration site and the gate's `typecheck`
step fails before this command runs. The command stays because `ForgeIcon<string>` is still
spellable, still compiles, and is still always wrong in a prop position — catching that explicit
spelling is its remaining job.

**Unbudgeted comment** ([`CODE_RULES.md`](../governance/CODE_RULES.md) §5a is the whole
budget; [`CODE_RULES.md`](../governance/CODE_RULES.md) §5b is what is deleted on sight)

```bash
rg -n '^\s*\*\s*@example' --glob 'src/**/*.ts*' --glob 'config/**/*.ts'
rg -UPn '/\*\*(?:[^*]|\*(?!/)){400,}\*/' --glob 'src/**/*.ts*' --glob 'config/**/*.ts'
rg -n '^\s*//\s*[-=*_]{3,}' --glob 'src/**/*.ts*' --glob 'config/**/*.ts'
rg -n '\b(TODO|FIXME|XXX)\b' --glob 'src/**/*.ts*' --glob 'config/**/*.ts'
rg -n '^\s*//\s*(const|let|function|return|import|export|if|await)\b' --glob 'src/**/*.ts*' --glob 'config/**/*.ts'
rg -Un --multiline '(?:^[ \t]*//[^\n]*\n){3,}' --glob 'src/**/*.ts*' --glob 'config/**/*.ts'
```

**Every command carries `--glob 'config/**/*.ts'`.** Only the first did until the September 2026
sweep, and `config/steps.ts` — the file with the most `//` runs in the repository — was therefore
scanned by nothing.

_Triage:_ the third, fourth, and fifth have **no false-positive class** — every hit is a defect, in
a test file as readily as in production source. The other three do, and all were confirmed on a real
sweep:

- The first is anchored to `^\s*\*\s*@example` — a TSDoc continuation line — precisely because a
  bare `rg "@example"` matches the `you@example.com` in every email fixture in the repo, plus a
  `barrel-parse.test.ts` fixture that feeds the parser a literal `" * @example"` as **test input**.
  Deleting that string would delete the test. Never grep for the bare tag.
- The second needs `-P`: its lookahead is unsupported by the default engine, which errors rather
  than under-matching. Its 400-character threshold is a heuristic floor, not the rule — read each
  hit and keep the one sentence [`CODE_RULES.md`](../governance/CODE_RULES.md) §5a permits.
  It also matches **template-literal contents** that use
  comment syntax as their payload: `cf-env-registry.ts`'s `HEADER` is the banner the `gen:env`
  command emits into generated files, so shortening it would change generator output. A hit inside
  a backtick string is code, not a comment.
- The sixth is the run-length detector: three or more consecutive `//` lines.
  [`CODE_RULES.md`](../governance/CODE_RULES.md) §5a form 3 caps an inline _why_ at
  **one or two lines**, so a longer run is over budget by construction and no other
  command sees it. Its one false-positive class is the **upstream attribution header** — the
  MIT/ISC notice at the top of `cli/term/{capability,codes,color,width}.ts` and
  `cli/core/tokenize.ts`. A licence notice is a legal requirement, not prose written for the
  reader, and it is never shortened. Three _separate_ one-line comments on adjacent lines also
  match; read the hit before cutting.

Restating-the-code and narration are not reachable by any command; they belong to §3c.

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. _Does any string look like a
key, token, or hex secret that is not obviously a test value?_ A 64-char hex literal is fine in a
test and fatal in `src/*/config.ts`.

**Fail-closed posture.** Read every new `if` around a security dependency. _When the binding,
key, or header is absent, does the code return an error — or continue?_ Silent continuation is
the defect ([`BOUNDARIES.md`](../governance/BOUNDARIES.md) §5a).

**Facade intent.** Read the changed `mod.ts`. _Does a new export widen the surface beyond what a
consumer needs, or leak a third-party type into forge's signature?_
([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §4a.)

**Namespace classification.** Read the new imports in the changed namespace. _Does this
introduce a cross-namespace edge that the classification does not declare?_
([`NAMESPACES.md`](./NAMESPACES.md) §4b.)

**Guard placement.** Read the controller, not the handler. _Is the guard in the action's
`middleware` array, or inline inside the handler?_ Inline guards are invisible to a reader
auditing the route map ([`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §1b).

**Async lifetime.** Read every function whose returned promise reaches `executionCtx.waitUntil()`
or `Logger.flush()`. _Does the returned promise cover every piece of work the function started, or
only the headline one?_ A `void work().catch(…)` branch is untracked, so the isolate may suspend
before it settles — the shape to look for is a probabilistic or opportunistic side task detached
from the promise the caller awaits ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §6).

**The ten unchecked a11y rule ids.** Read every added or changed `.tsx` under `src/ui/`. _Does the
markup meet each of these ids, none of which any gate step proves?_ The eight that are gated are
§3a's; these ten are the remainder, and the reason each has no command is recorded below so it is
not re-derived. Their sentences are
[`floor.md`](../../src/ui/design/floor.md) and
[`reference/10-accessibility.md`](../../src/ui/design/reference/10-accessibility.md); the corpus
publishes them either way ([`UI_DESIGN_GUIDANCE.md`](./UI_DESIGN_GUIDANCE.md) §4a).

| Rule id                             | Why no command decides it                                                                                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forge-ui-accessible-name`          | The name depends on the rendered subtree and on component internals a source scan cannot follow                                                                                                                                                                         |
| `forge-ui-heading-order`            | Order is a property of the rendered document, not of one file — `compositions.tsx` correctly writes three `<h3>`s before its `<h2>`                                                                                                                                     |
| `forge-ui-hit-target`               | Needs to know which element is interactive and what the unspecified axis resolves to at render                                                                                                                                                                          |
| `forge-ui-not-color-alone`          | Turns on whether an icon and words _also_ convey the state                                                                                                                                                                                                              |
| `forge-ui-a11y-icon-plus-text`      | Preferred form and permitted alternative are the same shape in source — the 25 `aria-label` sites in `show/components.tsx` alone would fire                                                                                                                             |
| `forge-ui-a11y-label-element`       | The trigger is "the design has no room for a visible label", a fact about the design and not about the markup                                                                                                                                                           |
| `forge-ui-a11y-required-marker`     | `Label`'s `required` prop already emits the marker, so no residual shape is left to match                                                                                                                                                                               |
| `forge-ui-a11y-reduced-motion-pair` | Depends on whether the settled state is already the untransitioned default                                                                                                                                                                                              |
| `forge-ui-a11y-spinner-announces`   | Scoped to "the region", a boundary source text does not delimit                                                                                                                                                                                                         |
| `forge-ui-a11y-state-attrs-source`  | **A mechanical form exists** — an `aria-*` Tailwind variant naming a state `STATE_ATTRS` registers — and is unadopted only because it fires twice on `TAB_BASE` in `src/ui/core/tabs.tsx`, line 73. When that site changes, the finder lands and this line moves to §3a |

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

| Pattern                                                                                          | Why it is correct                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new Forge<Env>()` in a test                                                                     | `Forge` is exported from `src/app/mod.ts` with a public constructor. The no-bare-constructor rule targets _config holders_ — [`CODE_RULES.md`](../governance/CODE_RULES.md) §1d                                                                          |
| `@y-core/forge/context` imported by a consumer                                                   | `context` **is** a public subpath. Any claim that it is internal is stale                                                                                                                                                                                |
| A reference to `@y-core/forge/crypto` being absent                                               | That subpath **never existed**. `crypto` is sealed-internal — [`NAMESPACES.md`](./NAMESPACES.md) §3b                                                                                                                                                     |
| `import { v } from "../validation/mod"` in forge source                                          | One of the two sanctioned barrel exemptions — [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §2c                                                                                                                                             |
| `import … from "../crypto/mod"` in forge source                                                  | The other sanctioned exemption                                                                                                                                                                                                                           |
| `*.test.ts` beside its source rather than in `tests/`                                            | Co-location is the rule, not a lapse — [`TESTING.md`](../governance/TESTING.md) §2a                                                                                                                                                                      |
| `node:fs` / `node:path` under `src/tooling/` or in `ui/assets/build`                             | Build-time tooling, exempt from Web-APIs-only — §3b                                                                                                                                                                                                      |
| `export const X = "…"` at module scope                                                           | A constant is not mutable state — [`CODE_RULES.md`](../governance/CODE_RULES.md) §1c                                                                                                                                                                     |
| A mutable module-scope `WeakMap` / `Map` cache in `ui/client`                                    | Browser-only modules are exempt from the zero-global-state rule — [`CODE_RULES.md`](../governance/CODE_RULES.md) §1e. Keying on `Document` keeps it test-isolated without a reset export; live instance `inFlightStylesheets` in `src/ui/client/lazy.ts` |
| `contextVar` used inside forge source                                                            | It is the intended mechanism for a namespace's own accessors — [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §4a                                                                                                                            |
| `sideEffects` entries in `package.json`                                                          | A deliberate bundler hint — [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §4                                                                                                                                                                          |
| A non-null assertion in a test file                                                              | Permitted by the `**/*.test.ts` oxlint override, which sets `typescript/no-non-null-assertion: off`; the rule is `error` in production source                                                                                                            |
| `ok` / `err` not following `create*`                                                             | The one documented naming exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1a                                                                                                                                                                     |
| `serveObject` returning a `Response`, not a `Result`                                             | A ratified boundary exception — [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e                                                                                                                                                                           |
| `Input` exported from both `ui/core` and `ui/controls`                                           | Deliberate shadowing — [`NAMESPACES.md`](./NAMESPACES.md) §5b                                                                                                                                                                                            |
| `@public` / `@internal` on a TSDoc line                                                          | Machine-readable visibility markers, explicitly budgeted — [`CODE_RULES.md`](../governance/CODE_RULES.md) §5a                                                                                                                                            |
| A one-line inline comment carrying an external _why_                                             | The third budgeted form, subject to the four conditions in [`CODE_RULES.md`](../governance/CODE_RULES.md) §5a                                                                                                                                            |
| A one-line note on an adversarial test fixture                                                   | The one test-side addition to the budget — [`CODE_RULES.md`](../governance/CODE_RULES.md) §5d                                                                                                                                                            |
| A `page.evaluate` callback whose destructured parameter repeats an outer name                    | The callback runs in the browser realm and _cannot_ close over the Node-side binding; the repeated name is what documents the marshalled argument — §7b                                                                                                  |
| `[--tone:var(--color-…)]` arbitrary-property classes, and `bg-(--tone)` reading them             | The tone mechanism, not a stray arbitrary value: `toneVariants` sets the properties and one recipe per appearance reads them — [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §3h                                                                      |
| `state-invalid` or `cursor-pointer` passed as a separate `cn` argument, outside the base literal | Not an untidy call: the narrower recipe's group is a subset of an earlier one's, so folding it into the literal deletes it — [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §3h                                                                        |
| `data-size` on `Avatar`, `Turnstile`, or a field control                                         | A presentational attribute carrying a chosen value, not a state hook — it is declared beside the state table rather than in it — [`STATE_ATTRIBUTES.md`](./STATE_ATTRIBUTES.md) §2                                                                       |

---

## 7. The oxlint Rule Set

### 7a. Why `categories.suspicious` is off

`.oxlintrc.json` enables `correctness` as a category and names every other rule individually.
That is a deliberate default-deny, for two reasons.

**A category is a standing subscription to oxc's editorial judgement.** `lintStep` is published
through `src/tooling/gate/mod.ts`, so a rule oxc moves into `suspicious` would fail the gate of every
consumer app that builds its table from forge's preset, on the next install and with no changelog
entry of forge's own. Naming rules individually makes an oxlint upgrade inert until someone reads
its changelog and chooses.

**It buys no Biome parity, and its volume says nothing about this codebase.** Of 357 findings
measured at migration time, 312 came from three rules that collide with forge's own design:

| Rule                                  | n   | Why it is wrong here                                                                                                            |
| ------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------- |
| `unicorn/consistent-function-scoping` | 132 | 120 are test helpers declared inside a `describe` — the co-location idiom [`TESTING.md`](../governance/TESTING.md) §2a mandates |
| `unicorn/no-array-sort`               | 95  | Nudges `toSorted()`, but many sites are `[...map.keys()].sort()` — already a fresh array, so the rewrite copies twice           |
| `eslint/no-underscore-dangle`         | 85  | Flags the `__env` / `__flag` config _wire-format_ keys and valibot's `null_`; "fixing" them breaks consumer config files        |

`import/no-unassigned-import` (6) flags exactly the paths listed in `package.json` `sideEffects`
(§6). The rest of the tail is single-digit and false-positive-dominated.

### 7b. The two rules taken from it

| Rule                           | What it caught                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eslint/preserve-caught-error` | One site rethrowing with the message interpolated and no `cause`, discarding the original stack                                                                             |
| `eslint/no-shadow`             | Locals shadowing an imported or same-module symbol the file also calls — `err` from `result` inside a `catch` in `csrf.ts`, and the exported `env()` builder in `config.ts` |

`no-shadow`'s only sanctioned exception is the cross-realm `page.evaluate` case in §6.

**Type-aware rules are configured in the same file but only run under `lint:types`** — see
[`TESTING.md`](./TESTING.md) §6 for which tier that step runs from.

### 7c. Why `jsx-a11y` is on, and what it does not see

The plugin is enabled and every one of its 35 rules runs under `correctness`. Measured over
`src/` and `config/` before adoption, it produced **9 findings and zero real defects**: six were
correct ARIA the rules mis-advise, three were adversarial markup in test fixtures.

**Unlike §7a's default-deny, a category is the right unit here** — and the reach is narrower than
§7a's argument implies. `.oxlintrc.json` is not in `package.json`'s `files` array, so it does not
ship. A consumer inherits the _invocation_ (`lintStep` → `oxlint --deny-warnings`) and writes its
own rule table, so an oxc editorial change to `jsx-a11y` reaches forge's tree only, not every
consumer's. Against that, the 35 rules are a fixed W3C vocabulary rather than a style opinion, and
they cost nothing today.

**One rule is off.** `prefer-tag-over-role` proposes `<output>` for `role="status"` and
`address, details, fieldset, hgroup, optgroup` for `role="group"` — substitutions that change the
element's meaning. It is off rather than suppressed per-site because it is the one rule that
_recurs_: every future correct `role="status"` would owe a fresh suppression. Three rules are off
for `*.test.{ts,tsx}` only — `control-has-associated-label`, `tabindex-no-positive`,
`aria-proptypes` — because feeding a linter's own bad input is what those tests are for
([`TESTING.md`](../governance/TESTING.md)).

**Two sites carry a written suppression**, both load-bearing and both proven so by
`report-unused-disable-directives-severity error` on `typeAwareLintStep`: `switch.tsx`
(`role-has-required-aria-props` — a native checkbox supplies `aria-checked` itself) and
`scroll-area.tsx` (`no-noninteractive-tabindex` — WCAG 2.1.1 requires the tab stop). Directives are
honoured both in JSX attribute position and inside a `{/* … */}` container.

**What it is blind to, so this section does not overclaim.** jsx-a11y is a React-ecosystem checker
reading React prop spellings and lowercase intrinsics:

| Blind spot                                                     | Why                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `no-autofocus`, `no-access-key`                                | Match `autoFocus` / `accessKey`; forge writes the HTML spellings                             |
| `label-has-associated-control`                                 | Checks label _text_, not association — 0 findings across 94 labels                           |
| `click-events-have-key-events` and the other interaction rules | Key on `onClick` / `onMouseOver`, of which forge has none: behaviour lives in `*.browser.ts` |
| Anything a consumer writes                                     | `<Button>`, `<Field.Label>` are components, not intrinsics                                   |

`settings["jsx-a11y"].attributes` was probed and **left out**: with and without
`{ "for": ["for", "htmlFor"] }` the finding count is identical, including on a deliberately broken
label. An inert setting reads as coverage that is not there.

**The division of labour that follows.** jsx-a11y owns ARIA _vocabulary validity_ on forge's own
intrinsic markup — a typo'd `aria-labeledby`, an invalid role string, a malformed value. Forge's
own published a11y rules are the design gate's, over the composition jsx-a11y cannot read (§3a);
`contrastStep` continues to own `forge-ui-contrast-floor`. Neither tool substitutes for the other,
and no imported rule set closes the gap between forge's published a11y ids and its checked ones —
the ten ids that gap still contains are owned as review items in §3c.
