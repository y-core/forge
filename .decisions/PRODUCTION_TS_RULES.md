---
title: Production TypeScript Rules
description: "Six non-negotiable coding rules: zero global state, explicit errors, validation first, testability, the comment budget, and declarative style."
---

# Production TypeScript Rules

> Six non-negotiable rules for all TypeScript in forge, ensuring the library stays testable,
> predictable, and safe in the Cloudflare Workers runtime.
>
> Defers to: [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 for the `Result` primitive;
> [`TESTING.md`](./TESTING.md) for test placement and fake patterns;
> [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5e for the naming convention;
> [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) for the structural constraints these
> rules serve.

---

## 0. Quick Reference

- §1 Zero Global State Rule: request state never lives at module scope
- §1a No Module-Level Mutable Variables: why isolates make this unsafe
- §1b Factory Function Pattern: capture config, not request state
- §1c Constants Are Acceptable: the permitted module-level form
- §1d Factory Naming and Bare Constructors: `create*` / `define*`, and the `Forge` carve-out
- §1e Browser-Only Modules Are Exempt: why `ui/client` may hold module state, and what still applies
- §2 Explicit Errors via Result Monad: return failures, do not throw them
- §2a When to Throw vs Return Result: the three-way split
- §3 Validation First Rule: untrusted input stops at the boundary
- §3a Validate at System Boundaries: the handler and the config loader
- §3b Valibot v Facade: never import valibot directly
- §3c Abort-Early Validation: form-validation default
- §4 Testability Rule: design so tests need no mocks
- §4a No Globals to Mock: what factory functions buy
- §5 Comment Budget Rule: a ceiling on prose, not a floor
- §5a The Entire Permitted Budget: one-line TSDoc, visibility tags, the rare inline why
- §5b Forbidden Outright: what is deleted on sight
- §5c Where Rationale Belongs Instead: the routing table
- §5d Tests Are Not Exempt: the test name is the documentation
- §6 Declarative Over Imperative Rule: expression over statement

---

## 1. Zero Global State Rule

### 1a. No Module-Level Mutable Variables

**Never store request-scoped data in a module-level variable.** Each Workers isolate handles one
request at a time, but isolates are recycled — module-level mutations bleed between requests
sharing a module instance.

The prohibition and its rationale are both scoped to **request-scoped data in a Worker**. Code that
never executes in a Worker is covered by §1e, not by this rule.

```typescript
let currentUser: User | null = null   // never do this
```

**Inject state as factory parameters, or read it from the request context** (`c.env`, a
`contextVar` accessor).

### 1b. Factory Function Pattern

**Use a factory to create stateful behaviour.** The factory captures configuration — immutable
after creation — never request state.

```typescript
export function createSecurityHeaders(options: SecurityHeadersOptions): Middleware {
  // `options` captured once at creation time
  return async (c, next) => next()   // request-scoped work uses `c`
}
```

### 1c. Constants Are Acceptable

Module-level **immutable** constants are fine:

```typescript
export const CSRF_FIELD_DEFAULT = "_csrf"
export const HONEYPOT_FIELD_DEFAULT = "__surname"
```

`src/form/constants.ts` owns these two values — never restate them elsewhere.

### 1d. Factory Naming and Bare Constructors

**Two verbs, one rule each** ([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5e owns the full
convention):

- **`define*`** names a **declarative handler config** — `definePage`, `defineAction`.
- **`create*`** names **every other factory** that instantiates behaviour from captured config.

**A class holding configuration exposes a `create*` factory rather than a public constructor.**
Where a class is unavoidable, pair a private `constructor` with a `static create`. The `Config`
holder is the canonical case: its constructor is `private`, and consumers call `createConfig`.

**Carve-out: `Forge` is a public constructor and `new Forge<Env>()` is correct.** It is exported
from `src/app/mod.ts`, and tests instantiate it directly ([`TESTING.md`](./TESTING.md) §5a).
The rule targets *configuration holders* that would otherwise expose partially-initialised
state — not the app object itself, whose constructor takes only an optional logger.

### 1e. Browser-Only Modules Are Exempt

**§1a does not apply to modules that never execute in a Worker.** Its prohibition is on
*request-scoped* data and its rationale is isolate recycling; a module loaded only by the browser
has neither a request nor an isolate to bleed between. Its module scope is the page, and it is
discarded on navigation.

This is the standing arrangement for `src/ui/client/` and the other browser-only entry points
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §1, §5 own the hard SSR boundary that makes the
exemption safe). Module-level mutable state is the house style there — the reactive graph's
`activeEffect` / `flushing` / `pending` in `signal.ts`, the id counter in `active-descendant.ts`, the
delegation registries in `resume.ts`, and the one-shot latches in `nav.ts` and `turnstile.ts`.
Rewriting any of them as factories would buy nothing: there is one document, and these are
page-scoped singletons by nature.

**Stating it explicitly rather than leaving it implied**, because the alternative is a recurring
review finding against seven files that carry no exemption marker and need none.

**§4a still applies in full.** Page-scoped state that outlives a test is state a test has to be
able to reset. Where module state is observable, export a reset — `active-descendant.ts` ships
`resetActiveDescendant` for exactly this. Where it is not exported, tests must not depend on the
order they run in. `signal.ts` needs no reset: its queue is empty and its flush flag is down
whenever no write is in progress, including after one throws, which its own tests assert.

---

## 2. Explicit Errors via Result Monad

**forge has exactly one result primitive, with a single `error` failure field.** Return a
`Result` for expected failures rather than throwing; build values with `ok()` / `err()`; wrap a
throwing call with `result()`.

[`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 owns the primitive, its constructors, and the
`GuardResult` / `ValidationResult` domain aliases.

### 2a. When to Throw vs Return Result

- **Throw** — programming errors, missing required bindings at startup, violated invariants.
- **Return `Result`** — expected failures: parse errors, not-found, validation failures.
- **Never** — throw from middleware that is meant to degrade gracefully.

A canonical programming-error throw is `Button` with `asChild`: it merges props onto a single
JSX element child, so a string, fragment, array, or empty child cannot receive them and the
component throws rather than emitting malformed markup.

```tsx
if (asChild && !isValidElement(children)) {
  throw new Error("Button with asChild requires exactly one JSX element child")
}
```

That is a caller bug surfaced at render time — not an expected runtime failure — so a throw is
correct, where a parse or validation failure would return a `Result`.

---

## 3. Validation First Rule

### 3a. Validate at System Boundaries

**Validate all untrusted input — form data, request params, env vars — before it enters
business logic.** The boundary is the handler or the config loader.
[`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §6 owns the ordered pipeline.

### 3b. Valibot v Facade

**All validation uses the `v` namespace from `@y-core/forge/validation`. Never import `valibot`
directly** — not in app code, not in a forge namespace.

```typescript
import { v } from "@y-core/forge/validation"
const Schema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) })
```

### 3c. Abort-Early Validation

**Use `{ abortEarly: true }` in `v.safeParse` for form validation** so the first failing field
is reported immediately. Omit it when a response must enumerate every error.

---

## 4. Testability Rule

**Every source file has a co-located test file, and dependencies are faked rather than mocked.**
[`TESTING.md`](./TESTING.md) §2 and §4 own both rules.

### 4a. No Globals to Mock

Because forge uses factory functions and Web-standard APIs, **tests call functions directly
without mocking global state**. A function that cannot be tested without a mock is a design
signal: make its dependency an argument.

---

## 5. Comment Budget Rule

**Code is the documentation. A comment is an admission that the code failed to explain itself,
and it is paid for out of every future reader's attention.** This rule is a *ceiling*, not a
floor: §5a is the entire permitted budget, and anything not named there is a defect to be
deleted — not a judgement call, not a matter of taste, not something to leave because it is
already written.

Prose does not compile, is not typechecked, is not tested, and is not reachable by any gate. It
therefore goes stale silently and asserts things no one can verify. Every line of it is read —
by a human or an agent — on every single pass over the file, and then discarded. That cost is
paid continuously; the comment's value is paid once, at most.

**The first fix for an unclear line is always a better name, a smaller function, or a named
intermediate — never a comment.** Reach for a comment only after those have been tried and have
genuinely failed.

### 5a. The Entire Permitted Budget

Exactly three forms of comment are allowed in `src/` and `scripts/`. Nothing else is.

**Machine-readable directives are not comments and are outside this budget entirely** — they are
compiler or tooling *input* that happens to use comment syntax: `@jsx*` pragmas, `biome-ignore`,
and `design-allow:`. Never delete one. Where a directive carries a human-readable reason field,
that reason must be **self-contained**: `design-allow: … — see the note above` breaks the moment
the note it points at is deleted, and `design-parse.ts` requires the field to be non-empty. Write
the reason so it survives alone.

**1. One line of TSDoc on an exported symbol.** One sentence, on one line, saying what the
symbol does. Not why it exists, not what it does not do, not what was considered instead.

```typescript
/** Creates a Forge app with a structured error boundary and config validation. */
export function createApp<Bindings extends object = Record<string, unknown>>(
  options?: AppOptions<Bindings>,
): Forge<Bindings>
```

**2. The visibility tags `@public` and `@internal`.** These are machine-readable markers, not
prose. `@internal` is what keeps a symbol out of the barrel without keeping it out of
cross-namespace use. They append to the TSDoc line and do not earn it extra lines.

**3. A rare inline comment carrying a genuinely non-obvious *why*.** This is the exceptional
case, and it is exceptional in the literal sense — most files contain zero. It is permitted only
when all four hold:

- the *what* is already plain from the code, and only the *why* is missing;
- the reason is external to the file — a spec quirk, a browser or runtime bug, a wire-format
  constraint, a security invariant that a plausible "simplification" would silently break;
- a reader who did not know it would reasonably change the code and be wrong;
- it fits in one or two lines.

```typescript
// Cloudflare strips this header before the isolate sees it; re-reading it here is not redundant.
const clientIp = request.headers.get("cf-connecting-ip") ?? fallbackIp(request);
```

### 5b. Forbidden Outright

Delete these on sight, in existing code as readily as in new code. No deprecation window, no
"leave it for now" — an unbudgeted comment is removed in whatever change touches the file.

- **Multi-paragraph TSDoc.** Design rationale, alternatives weighed, history, numbered
  justifications, "for four reasons", "two earlier attempts were wrong".
- **`@example` blocks.** A signature plus a one-line summary is the usage documentation. If an
  API genuinely cannot be used from its types, that is an API defect — fix the API. Consumer-
  facing usage belongs in the namespace `README.md` or the governing `.decisions/` doc, where it
  has a single home and does not ride along in every read of the source.
- **Restating the code.** `// increment the counter`, `/** The user's name. */ name: string`,
  `// Returns true if valid`.
- **Section banners and separators.** `// ---- helpers ----`, `// === Types ===`,
  box-drawing rules. File structure is what files and exports are for.
- **Commented-out code.** Git holds it.
- **Narration of the obvious.** `// Guard clause`, `// Early return`, `// Loop over items`.
- **Self-referential meta-commentary.** A comment about why a comment exists, or about what a
  previous attempt at the comment got wrong, is never load-bearing.
- **Justifying a decision the code cannot observe.** If two orderings, spellings, or shapes are
  provably indistinguishable to every caller, the choice needs no defence in the source. If it
  genuinely matters, a *test* asserts it — a comment cannot.
- **TODO / FIXME / XXX.** Unactionable in-band. Open a ledger task.

### 5c. Where Rationale Belongs Instead

The instinct behind a long comment is usually sound — the reasoning is real and worth keeping.
It is the *placement* that is wrong. Route it to the one place that owns it:

| The content is… | Its single home |
|---|---|
| Architectural rationale, a boundary, a trade-off | the governing `.decisions/` doc |
| Consumer-facing usage, examples, recipes | the namespace `README.md` |
| A claim about behaviour | a test that asserts it |
| A design rule or UI anti-pattern | `src/ui/design/` |
| Work not yet done | a ledger task |
| The history of a decision | the commit message |

A comment that could live in any row above does not also live in the source. Duplicating it
there is how the two copies drift.

### 5d. Tests Are Not Exempt

A test name is the test's documentation, and it is the one form of description that runs. A test
whose intent needs a comment needs a better name. The same budget applies to `*.test.ts` /
`*.test.tsx`, with one addition: a fixture holding a deliberately malformed or adversarial value
may carry a one-line note saying what makes it malformed, when that is not visible from the
literal itself.

---

## 6. Declarative Over Imperative Rule

- **Prefer array methods over loops** — `origins.filter(o => o.startsWith("https://"))`, not an
  accumulator loop.
- **Prefer object spread over mutation** — `{ ...defaults, ...overrides }`, not assign-then-patch.
- **Prefer nullish coalescing and optional chaining** — `input ?? fallback`,
  `user?.profile?.displayName`.

The rule is about expressing intent, not about avoiding loops on principle: reach for a loop
when the operation genuinely is sequential or early-exiting.
