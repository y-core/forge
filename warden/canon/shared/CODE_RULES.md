---
title: Code Rules
description: "The non-negotiable coding rules: zero global state, explicit errors, validation first, testability, the comment budget, declarative style, and name distinctiveness."
---

# Code Rules

> The non-negotiable rules for every TypeScript file in the repository, keeping it testable, predictable, and safe in the Cloudflare Workers
> runtime.
>
> Defers to: `ERROR_HANDLING.md` §1 for the `Result` primitive; `TESTING.md` for test placement and fake patterns; `BOUNDARIES.md` for the
> boundaries these rules serve.

---

## 0. Quick Reference

- §1 Zero Global State Rule: request state never lives at module scope
- §1a No Module-Level Mutable Variables: why isolates make this unsafe
- §1b Factory Function Pattern: capture config, not request state
- §1c Constants Are Acceptable: the permitted module-level form
- §1d Factory Verbs and Bare Constructors: `create*` / `resolve*` / `define*`, and the private-constructor rule
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
- §5e A Behavioural Claim Is an Assertion: find the test that pins it, or write it
- §5f A Field Is a Symbol: a gloss that spells the field name back earns nothing
- §5g A Count Is Not a Comment: no tally of the things a reader can already see
- §6 Declarative Over Imperative Rule: expression over statement
- §7 Name Distinctiveness Rule: a name is the only index from a question to the code
- §7a The Name Is the First Hop: discovery is name-shaped, understanding is LSP-shaped
- §7b One Domain Word — and No More Than the Domain Needs: the floor, and the ceiling beside it
- §7c One Spelling Per Concept: two words for one entity get built twice
- §7d Parameters Distinguished by Type, Not Order: make the compiler reject the transposition

---

## 1. Zero Global State Rule

### 1a. No Module-Level Mutable Variables

**Never store request-scoped data in a module-level variable.** Each Workers isolate handles one request at a time, but isolates are recycled —
module-level mutations bleed between requests sharing a module instance.

The prohibition and its rationale are both scoped to **request-scoped data in a Worker**. Code that never executes in a Worker is covered by §1e,
not by this rule.

```ts
let currentUser: User | null = null; // never do this
```

**Inject state as factory parameters, or read it from the request context** (`c.env`, a `contextVar` accessor).

### 1b. Factory Function Pattern

**Use a factory to create stateful behaviour.** The factory captures configuration — immutable after creation — never request state. The options
object is captured once, at creation time; everything request-scoped is read off the context the returned function is called with.

```ts
export function createSecurityHeaders(options?: SecurityHeadersOptions): Middleware {
  const scriptSrc = options?.scriptSrc ?? ["'self'", NONCE]; // captured once
  return async (c, next) => next(); // request work uses `c`
}
```

### 1c. Constants Are Acceptable

Module-level **immutable** constants are fine — a default field name, a size cap, a header name.

```ts
export const CSRF_FIELD_DEFAULT = "_csrf";
export const CSRF_HEADER_DEFAULT = "X-CSRF-Token";
```

One file owns each such value, and it is named in the source-of-truth register (`AGENT_GUIDE.md` §8) rather than restated anywhere else.

### 1d. Factory Verbs and Bare Constructors

**Each verb carries one rule:**

- **`create*`** names **any factory** that instantiates behaviour from captured configuration. Never `make*`, never `new*`.
- **`resolve*`** names a **request-time accessor** that reads a binding or a value off the context and fails closed when it is absent.
- **`define*`** names a **declarative configuration object** consumed by a builder.

A library corpus refines these verbs against its own layering — [`NAMESPACE_DESIGN.md`][nd-4a] §4a owns the value-constructor exception class and
the suffix rules that sit beside it.

**A class holding configuration exposes a `create*` factory rather than a public constructor.** Where a class is unavoidable, pair a
`private constructor` with a `static create`. The rule targets _configuration holders_ — objects that would otherwise expose partially-initialised
state to a caller who has no way to tell.

**A carve-out is written down or it does not exist.** Where a public constructor is genuinely correct — an app object whose constructor takes only
optional collaborators, for instance — the exception is recorded in the repository's `docs/` docs and in `CODE_REVIEW.md` §6, so a reviewer does
not re-litigate it every pass.

### 1e. Browser-Only Modules Are Exempt

**§1a does not apply to modules that never execute in a Worker.** Its prohibition is on _request-scoped_ data and its rationale is isolate
recycling; a module loaded only by the browser has neither a request nor an isolate to bleed between. Its module scope is the page, and it is
discarded on navigation.

Module-level mutable state is therefore the house style in browser-only code — reactive-graph bookkeeping, mounted-controller registries,
per-document caches. Rewriting them as factories would buy nothing: there is one document, and these are page-scoped singletons by nature.
`BOUNDARIES.md` §1 owns the import-path boundary that makes the exemption safe.

**Stating it explicitly rather than leaving it implied**, because the alternative is a recurring review finding against browser-only files that
carry no exemption marker and need none.

**§4a still applies in full.** Page-scoped state that outlives a test is state a test has to be able to reset. Where module state is observable,
ship the seam that drains it — a disposer, a registry keyed on `Document`, an explicit reset. Where there is no such seam, tests must not depend on
the order they run in.

---

## 2. Explicit Errors via Result Monad

**There is exactly one result primitive, with a single `error` failure field.** Return a `Result` for expected failures rather than throwing; build
values with `ok()` / `err()`; wrap a throwing call with `result()`.

`ERROR_HANDLING.md` §1 owns the primitive, its constructors, and its domain aliases.

### 2a. When to Throw vs Return Result

`ERROR_HANDLING.md` §5a owns the split between an expected failure that returns a `Result` and the programming error that throws;
`ERROR_HANDLING.md` §5e owns the startup-invariant case. This section adds no rule to either, only the canonical illustration.

A component that merges props onto a single element child cannot accept a string, fragment, array, or empty child, so it throws rather than emitting
malformed markup:

```tsx
if (asChild && !isValidElement(children)) {
  throw new Error("Button with asChild requires exactly one JSX element child");
}
```

That is a caller bug surfaced at render time — not an expected runtime failure — so a throw is correct where a parse or validation failure would
return a `Result`.

---

## 3. Validation First Rule

### 3a. Validate at System Boundaries

**Validate all untrusted input — form data, request params, env vars — before it enters business logic.** The boundary is the handler or the config
loader. `BOUNDARIES.md` §3 owns the rule and the ordered pipeline.

### 3b. The Validation Facade

**All validation goes through the single validation facade the project publishes. Never import the underlying schema library directly** — not in
application code, not in a shared namespace, not in a test. Schemas are built from the facade's re-exported combinators, so a version bump to the
library reaches every schema through one file.

The facade is reached by the spelling the repository publishes it under — a relative path to the namespace inside the library that owns it, the
published subpath from an application consuming that library:

```ts
import { v } from "../validation"; // inside the library that owns the facade
import { v } from "@y-core/forge/validation"; // from an application consuming it
const Schema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) });
```

A direct import bypasses the facade exactly as production code would and will not follow a version bump; that is why the ban reaches test files too.

### 3c. Abort-Early Validation

**Use `{ abortEarly: true }` in the facade's `v.safeParse` call for form validation** so the first failing field is reported immediately. Omit the
flag when a response must enumerate every error.

---

## 4. Testability Rule

**Every source file has a co-located test file, and dependencies are faked rather than mocked.** `TESTING.md` §2 and §4 own both rules.

### 4a. No Globals to Mock

Because the codebase uses factory functions and Web-standard APIs, **tests call functions directly without mocking global state**. A function that
cannot be tested without a mock is a design signal: make its dependency an argument.

---

## 5. Comment Budget Rule

**Code is the documentation; the tests are the use cases.** The code states the feature and its purpose. The tests state the use cases. A comment is
what is left when neither could be made to say it, and most of the time that is nothing. This rule is a _ceiling_, not a floor: §5a is the entire
permitted budget, and anything not named there is a defect to be deleted — not a judgement call, not a matter of taste, not something to leave
because it is already written.

Prose does not compile, is not typechecked, is not tested, and is not reachable by any gate. It therefore goes stale silently and asserts things no
one can verify. Every line of it is read — by a human or an agent — on every single pass over the file, and then discarded. That cost is paid
continuously; the comment's value is paid once, at most.

**A name is the alternative to a comment, and it is the better one.** The first fix for an unclear line is a better name, a smaller function, or a
named intermediate. Naming and convention done well leave no compelling reason for prose that regurgitates what is already evident. §7 is what makes
that possible, and §7a states the pairing from the naming end.

**Be draconian.** A second, third or fourth layer saying the same thing goes, unless it clarifies something that cannot be expressed any other way.
Duplicated prose promotes confusion and stale references on top of the debt it already is.

### 5a. The Entire Permitted Budget

Exactly three forms of comment are allowed in the source tree. Nothing else is.

**Machine-readable directives are not comments and are outside this budget entirely** — they are compiler or tooling _input_ that happens to use
comment syntax: `@jsx*` pragmas, `biome-ignore`, lint suppressions, and project-specific allow markers. Never delete one. Where a directive carries
a human-readable reason field, that reason must be **self-contained**: a reason reading "see the note above" breaks the moment the note it points at
is deleted. Write it so it survives alone.

**A linter override's reason in a configuration file is a directive reason, not source prose.** Where a repository's configuration baseline requires
one above every override, that requirement stands and this budget does not contradict it. The carve-out is scoped to the override it sits above; it
does not license prose elsewhere in the same file.

**1. One line of TSDoc on an exported symbol.** One sentence, on one line, saying what the symbol does. Not why it exists, not what it does not do,
not what was considered instead.

**The operative test is shape, not length: a TSDoc block closes on the line it opens on.** "Multi-paragraph" is a label an author writing three
wrapped lines does not apply to themselves; "closes on its opening line" is one they cannot avoid applying. This is also what a comment-budget gate
step checks, so the rule and the check say the same thing.

```ts
/** Creates an app with a structured error boundary, wiring middleware → routes → assets. */
export function createApp<Bindings extends object = Record<string, unknown>>(options?: AppOptions<Bindings>): App<Bindings>;
```

**2. The visibility tags `@public` and `@internal`.** These are machine-readable markers, not prose. `@internal` is what keeps a symbol out of the
published surface without keeping it out of cross-module use. They append to the TSDoc line and do not earn it extra lines.

**3. A rare inline comment carrying a genuinely non-obvious _why_.** This is the exceptional case, and it is exceptional in the literal sense — most
files contain zero. It is permitted only when all four hold:

- the _what_ is already plain from the code, and only the _why_ is missing;
- the reason is external to the file — a spec quirk, a browser or runtime bug, a wire-format constraint, a security invariant that a plausible
  "simplification" would silently break;
- a reader who did not know it would reasonably change the code and be wrong;
- it fits in one or two lines.

```ts
// The platform rewrites this header at the edge, so the inbound value is not the client's.
const clientIp = trustedClientIp(request) ?? fallbackIp(request);
```

### 5b. Forbidden Outright

Delete these on sight, in existing code as readily as in new code. No deprecation window, no "leave it for now" — an unbudgeted comment is removed
in whatever change touches the file.

- **Multi-paragraph TSDoc.** Design rationale, alternatives weighed, history, numbered justifications, "for four reasons", "two earlier attempts
  were wrong".
- **`@example` blocks.** A signature plus a one-line summary is the usage documentation. If an API genuinely cannot be used from its types, that is
  an API defect — fix the API. Consumer-facing usage belongs in the unit's `README.md` or its governing document, where it has a single home and
  does not ride along in every read of the source.
- **Restating the code.** `// increment the counter`, `// Returns true if valid`. §5f owns the interface-field form of this defect.
- **Section banners and separators.** `// ---- helpers ----`, `// === Types ===`, box-drawing rules. File structure is what files and exports are
  for.
- **Commented-out code.** Git holds it.
- **Narration of the obvious.** `// Guard clause`, `// Early return`, `// Loop over items`.
- **Self-referential meta-commentary.** A comment about why a comment exists, or about what a previous attempt at the comment got wrong, is never
  load-bearing.
- **Justifying a decision the code cannot observe.** If two orderings, spellings, or shapes are provably indistinguishable to every caller, the
  choice needs no defence in the source. If it genuinely matters, a _test_ asserts it — a comment cannot.
- **TODO / FIXME / XXX.** Unactionable in-band. Open a ledger task.

### 5c. Where Rationale Belongs Instead

The instinct behind a long comment is usually sound — the reasoning is real and worth keeping. It is the _placement_ that is wrong. Route it to the
one place that owns it:

| The content is… | Its single home |
| --- | --- |
| A portable architectural rule, boundary, or trade-off | the governing canon document |
| A ruling specific to this repository | the matching `docs/` doc |
| Consumer-facing usage, examples, recipes | the unit's `README.md` |
| A claim about behaviour | a test that asserts it (§5e owns the procedure) |
| Work not yet done | a ledger task |
| The history of a decision | the commit message |
| A capability the repository deliberately does **not** have | the matching `docs/` doc |

A comment that could live in any row above does not also live in the source. Duplicating it there is how the two copies drift.

### 5d. Tests Are Not Exempt

A test name is the test's documentation, and it is the one form of description that runs. A test whose intent needs a comment needs a better name.
The same budget applies to `*.test.ts` / `*.test.tsx`, with one addition: a fixture holding a deliberately malformed or adversarial value may carry
a one-line note saying what makes it malformed, when that is not visible from the literal itself.

### 5e. A Behavioural Claim Is an Assertion

**A behavioural claim is an assertion, not a sentence.** Where a comment asserts behaviour, find the test that pins it. If none does, the assertion
is what was missing: write it, then delete the prose. A sentence claiming behaviour nothing asserts is a claim no reader can falsify and every
reader must re-read.

The procedure, in order:

1. **Read the claim as a proposition.** "Returns the cached value when the entry has not expired" is a proposition about behaviour; "this is the
   cache module" is not, and is deleted under §5b without further work.
2. **Find the test that pins it.** A reference lookup on the symbol, then the co-located test file.
3. **Where none does, the assertion is the missing work** — not a reason to keep the comment. Write the test.
4. **Then delete the prose.** The claim now lives where it is executed, and a change that breaks it fails rather than lies.

**A claim deleted without an assertion added leaves the change incomplete**, because the system lost a statement of its own behaviour and gained
nothing that holds it. `TESTING.md` §3f states the same handoff from the receiving end.

### 5f. A Field Is a Symbol

**A field is a symbol, judged as one.** An interface field earns at most one line, and earns nothing when its name and its type already say it. A
line that adds a default, a unit, a constraint or a caveat earns its place; one that spells the field name back in words does not.

```ts
interface ScanOptions {
  /** Repository root. */ root: string; // earns nothing — the words reduce to the field's own name
  /** The directories. */ dirs?: string[]; // earns nothing
  /** Max bytes. */ maxBytes?: number; // earns nothing
}
```

```ts
interface ScanOptions {
  /** Repository root; every reported path is relative to it. */ root: string;
  /** Directories walked for source files. Defaults to `["src"]`. */ dirs?: string[];
  /** Hard ceiling in bytes; a larger file is skipped, not truncated. */ maxBytes?: number;
}
```

The passing lines carry a fact the signature does not: a relationship, a default, a unit, a failure mode. The failing ones carry the field name
again. Where neither is available, the line itself is what goes — a field with no gloss at all is the ordinary case, not an omission.

**§7's naming rules apply to a field exactly as to an export.** A field whose gloss is the only thing making it comprehensible has a naming defect,
and §7b is the fix — not the gloss. A field-gloss rule in a comment-budget gate step is what makes this checkable rather than advisory.

### 5g. A Count Is Not a Comment

**A comment counts nothing.** `AGENT_GUIDE.md` §9b owns the reasoning and the test; it binds a TSDoc line and an inline comment exactly as it binds
a governing document, so a tally of the exports below, the branches handled, or the callers affected is deleted on sight. §5b already names
`"for four reasons"` and `"two earlier attempts"` among the forbidden spellings — this extends that list rather than opening a new one.

A number that is a unit, a spec or RFC citation, a limit the code enforces, or an inline enumeration whose items immediately follow it is not a
tally.

---

## 6. Declarative Over Imperative Rule

- **Prefer array methods over loops** — `origins.filter(o => o.startsWith("https://"))`, not an accumulator loop.
- **Prefer object spread over mutation** — `{ ...defaults, ...overrides }`, not assign-then-patch.
- **Prefer nullish coalescing and optional chaining** — `input ?? fallback`, `user?.profile?.displayName`.

The rule is about expressing intent, not about avoiding loops on principle: reach for a loop when the operation genuinely is sequential or
early-exiting.

---

## 7. Name Distinctiveness Rule

### 7a. The Name Is the First Hop

**A symbol you cannot name, you cannot navigate to — by any tool.** Once a symbol is in hand, its definition, its references, and its type are all
exact and cost one lookup. Nothing supplies the symbol itself. A question arrives as words — _where is the retry delay computed_ — and the only
index from those words to the code is the words already in the code.

This is the division of labour `AGENT_WORKFLOW.md` §2 states, seen from the other end: **discovery is name-shaped, understanding is
tool-shaped.** §7 governs the first half only. A symbol whose name carries no word from its domain is unreachable by the question that should find
it, and stays unreachable until someone happens on it while reading something else.

**This is also the other half of §5.** A name is what §5 reaches for before a comment, and §7 is what makes that reach succeed: the budget can be a
ceiling only because naming is expected to carry the weight prose would otherwise be asked to.

### 7b. One Domain Word — and No More Than the Domain Needs

**Every exported symbol carries at least one word naming its domain, not only its shape.** The verb rule fixes the prefix and the suffix rules fix
the tail: `create*` says a factory is being called, `*Options` says a bag of knobs is being passed. Neither says _what of_. A name assembled only
from those parts — `createClient`, `createStore`, `createLogger` — is a prefix and a shape with nothing between them, and the missing middle is the
only part a question can match on. §1d owns the verb; this section owns the word the verb is applied to.

```ts
export function createSecurityHeaders(options?: SecurityHeadersOptions): Middleware; // nameable from a question
export function createMiddleware(options?: SecurityHeadersOptions): Middleware; // prefix and shape only
```

**The floor is one domain word. It is also, near enough, the ceiling.** Past that word, added words buy nothing a reader or a tool did not already
have: references resolve exactly whichever name is chosen, so a longer name purchases precision that is already supplied and charges it to every
call site that has to read and retype it. `createStripeApiClientFactory` is a defect in the same way `createClient` is — one name says nothing, the
other says one thing four times. **This is a floor of one domain word, not a target to exceed.** The terseness §6 asks for applies here unchanged.

### 7c. One Spelling Per Concept

**One concept, one word, across the whole tree.** Where `org`, `customer`, and `tenant` all name the same entity, the codebase holds three names for
one thing and no way to say so.

The cost is not retrieval — a reference lookup finds the symbol under any spelling. It is comprehension: a reader holding two words for one entity
cannot tell whether the code models one thing or two, and the safe assumption is two. That reader writes a second helper beside a first that already
did the job, and the synonym pair becomes a real duplicate.

**An import alias is the same defect at smaller scale.** Renaming a symbol at its call site replaces a name the codebase agreed on with one only
that file knows, so a reader arriving with the agreed word does not find it there. Alias to resolve a genuine collision, never for taste.

### 7d. Parameters Distinguished by Type, Not Order

**Where two or more parameters share a primitive type, the signature admits a swapped-argument bug that nothing catches.** Hover shows the parameter
names, but a transposed pair of same-typed arguments typechecks, lints, and ships:

```ts
function grantAccess(userId: string, resourceId: string, role: string): Result<Grant>;
grantAccess(resourceId, userId, role); // compiles, and is wrong
```

**Give the compiler something to reject** — a branded or wrapper type per argument, or a single named options object. Either turns the transposition
into a type error:

```ts
function grantAccess(grant: { userId: UserId; resourceId: ResourceId; role: Role }): Result<Grant>;
```

The compiler is the one reviewer that cannot be skipped, and this is the cheapest class of bug to hand it. Distinct from §3, which governs
_untrusted_ input arriving at a boundary: §7d governs _internal_ signatures, where the values are already trusted and the whole risk is positional.

[nd-4a]: ../libs/NAMESPACE_DESIGN.md#4a-factory-and-accessor-verbs
