---
title: Code Review Standards
description: "How to review forge code: the blocking invariants, a detection command per rule, severity calibration, and the known false positives."
audience: internal
---

# Code Review Standards

> Owns the review process: what blocks a merge, how to _detect_ each violation rather than hand-inspect for it, how to calibrate severity, and which
> suspicious-looking patterns are correct.
>
> **This document restates no rule.** Every item below is either a `detect:` command or a link to the document that owns the rule. If you want to
> know _why_ a rule exists, follow the link.
>
> Defers to: [`CODE_REVIEW.md`][cr] for the fleet's review standard — this document adds forge's own invariants and detection commands to it, and
> replaces none of them.

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
- §7a Why `categories.suspicious` is off: the default-deny, and the rules that dominate its volume
- §7b The two rules taken from it: what `preserve-caught-error` and `no-shadow` caught
- §7c Why `jsx-a11y` is on, and what it does not see: the one rule off, the written site suppressions, the named blind spots, and the
  vocabulary-versus-composition split

---

## 1. Review Workflow

See [`CODE_REVIEW.md`][cr-1] §1 for the review workflow, the green-baseline requirement, and the finding format.

---

## 2. Blocking Invariants

These are forge's own invariants. **Any one of them blocks a merge regardless of severity argument.**

**The canon's invariants bind alongside these, not underneath them.** The table below is what forge adds; the fleet's list is the canon's own §2,
and some of its entries appear nowhere here — browser-only code imported from a Worker path, untrusted input validated at the boundary, and PII
reaching a log record. Each still blocks a merge. Read both tables, or read the canon's and treat this one as the delta.

| Invariant | Owner |
| --- | --- |
| No deprecation shim or backward-compatible path before v1.0.0 | [`FORGE_STRUCTURE.md`][la-7] §7 |
| No hardcoded secret, key, or credential in source | §3c |
| `mod.ts` uses named exports only — no `export *` | [`NAMESPACE_DESIGN.md`][nd-1b] §1b |
| No sibling-barrel import outside the sanctioned exemptions | [`NAMESPACES.md`][namespaces-2] §2 |
| Runtime namespaces use only Web APIs | [`LIBRARY_ARCHITECTURE.md`][la-1d] §1d |
| `valibot` is never imported outside the facade | [`INPUT_VALIDATION.md`][iv-1a] §1a |
| Security-critical paths fail closed | [`BOUNDARIES.md`][boundaries-5] §5 |
| A state-changing route carries a CSRF guard | [`INPUT_VALIDATION.md`][iv-3a] §3a |
| A security guard has both a pass and a fail test | [`TEST_RUNNERS.md`][testing-5a] §5a |
| No props interface types an icon as bare `ForgeIcon` or `ForgeIcon<string>` | §3b |
| No comment outside the permitted budget | [`CODE_RULES.md`][cr-5a] §5a |

---

## 3. Detection by Tier

### 3a. Tier 1 — Gated

**A rule with a gate step is not a review item.** Do not hand-review these; run the gate and read its output.

| Rule | detect |
| --- | --- |
| Barrel discipline, `export *` ban, export-map drift, `@public` symbols reaching their barrel | `bun run verify --only validate-exports` |
| Leaf/integration classification, undeclared cross-namespace imports, stale declared edges | `bun run verify --only validate-namespace-graph` |
| JSX pragma present and correct in every `.tsx` | `bun run verify --only validate-jsx` |
| A literal `data-slot` written before a bare-identifier spread | `bun run verify --only lint` |
| Browser-only `ui/client` import reaching a Worker-executed `src/ui` file | `bun run verify --only validate-ssr-boundary` |
| No-sibling-barrel rule (oxlint `no-restricted-imports`) | `bun run verify --only lint` |
| Governing-doc import paths, numbering, references | `bun run verify --only validate-docs` |
| Tailwind `@source` coverage of every `src/ui/` directory | `bun run verify --only validate-css-sources` |
| Every corpus rule the plugin owns — the markup family (`forge-ui-a11y-*`, `-no-inline-style`, `-no-nested-card`, `-catalog-wrong-raw-input`) and the class-string family (`-spacing-scale-only`, `-color-token-only`, `-color-theme-no-raw-utility`, `-reduced-motion`, `-focus-ring`, `-interaction-focus-visible`, the `-platform-*` family) | `bun run verify --only lint` |
| The corpus against forge's API, and both rule registers against the plugin | `bun run verify --only validate-design` |
| ARIA vocabulary validity — attribute names, role names, value shapes | `bun run verify --only lint` |
| The comment budget — multi-line TSDoc, any tag but `@public`/`@internal`, `//` runs over two lines, banners, commented-out code, `TODO`. An interface field earns at most one line and earns nothing when its name and type already say it | `bun run verify --only validate-comment-budget` |
| Behaviour of the changed unit | `bun test <path>` |

**If a Tier-1 check passes and you still believe the rule is violated, the check is wrong — fix the check, not the review.**

### 3b. Tier 2 — Ripgrep with Triage

**Every command here has a known false-positive class, stated with it.** A command without its triage note is worse than no command.

**Hand-spelled focus ring or disabled paint in `src/ui`**

```bash
rg -n 'focus-visible:ring-2|has-\[:focus-visible\]:ring|peer-focus-visible:ring|disabled:opacity-50|has-\[:disabled\]:opacity' src/ui --glob '!*.test.*' --glob '!forge-ui.css'
```

_Triage:_ any hit is a component re-spelling a recipe `forge-ui.css` publishes as an `@utility` (`focus-ring`, `state-disabled`, `state-invalid`,
`state-busy`, `field-chrome`) — see [`UI_CLASS_COMPOSITION.md`][ucc-1e] §1e. The one legitimate spelling that is not a hit is `Switch`'s
`peer-focus-visible:ring-2` on the track, which reaches across a sibling that `&:has()` cannot; it is excluded by the `!forge-ui.css` glob only
because the utility itself lives there. The design corpus under `src/ui/design` is excluded by the same reasoning as every other Tier 2 command.

**Valibot facade breach**

```bash
rg -n 'from "valibot"|from \x27valibot\x27' src/ --glob '!src/validation/**'
```

_Triage:_ any hit is a breach, including in a `*.test.ts`. A test that imports valibot directly bypasses the facade exactly as production code
would, and will not follow a version bump. One class is not a hit but reads as one: a gate check's fixture carries the specifier as a **string
literal** for the parser under test to find — `src/tooling/gate/checks/` only, and the line is inside a quoted fixture rather than at module scope.

**Sibling-barrel import**

```bash
rg -nP 'from "\.\./(?!validation/mod|crypto/mod)[a-z-]+/mod"' src/ --glob '!*.test.*'
```

_Triage:_ the negative lookahead already excludes the sanctioned exemptions ([`NAMESPACE_DESIGN.md`][nd-2c] §2c), and the `!*.test.*` glob
excludes the one legitimate class — a published-surface assertion importing a sibling barrel on purpose, each already carrying an
`oxlint-disable-next-line` and its reason. With both, this should return nothing.
**PCRE2 (`-P`) is required** — the default engine has no lookahead and will silently match everything.

**Web-APIs-only breach in a runtime namespace**

```bash
rg -n '\bBun\.|from "node:' src/ \
  --glob '!src/tooling/**' --glob '!src/ui/assets/build/**' \
  --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.browser.ts' --glob '!**/*.md' \
  --glob '!**/*.fixture.ts'
```

_Triage:_ `src/tooling/` is the build-time container — membership _is_ the exemption ([`NAMESPACES.md`][namespaces-4a] §4a) — and `ui/assets/build`
is the one runtime-owned namespace that carries the same exemption behind its own subpath. Tests and `.browser.ts` specs run under Bun or
Playwright, never in a Worker, and a `*.fixture.ts` is test infrastructure a spec imports rather than a Worker does. **Without those globs the
command returns dozens of legitimate hits and will be ignored.** A hit anywhere else is a genuine runtime-portability break.

_The direction that matters most is already a gate step._ `validate-build-time-boundary` fails any runtime module that imports a build-time one, so
a review does not have to find that by hand; run this command for the case the step cannot see — a Node API used **inside** a runtime namespace
without an import crossing any boundary.

**Timer handle not cleared by its disposer**

```bash
rg -n 'setTimeout\(|setInterval\(' src/ui/client/
```

_Triage:_ a hit is only a defect if the handle it returns is not cleared in the module's disposer — **read the disposer, not the call site**
([`UI_CLIENT_RUNTIME.md`][ucr-2d] §2d). A timer paired with a poll must also be cleared when the poll **succeeds**, not only when it times out.

**Substring assertion on rendered HTML**

```bash
rg -n 'toContain\(|toMatch\(' src/ --glob '*.test.ts*'
```

_Triage:_ legitimate on non-HTML strings — an error message, a log line, a SQL fragment. **A hit asserting on rendered markup is a defect**
([`TEST_RUNNERS.md`][testing-3b] §3b).

**Widest-possible icon prop**

```bash
rg -n '\bicon\??:\s*ForgeIcon(<string>)?\s*[;,]' src/
```

_Triage:_ every hit is a defect, and the fix is always to narrow the parameter to the glyph names the component actually renders —
`ForgeIcon<"chevron-down">`, or a `<N | "chevron-down">` threaded from the props interface when the caller names one. `ForgeIcon<Name>` is a
component type, so its `name` prop is contravariant under `strictFunctionTypes`: the _narrow_ declaration is the _permissive_ one, accepting both a
narrow sheet and a wide one, while a bare `ForgeIcon` demands a sheet that accepts every string and rejects the app sheet enumerating just its own
symbols. A bare `ForgeIcon` in a prop position is therefore never a deliberate widening, and it costs the consumer either a cast or an unchecked
glyph that renders an empty `<use>`. **The command is anchored to a prop position** — `createIcon`'s own overloads return `ForgeIcon<string>`
correctly, which is the one shape a looser pattern picks up as a false positive.

**The unparameterised spelling never reaches review**: `ForgeIcon` declares no default for `Name`, so `tsc` rejects a bare `ForgeIcon` at the
declaration site and the gate's `typecheck` step fails before this command runs. The command stays because `ForgeIcon<string>` is still spellable,
still compiles, and is still always wrong in a prop position — catching that explicit spelling is its remaining job.

Restating-the-code and narration are not reachable by any command; they belong to §3c.

### 3c. Tier 3 — Judgement

No command decides these. Read the named files and answer the named question.

**Hardcoded secrets.** Read every added constant and test fixture. _Does any string look like a key, token, or hex secret that is not obviously a
test value?_ A 64-char hex literal is fine in a test and fatal in `src/*/config.ts`.

**Fail-closed posture.** Read every new `if` around a security dependency. _When the binding, key, or header is absent, does the code return an
error — or continue?_ Silent continuation is the defect ([`BOUNDARIES.md`][boundaries-5a] §5a).

**Facade intent.** Read the changed `mod.ts`. _Does a new export widen the surface beyond what a consumer needs, or leak a third-party type into
forge's signature?_ ([`FORGE_STRUCTURE.md`][la-4a] §4a.)

**Namespace classification.** Read the new imports in the changed namespace. _Does this introduce a cross-namespace edge that the classification
does not declare?_ ([`NAMESPACES.md`][namespaces-4b] §4b.)

**Guard placement.** Read the controller, not the handler. _Is the guard in the action's `middleware` array, or inline inside the handler?_ Inline
guards are invisible to a reader auditing the route map ([`ROUTING_AND_MIDDLEWARE.md`][ram-1b] §1b).

**Async lifetime.** Read every function whose returned promise reaches `executionCtx.waitUntil()` or `Logger.flush()`. _Does the returned promise
cover every piece of work the function started, or only the headline one?_ A `void work().catch(…)` branch is untracked, so the isolate may suspend
before it settles — the shape to look for is a probabilistic or opportunistic side task detached from the promise the caller awaits
([`FORGE_STRUCTURE.md`][la-6] §6).

**Prose that earns nothing.** Read every comment and every README paragraph in the diff. _Does this sentence say something the name, the type, the
signature, or a test does not?_ A per-field gloss, a per-symbol restatement, and a paragraph narrating how the code works are the same defect at
rising scale — §3a's step catches the first two by shape, never the last ([`CODE_RULES.md`][cr-5b] §5b, [`AGENT_GUIDE.md`][ag-6c] §6c). In a
README the shape to look for is a section named after an exported symbol: no gate sees it, and it is what a task-shaped README replaced. Where the
sentence asserts behaviour, the question is sharper — _which test pins this?_ — and where none does, the finding is the missing assertion
([`CODE_RULES.md`][cr-5e] §5e).

**The unchecked a11y rule ids.** Read every added or changed `.tsx` under `src/ui/`. _Does the markup meet each of these ids, none of which any
gate step proves?_ The gated ids are §3a's; the ones below are the remainder, and the reason each has no command is recorded beside it so it is not
re-derived. Their sentences are [`floor.md`][floor] and [`reference/10-accessibility.md`][accessibility]; the corpus publishes them either way
([`UI_DESIGN_GUIDANCE.md`][udg-4a] §4a).

| Rule id | Why no command decides it |
| --- | --- |
| `forge-ui-accessible-name` | The name depends on the rendered subtree and on component internals a source scan cannot follow |
| `forge-ui-heading-order` | Order is a property of the rendered document, not of one file — `compositions.tsx` correctly writes three `<h3>`s before its `<h2>` |
| `forge-ui-hit-target` | Needs to know which element is interactive and what the unspecified axis resolves to at render |
| `forge-ui-not-color-alone` | Turns on whether an icon and words _also_ convey the state |
| `forge-ui-a11y-icon-plus-text` | Preferred form and permitted alternative are the same shape in source — the `aria-label` sites in `show/components.tsx` alone would fire |
| `forge-ui-a11y-label-element` | The trigger is "the design has no room for a visible label", a fact about the design and not about the markup |
| `forge-ui-a11y-required-marker` | `Label`'s `required` prop already emits the marker, so no residual shape is left to match |
| `forge-ui-a11y-reduced-motion-pair` | Depends on whether the settled state is already the untransitioned default |
| `forge-ui-a11y-spinner-announces` | Scoped to "the region", a boundary source text does not delimit |
| `forge-ui-a11y-state-attrs-source` | **A mechanical form exists** — an `aria-*` Tailwind variant naming a state `STATE_ATTRS` registers — and is unadopted only because it fires twice on `TAB_BASE` in `src/ui/core/tabs.tsx`, line 73. When that site changes, the finder lands and this line moves to §3a |

---

## 4. Severity Calibration

See [`CODE_REVIEW.md`][cr-4] §4 for severity calibration, and for the deliberate asymmetry that makes excess prose Major and its absence Minor.

---

## 5. Verification Protocol

See [`CODE_REVIEW.md`][cr-5] §5 for the verification protocol every finding must survive before it is reported.

---

## 6. Valid Patterns — Do Not Flag

These look wrong and are correct. Each has been mistaken for a defect before.

| Pattern | Why it is correct |
| --- | --- |
| `new Forge<Env>()` in a test | `Forge` is exported from `src/app/mod.ts` with a public constructor. The no-bare-constructor rule targets _config holders_ — [`CODE_RULES.md`][cr-1d] §1d |
| `@y-core/forge/context` imported by a consumer | `context` **is** a public subpath |
| A reference to `@y-core/forge/crypto` being absent | That subpath **never existed**. `crypto` is sealed-internal — [`NAMESPACES.md`][namespaces-3b] §3b |
| `import { v } from "../validation/mod"` in forge source | A sanctioned barrel exemption — [`NAMESPACE_DESIGN.md`][nd-2c] §2c |
| `import … from "../crypto/mod"` in forge source | The other sanctioned exemption |
| `*.test.ts` beside its source rather than in `tests/` | Co-location is the rule, not a lapse — [`TESTING.md`][testing-2a] §2a |
| `node:fs` / `node:path` under `src/tooling/` or in `ui/assets/build` | Build-time tooling, exempt from Web-APIs-only — §3b |
| `node:fs` / `node:path` in `src/ui/client/browser.fixture.ts` | Test infrastructure a `*.browser.ts` spec imports, never a Worker; a `*.fixture.ts` is off every barrel and out of the tarball by convention |
| `node:child_process` / `node:fs` / `node:net` in `src/testing/workerd.ts` | The one node-only module of a mixed namespace, never Worker-reachable and deliberately off the `./testing` barrel — [`NAMESPACES.md`][namespaces-4a] §4a, [`TEST_RUNNERS.md`][testing-7f] §7f |
| `export const X = "…"` at module scope | A constant is not mutable state — [`CODE_RULES.md`][cr-1c] §1c |
| A mutable module-scope `WeakMap` / `Map` cache in `ui/client` | Browser-only modules are exempt from the zero-global-state rule — [`CODE_RULES.md`][cr-1e] §1e. Keying on `Document` keeps it test-isolated without a reset export; live instance `inFlightStylesheets` in `src/ui/client/lazy.ts` |
| `contextVar` used inside forge source | It is the intended mechanism for a namespace's own accessors — [`ROUTING_AND_MIDDLEWARE.md`][ram-4a] §4a |
| `sideEffects` entries in `package.json` | A deliberate bundler hint — [`UI_CLIENT_RUNTIME.md`][ucr-4] §4 |
| A non-null assertion in a test file | Permitted by the `**/*.test.ts` oxlint override, which sets `typescript/no-non-null-assertion: off`; the rule is `error` in production source |
| `ok` / `err` not following `create*` | The one documented naming exception — [`FORGE_ERRORS.md`][eh-1a] §1a |
| `serveObject` returning a `Response`, not a `Result` | A ratified boundary exception — [`FORGE_ERRORS.md`][eh-5e] §5e |
| `Input` exported from both `ui/core` and `ui/controls` | Deliberate shadowing — [`NAMESPACES.md`][namespaces-5b] §5b |
| `@public` / `@internal` on a TSDoc line | Machine-readable visibility markers, explicitly budgeted — [`CODE_RULES.md`][cr-5a] §5a |
| An inline comment of one or two lines carrying an external _why_ | The third budgeted form, subject to the conditions in [`CODE_RULES.md`][cr-5a] §5a |
| A one-line note on an adversarial test fixture | The one test-side addition to the budget — [`CODE_RULES.md`][cr-5d] §5d |
| A `page.evaluate` callback whose destructured parameter repeats an outer name | The callback runs in the browser realm and _cannot_ close over the Node-side binding; the repeated name is what documents the marshalled argument — §7b |
| `[--tone:var(--color-…)]` arbitrary-property classes, and `bg-(--tone)` reading them | The tone mechanism, not a stray arbitrary value: `toneVariants` sets the properties and one recipe per appearance reads them — [`UI_CLASS_COMPOSITION.md`][ucc-1e] §1e |
| `state-invalid` or `cursor-pointer` passed as a separate `cn` argument, outside the base literal | Not an untidy call: the narrower recipe's group is a subset of an earlier one's, so folding it into the literal deletes it — [`UI_CLASS_COMPOSITION.md`][ucc-1e] §1e |
| `data-size` on `Avatar`, `Turnstile`, or a field control | A presentational attribute carrying a chosen value, not a state hook — it is declared beside the state table rather than in it — [`STATE_ATTRIBUTES.md`][sa-2] §2 |
| `hx-on:*` emitted verbatim while every bare `on*` attribute is dropped, and a `js:`-prefixed `hx-vals`/`hx-headers` left as a raw string | A ratified fail-open exception: the renderer's handler filter tests the lowercased name for a leading `on`, which `hx-on:click` does not carry, and a `js:` value is an attribute value htmx evaluates rather than a name. Written into [`HTMX.md`][htmx-7b] §7b, whose control is that the value be developer-authored — [`BOUNDARIES.md`][boundaries-5c] §5c |
| A `navbar:filters` document event accepted from any script on the page | A ratified fail-open exception: `filters` repaints already-delivered items and never decides what a viewer may reach, so a forged event degrades presentation only — route guards are the enforcement point. Written into [`UI_CLIENT_RUNTIME.md`][ucr-2b] §2b — [`BOUNDARIES.md`][boundaries-5c] §5c |
| A URL-valued `hx-*` attribute left unsanitized beside an `href` that is not | Deliberate: `safeUrl`'s `"#"` is a live same-origin request once htmx fetches it, so sanitizing converts a refusal into a silent wrong request — [`HTMX.md`][htmx-7a] §7a |

---

## 7. The oxlint Rule Set

### 7a. Why `categories.suspicious` is off

`.oxlintrc.json` enables `correctness` as a category and names every other rule individually. That is a deliberate default-deny, for two reasons.

**A category is a standing subscription to oxc's editorial judgement.** `lintStep` is published through `src/tooling/gate/mod.ts`, so a rule oxc
moves into `suspicious` would fail the gate of every consumer app that builds its table from forge's preset, on the next install and with no
changelog entry of forge's own. Naming rules individually makes an oxlint upgrade inert until someone reads its changelog and chooses.

**It buys no Biome parity, and its volume says nothing about this codebase.** Of 357 findings measured at migration time, 312 came from three rules
that collide with forge's own design:

| Rule | n | Why it is wrong here |
| --- | --- | --- |
| `unicorn/consistent-function-scoping` | 132 | 120 are test helpers declared inside a `describe` — the co-location idiom [`TESTING.md`][testing-2a] §2a mandates |
| `unicorn/no-array-sort` | 95 | Nudges `toSorted()`, but many sites are `[...map.keys()].sort()` — already a fresh array, so the rewrite copies twice |
| `eslint/no-underscore-dangle` | 85 | Flags the `__env` / `__flag` config _wire-format_ keys and valibot's `null_`; "fixing" them breaks consumer config files |

`import/no-unassigned-import` (6) flags exactly the paths listed in `package.json` `sideEffects` (§6). The rest of the tail is single-digit and
false-positive-dominated.

### 7b. The two rules taken from it

| Rule | What it caught |
| --- | --- |
| `eslint/preserve-caught-error` | One site rethrowing with the message interpolated and no `cause`, discarding the original stack |
| `eslint/no-shadow` | Locals shadowing an imported or same-module symbol the file also calls — `err` from `result` inside a `catch` in `csrf.ts`, and the exported `env()` builder in `config.ts` |

`no-shadow`'s only sanctioned exception is the cross-realm `page.evaluate` case in §6.

**Type-aware rules are configured in the same file but only run under `lint:types`** — see [`TEST_RUNNERS.md`][testing-6] §6 for which tier that
step runs from.

### 7c. Why `jsx-a11y` is on, and what it does not see

The plugin is enabled and every rule it ships runs under `correctness`. Measured over `src/` and `config/` before adoption, it produced **9
findings and zero real defects**: six were correct ARIA the rules mis-advise, three were adversarial markup in test fixtures.

**Unlike §7a's default-deny, a category is the right unit here** — and the reach is narrower than §7a's argument implies. `.oxlintrc.json` is not in
`package.json`'s `files` array, so it does not ship. A consumer inherits the _invocation_ (`lintStep` → `oxlint --deny-warnings`) and writes its own
rule table, so an oxc editorial change to `jsx-a11y` reaches forge's tree only, not every consumer's. Against that, the plugin's rules are a fixed
W3C vocabulary rather than a style opinion, and they cost nothing today.

**One rule is off.** `prefer-tag-over-role` proposes `<output>` for `role="status"` and `address, details, fieldset, hgroup, optgroup` for
`role="group"` — substitutions that change the element's meaning. It is off rather than suppressed per-site because it is the one rule that
_recurs_: every future correct `role="status"` would owe a fresh suppression. A further set is off for `*.test.{ts,tsx}` only —
`control-has-associated-label`, `tabindex-no-positive`, `aria-proptypes` — because feeding a linter's own bad input is what those tests are for
([`TESTING.md`][testing]).

**Every written suppression is load-bearing**, and proven so by `report-unused-disable-directives-severity error` on
`typeAwareLintStep`: `switch.tsx` (`role-has-required-aria-props` — a native checkbox supplies `aria-checked` itself) and `scroll-area.tsx`
(`no-noninteractive-tabindex` — WCAG 2.1.1 requires the tab stop). Directives are honoured both in JSX attribute position and inside a `{/* … */}`
container.

**What it is blind to, so this section does not overclaim.** jsx-a11y is a React-ecosystem checker reading React prop spellings and lowercase
intrinsics:

| Blind spot | Why |
| --- | --- |
| `no-autofocus`, `no-access-key` | Match `autoFocus` / `accessKey`; forge writes the HTML spellings |
| `label-has-associated-control` | Checks label _text_, not association — 0 findings across 94 labels |
| `click-events-have-key-events` and the other interaction rules | Key on `onClick` / `onMouseOver`, of which forge has none: behaviour lives in `*.browser.ts` |
| Anything a consumer writes | `<Button>`, `<Field.Label>` are components, not intrinsics |

`settings["jsx-a11y"].attributes` was probed and **left out**: with and without `{ "for": ["for", "htmlFor"] }` the finding count is identical,
including on a deliberately broken label. An inert setting reads as coverage that is not there.

**The division of labour that follows.** jsx-a11y owns ARIA _vocabulary validity_ on forge's own intrinsic markup — a typo'd `aria-labeledby`, an
invalid role string, a malformed value. Forge's own published a11y rules are the design gate's, over the composition jsx-a11y cannot read (§3a);
`contrastStep` continues to own `forge-ui-contrast-floor`. Neither tool substitutes for the other, and no imported rule set closes the gap between
forge's published a11y ids and its checked ones — the ids that gap still contains are owned as review items in §3c.

[accessibility]: ../src/ui/design/reference/10-accessibility.md
[ag-6c]: ../warden/canon/shared/AGENT_GUIDE.md#6c-decisions-versus-usage--the-readme-boundary
[boundaries-5]: ../warden/canon/libs/BOUNDARIES.md#5-fail-closed
[boundaries-5a]: ../warden/canon/libs/BOUNDARIES.md#5a-fail-closed-on-missing-critical-context
[boundaries-5c]: ../warden/canon/libs/BOUNDARIES.md#5c-recording-a-fail-open-exception
[cr]: ../warden/canon/libs/CODE_REVIEW.md
[cr-1]: ../warden/canon/libs/CODE_REVIEW.md#1-review-workflow
[cr-1c]: ../warden/canon/shared/CODE_RULES.md#1c-constants-are-acceptable
[cr-1d]: ../warden/canon/shared/CODE_RULES.md#1d-factory-verbs-and-bare-constructors
[cr-1e]: ../warden/canon/shared/CODE_RULES.md#1e-browser-only-modules-are-exempt
[cr-4]: ../warden/canon/libs/CODE_REVIEW.md#4-severity-calibration
[cr-5]: ../warden/canon/libs/CODE_REVIEW.md#5-verification-protocol
[cr-5a]: ../warden/canon/shared/CODE_RULES.md#5a-the-entire-permitted-budget
[cr-5b]: ../warden/canon/shared/CODE_RULES.md#5b-forbidden-outright
[cr-5d]: ../warden/canon/shared/CODE_RULES.md#5d-tests-are-not-exempt
[cr-5e]: ../warden/canon/shared/CODE_RULES.md#5e-a-behavioural-claim-is-an-assertion
[eh-1a]: ./FORGE_ERRORS.md#1a-the-unified-result-primitive-okerr-result-and-toerror
[eh-5e]: ./FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[floor]: ../src/ui/design/floor.md
[htmx-7a]: ./HTMX.md#7a-url-valued-hx-attributes-are-deliberately-unsanitized
[htmx-7b]: ./HTMX.md#7b-what-htmx-evaluates-hx-on-and-a-js-prefixed-hx-vals-or-hx-headers
[iv-1a]: ./INPUT_VALIDATION.md#1a-v-namespace--complete-valibot-re-export
[iv-3a]: ./INPUT_VALIDATION.md#3a-csrfprotection-middleware--guard-mutating-routes
[la-1d]: ../warden/canon/libs/LIBRARY_ARCHITECTURE.md#1d-web-apis-only-constraint
[la-4a]: ./FORGE_STRUCTURE.md#4a-re-export-rules-for-facade-namespaces
[la-6]: ./FORGE_STRUCTURE.md#6-cloudflare-workers-runtime-model
[la-7]: ./FORGE_STRUCTURE.md#7-pre-10-api-evolution
[namespaces-2]: ./NAMESPACES.md#2-no-sibling-barrel-import-rule
[namespaces-3b]: ./NAMESPACES.md#3b-internal-namespaces
[namespaces-4a]: ./NAMESPACES.md#4a-leaf-namespace-rules
[namespaces-4b]: ./NAMESPACES.md#4b-integration-namespace-rules
[namespaces-5b]: ./NAMESPACES.md#5b-uicore--ssr-components-only
[nd-1b]: ../warden/canon/libs/NAMESPACE_DESIGN.md#1b-export-star-ban
[nd-2c]: ../warden/canon/libs/NAMESPACE_DESIGN.md#2c-granting-an-exemption
[ram-1b]: ./ROUTING_AND_MIDDLEWARE.md#1b-controller--mapping-route-names-to-actions
[ram-4a]: ./ROUTING_AND_MIDDLEWARE.md#4a-contextvar-typed-accessor
[sa-2]: ./STATE_ATTRIBUTES.md#2-presentational-attributes-are-declared-too
[testing]: ../warden/canon/libs/TESTING.md
[testing-2a]: ../warden/canon/libs/TESTING.md#2a-test-file-naming-convention
[testing-3b]: ./TEST_RUNNERS.md#3b-exact-match--never-substring-matching
[testing-5a]: ./TEST_RUNNERS.md#5a-both-pass-and-fail-cases-required
[testing-6]: ./TEST_RUNNERS.md#6-the-verification-gate
[testing-7f]: ./TEST_RUNNERS.md#7f-the-one-subpath-that-is-not-on-the-barrel--y-coreforgetestingworkerd
[ucc-1e]: ./UI_CLASS_COMPOSITION.md#1e-the-utility-recipe-layer
[ucr-2b]: ./UI_CLIENT_RUNTIME.md#2b-theme-controller-and-fouc-prevention
[ucr-2d]: ./UI_CLIENT_RUNTIME.md#2d-the-disposer-contract
[ucr-4]: ./UI_CLIENT_RUNTIME.md#4-htmx-bundle-import
[udg-4a]: ./UI_DESIGN_GUIDANCE.md#4a-gate-enforcement-across-both-tiers
