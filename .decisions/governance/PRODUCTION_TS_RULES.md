---
title: Production TypeScript Rules
description: "Seven non-negotiable coding rules: zero global state, explicit errors, validation first, testability, the comment budget, declarative style, and name distinctiveness."
---

# Production TypeScript Rules

> Seven non-negotiable rules for every TypeScript file in the repository, keeping it testable,
> predictable, and safe in the Cloudflare Workers runtime.
>
> Defers to: [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 for the `Result` primitive;
> [`TESTING.md`](./TESTING.md) for test placement and fake patterns;
> [`BOUNDARIES.md`](./BOUNDARIES.md) for the boundaries these rules serve.

---

## 0. Quick Reference

- §1 Zero Global State Rule: request state never lives at module scope
- §1a No Module-Level Mutable Variables: why isolates make this unsafe
- §1b Factory Function Pattern: capture config, not request state
- §1c Constants Are Acceptable: the permitted module-level form
- §1d Bare Constructors on Configuration Holders: the private-constructor rule and its carve-outs
- §1e Browser-Only Modules Are Exempt: why page-scoped state is safe, and what still applies
- §2 Explicit Errors via Result Monad: return failures, do not throw them
- §2a When to Throw vs Return Result: the taxonomy that owns the split, and the canonical throw
- §3 Validation First Rule: untrusted input stops at the boundary
- §3a Validate at System Boundaries: the handler and the config loader
- §3b The Validation Facade: never import the schema library directly
- §3c Abort-Early Validation: the form-validation default
- §4 Testability Rule: design so tests need no mocks
- §4a No Globals to Mock: what factory functions buy
- §5 Comment Budget Rule: a ceiling on prose, not a floor
- §5a The Entire Permitted Budget: one-line TSDoc, visibility tags, the rare inline why
- §5b Forbidden Outright: what is deleted on sight
- §5c Where Rationale Belongs Instead: the routing table
- §5d Tests Are Not Exempt: the test name is the documentation
- §6 Declarative Over Imperative Rule: expression over statement
- §7 Name Distinctiveness Rule: a name is the only index from a question to the code
- §7a The Name Is the First Hop: discovery is name-shaped, understanding is LSP-shaped
- §7b One Domain Word — and No More Than the Domain Needs: the floor, and the ceiling beside it
- §7c One Spelling Per Concept: two words for one entity get built twice
- §7d Parameters Distinguished by Type, Not Order: make the compiler reject the transposition

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
after creation — never request state. The options object is captured once, at creation time;
everything request-scoped is read off the context the returned function is called with.

```typescript
export function createSecurityHeaders(options?: SecurityHeadersOptions): Middleware {
  const scriptSrc = options?.scriptSrc ?? ["'self'", NONCE];   // captured once
  return async (c, next) => next();                            // request work uses `c`
}
```

### 1c. Constants Are Acceptable

Module-level **immutable** constants are fine — a default field name, a size cap, a header name.

```typescript
export const CSRF_FIELD_DEFAULT = "_csrf";
export const HONEYPOT_FIELD_DEFAULT = "__surname";
```

One file owns each such value, and it is named in the source-of-truth register
([`AGENT_GUIDE.md`](./AGENT_GUIDE.md) §8) rather than restated anywhere else.

### 1d. Bare Constructors on Configuration Holders

[`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4a owns the `create*` / `resolve*` / `define*`
verbs and their exception class. This section owns only what they do not cover: the shape a
class takes when it holds configuration.

**A class holding configuration exposes a `create*` factory rather than a public constructor.**
Where a class is unavoidable, pair a `private constructor` with a `static create`. The rule
targets *configuration holders* — objects that would otherwise expose partially-initialised
state to a caller who has no way to tell.

**A carve-out is written down or it does not exist.** Where a public constructor is genuinely
correct — an app object whose constructor takes only optional collaborators, for instance — the
exception is recorded in the repository's `implementation/` docs and in
[`CODE_REVIEW.md`](./CODE_REVIEW.md) §6, so a reviewer does not re-litigate it every pass.

### 1e. Browser-Only Modules Are Exempt

**§1a does not apply to modules that never execute in a Worker.** Its prohibition is on
*request-scoped* data and its rationale is isolate recycling; a module loaded only by the browser
has neither a request nor an isolate to bleed between. Its module scope is the page, and it is
discarded on navigation.

Module-level mutable state is therefore the house style in browser-only code — reactive-graph
bookkeeping, mounted-controller registries, per-document caches. Rewriting them as factories
would buy nothing: there is one document, and these are page-scoped singletons by nature.
[`BOUNDARIES.md`](./BOUNDARIES.md) §1 owns the import-path boundary that makes the exemption
safe.

**Stating it explicitly rather than leaving it implied**, because the alternative is a recurring
review finding against browser-only files that carry no exemption marker and need none.

**§4a still applies in full.** Page-scoped state that outlives a test is state a test has to be
able to reset. Where module state is observable, ship the seam that drains it — a disposer, a
registry keyed on `Document`, an explicit reset. Where there is no such seam, tests must not
depend on the order they run in.

---

## 2. Explicit Errors via Result Monad

**There is exactly one result primitive, with a single `error` failure field.** Return a
`Result` for expected failures rather than throwing; build values with `ok()` / `err()`; wrap a
throwing call with `result()`.

[`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 owns the primitive, its constructors, and its
domain aliases.

### 2a. When to Throw vs Return Result

[`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5a owns the split between an expected failure that
returns a `Result` and the programming error that throws;
[`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e owns the startup-invariant case. This section
adds no rule to either, only the canonical illustration.

A component that merges props onto a single element child cannot accept a string, fragment,
array, or empty child, so it throws rather than emitting malformed markup:

```tsx
if (asChild && !isValidElement(children)) {
  throw new Error("Button with asChild requires exactly one JSX element child");
}
```

That is a caller bug surfaced at render time — not an expected runtime failure — so a throw is
correct where a parse or validation failure would return a `Result`.

---

## 3. Validation First Rule

### 3a. Validate at System Boundaries

**Validate all untrusted input — form data, request params, env vars — before it enters
business logic.** The boundary is the handler or the config loader.
[`BOUNDARIES.md`](./BOUNDARIES.md) §3 owns the rule and the ordered pipeline.

### 3b. The Validation Facade

**All validation goes through the single validation facade the project publishes. Never import
the underlying schema library directly** — not in application code, not in a shared namespace,
not in a test. Schemas are built from the facade's re-exported combinators, so a version bump to
the library reaches every schema through one file.

```typescript
import { v } from "../validation";   // the facade, never the schema library
const Schema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) });
```

A direct import bypasses the facade exactly as production code would and will not follow a
version bump; that is why the ban reaches test files too.

### 3c. Abort-Early Validation

**Use `{ abortEarly: true }` in the facade's `v.safeParse` call for form validation** so the
first failing field is reported immediately. Omit the flag when a response must enumerate every
error.

---

## 4. Testability Rule

**Every source file has a co-located test file, and dependencies are faked rather than mocked.**
[`TESTING.md`](./TESTING.md) §2 and §4 own both rules.

### 4a. No Globals to Mock

Because the codebase uses factory functions and Web-standard APIs, **tests call functions
directly without mocking global state**. A function that cannot be tested without a mock is a
design signal: make its dependency an argument.

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

Exactly three forms of comment are allowed in the source tree. Nothing else is.

**Machine-readable directives are not comments and are outside this budget entirely** — they are
compiler or tooling *input* that happens to use comment syntax: `@jsx*` pragmas, `biome-ignore`,
lint suppressions, and project-specific allow markers. Never delete one. Where a directive
carries a human-readable reason field, that reason must be **self-contained**: a reason reading
"see the note above" breaks the moment the note it points at is deleted. Write it so it survives
alone.

**1. One line of TSDoc on an exported symbol.** One sentence, on one line, saying what the
symbol does. Not why it exists, not what it does not do, not what was considered instead.

```typescript
/** Creates an app with a structured error boundary, wiring middleware → routes → assets. */
export function createApp<Bindings extends object = Record<string, unknown>>(
  options?: AppOptions<Bindings>,
): App<Bindings>
```

**2. The visibility tags `@public` and `@internal`.** These are machine-readable markers, not
prose. `@internal` is what keeps a symbol out of the published surface without keeping it out of
cross-module use. They append to the TSDoc line and do not earn it extra lines.

**3. A rare inline comment carrying a genuinely non-obvious *why*.** This is the exceptional
case, and it is exceptional in the literal sense — most files contain zero. It is permitted only
when all four hold:

- the *what* is already plain from the code, and only the *why* is missing;
- the reason is external to the file — a spec quirk, a browser or runtime bug, a wire-format
  constraint, a security invariant that a plausible "simplification" would silently break;
- a reader who did not know it would reasonably change the code and be wrong;
- it fits in one or two lines.

```typescript
// The platform rewrites this header at the edge, so the inbound value is not the client's.
const clientIp = trustedClientIp(request) ?? fallbackIp(request);
```

### 5b. Forbidden Outright

Delete these on sight, in existing code as readily as in new code. No deprecation window, no
"leave it for now" — an unbudgeted comment is removed in whatever change touches the file.

- **Multi-paragraph TSDoc.** Design rationale, alternatives weighed, history, numbered
  justifications, "for four reasons", "two earlier attempts were wrong".
- **`@example` blocks.** A signature plus a one-line summary is the usage documentation. If an
  API genuinely cannot be used from its types, that is an API defect — fix the API.
  Consumer-facing usage belongs in the unit's `README.md` or its governing document, where it
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
| A portable architectural rule, boundary, or trade-off | the governing `governance/` doc |
| A ruling specific to this repository | the matching `implementation/` doc |
| Consumer-facing usage, examples, recipes | the unit's `README.md` |
| A claim about behaviour | a test that asserts it |
| Work not yet done | a ledger task |
| The history of a decision | the commit message |
| A capability the repository deliberately does **not** have | the matching `implementation/` doc |

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

---

## 7. Name Distinctiveness Rule

### 7a. The Name Is the First Hop

**A symbol you cannot name, you cannot navigate to — by any tool.** Once a symbol is in hand,
its definition, its references, and its type are all exact and cost one lookup. Nothing supplies
the symbol itself. A question arrives as words — *where is the retry delay computed* — and the
only index from those words to the code is the words already in the code.

This is the division of labour `CLAUDE.md` *Code Intelligence* states, seen from the other end:
**discovery is name-shaped, understanding is tool-shaped.** §7 governs the first half only. A
symbol whose name carries no word from its domain is unreachable by the question that should
find it, and stays unreachable until someone happens on it while reading something else.

### 7b. One Domain Word — and No More Than the Domain Needs

**Every exported symbol carries at least one word naming its domain, not only its shape.** The
verb rule fixes the prefix and the suffix rules fix the tail: `create*` says a factory is being
called, `*Options` says a bag of knobs is being passed. Neither says *what of*. A name assembled
only from those parts — `createClient`, `createStore`, `createLogger` — is a prefix and a shape
with nothing between them, and the missing middle is the only part a question can match on. §1d
owns the verb; this section owns the word the verb is applied to.

```typescript
export function createSecurityHeaders(options?: SecurityHeadersOptions): Middleware   // nameable
export function createMiddleware(options?: SecurityHeadersOptions): Middleware        // shape only
```

**The floor is one domain word. It is also, near enough, the ceiling.** Past that word, added
words buy nothing a reader or a tool did not already have: references resolve exactly whichever
name is chosen, so a longer name purchases precision that is already supplied and charges it to
every call site that has to read and retype it. `createStripeApiClientFactory` is a defect in the
same way `createClient` is — one name says nothing, the other says one thing four times. **This
is a floor of one domain word, not a target to exceed.** The terseness §6 asks for applies here
unchanged.

### 7c. One Spelling Per Concept

**One concept, one word, across the whole tree.** Where `org`, `customer`, and `tenant` all name
the same entity, the codebase holds three names for one thing and no way to say so.

The cost is not retrieval — a reference lookup finds the symbol under any spelling. It is
comprehension: a reader holding two words for one entity cannot tell whether the code models one
thing or two, and the safe assumption is two. That reader writes a second helper beside a first
that already did the job, and the synonym pair becomes a real duplicate.

**An import alias is the same defect at smaller scale.** Renaming a symbol at its call site
replaces a name the codebase agreed on with one only that file knows, so a reader arriving with
the agreed word does not find it there. Alias to resolve a genuine collision, never for taste.

### 7d. Parameters Distinguished by Type, Not Order

**Where two or more parameters share a primitive type, the signature admits a swapped-argument
bug that nothing catches.** Hover shows the parameter names, but a transposed pair of same-typed
arguments typechecks, lints, and ships:

```typescript
function grantAccess(userId: string, resourceId: string, role: string): Result<Grant>
grantAccess(resourceId, userId, role)   // compiles, and is wrong
```

**Give the compiler something to reject** — a branded or wrapper type per argument, or a single
named options object. Either turns the transposition into a type error:

```typescript
function grantAccess(grant: { userId: UserId; resourceId: ResourceId; role: Role }): Result<Grant>
```

The compiler is the one reviewer that cannot be skipped, and this is the cheapest class of bug to
hand it. Distinct from §3, which governs *untrusted* input arriving at a boundary: §7d governs
*internal* signatures, where the values are already trusted and the whole risk is positional.
