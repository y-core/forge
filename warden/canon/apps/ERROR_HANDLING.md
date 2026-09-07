---
title: Error Handling
description: "The one Result primitive, how failures cross a layer boundary, the fragment-versus-page rendering decision, and the three-way error taxonomy."
---

# Error Handling

> Owns the `Result` primitive, the rendering decision for a failed request, and the error
> taxonomy every layer classifies against. Other documents link here rather than restating them.
>
> Defers to: [`BOUNDARIES.md`](./BOUNDARIES.md) §5 for the fail-closed posture;
> [`BOUNDARIES.md`](./BOUNDARIES.md) §2d for rejection status discipline;
> [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §2 for the layers a failure crosses.

---

## 0. Quick Reference

- §1 Result Monad: the single failure channel and its constructors
- §1a The Unified Result Primitive: `Result<T,E>`, `ok`/`err`, `result`, `toError`
- §1b Narrowing a Result: the single guard and the early return
- §1c Domain Aliases: shapes that narrow only the failure type
- §2 Failures Crossing a Layer Boundary: what each layer may return
- §2a Never Return a Bare Nullable: why absence loses the reason
- §2b A Service Returns a Result, Never a Response: rendering is the handler's
- §2c Never Throw Across a Layer Boundary: the caller cannot see it
- §3 Rendering a Failure to a Client: fragment, page, and what is never sent
- §3a Fragment Versus Full Page: the swap target decides
- §3b What a Client Never Receives: stacks, reason codes, internal detail
- §3c Status Codes Are Part of the Contract: pointer to the discipline
- §4 Fail-Closed Posture: the pointer, and the protected error response
- §4a Where the Posture Is Owned: the single home for the rule
- §4b No Error Path Ships an Unprotected Response: chain depth and headers
- §5 Error Taxonomy: expected, unexpected, and infrastructure failures
- §5a Expected Errors: user input and business rules, not exceptions
- §5b Unexpected Errors: let them reach the boundary, then fix them
- §5c Infrastructure Errors: log with the request id, then fail closed
- §5d Per-Route Recovery Hooks: the deliberate page/fragment divergence
- §5e Startup Invariants: config and resolvers throw

---

## 1. Result Monad

### 1a. The Unified `Result` Primitive

There is exactly **one** result primitive, taken from the shared library rather than redefined
per application:

```ts
import { ok, err, result, toError, type Result } from "@y-core/forge/result";

type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };
```

**Return `Result` from any function that can fail predictably** — a service call, a parse, a
lookup.

**There is exactly one failure field: `error`.** No `errors`, no `reason`, no `message`. A second
failure field is how a codebase ends up with two half-honoured conventions and call sites
checking the wrong one.

**Build values with `ok()` / `err()`, never object literals.** They are the one documented
exception to the `create*` naming rule
([`CODE_RULES.md`](./CODE_RULES.md) §1d): they construct values, not
configured objects.

### 1b. Narrowing a Result

**Narrow with a single `if (!r.ok)` guard and return early.** Chaining by early return keeps the
happy path at the left margin; nesting does not.

```ts
const parsed = validateContact(formData);
if (!parsed.ok) return fragmentResponse(renderValidationErrors(parsed.error), 422);
const contact = parsed.data; // narrowed — no cast
```

**A cast after a `Result` check is a defect.** The discriminant exists so the narrowing is free;
reaching for `as` means the guard was written in a shape the compiler cannot follow, and the fix
is the guard.

### 1c. Domain Aliases

A domain alias narrows **only** the failure type. The discriminant stays `ok`; the failure
channel stays `error`.

- A **validation result** carries a flat list of already-formatted messages, one per failing
  field, ready to render. Do not collapse them into a single error — the list is what lets a
  response surface every failing field at once.
- A **guard result** carries no success value and fails with a reason code, typically a
  string-literal union.

**Never echo a guard's reason code to a client.** It is a server diagnostic that names which
check failed — exactly what a probing client is trying to learn.

---

## 2. Failures Crossing a Layer Boundary

### 2a. Never Return a Bare Nullable

**A function that can fail does not return `T | null` or `T | undefined`.** A nullable return
collapses every distinct failure into one indistinguishable absence, so the caller cannot tell
"not found" from "malformed" from "the binding was missing" — and it invites `??`, which turns a
failure into a default.

`undefined` remains correct for a value that is _legitimately optional_, where absence is not a
failure and carries no reason worth reporting.

### 2b. A Service Returns a Result, Never a Response

**A service reports what happened; the handler decides what the user sees.** A service that
returns a `Response`, renders a fragment, or picks a status code has taken the handler's job and
is unusable from a second route that would present the same failure differently.

This is the error-path half of the layer rule in
[`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §2c, and it fails the same way: the first reuse
reveals it.

### 2c. Never Throw Across a Layer Boundary

**A throw is invisible in a signature.** A caller reading the type learns nothing about it, gets
no compiler pressure to handle it, and discovers it in production.

The exceptions are enumerated and small: programming errors (§5b), and startup invariants (§5e).
Both are conditions no caller could have handled anyway.

---

## 3. Rendering a Failure to a Client

### 3a. Fragment Versus Full Page

**What the client receives is decided by what it will do with the response, not by the severity
of the error.**

- A response the client will **swap into an existing page** returns a _fragment_ — partial markup
  with no document wrapper — so the surrounding page survives and the user keeps their input.
- A response that **is** the navigation returns a _full page_, with the document wrapper and the
  application's full header policy.

**Set the status on the response builder, not on the renderer.** A renderer returns markup; the
status is a property of the HTTP response. Splitting them means one renderer serves every status
instead of one renderer per status.

**A fragment must target the element the client asked it to replace.** A fragment that renders
correctly into the wrong target is a worse failure than an error page, because it looks like it
worked.

### 3b. What a Client Never Receives

**A stack trace, ever.** Not in production, not behind a header, not "just this once" — a stack
names internal paths, module structure, and often argument values.

**A guard reason code, ever** (§1c). **A raw exception message from an external service**, which
routinely embeds request URLs, keys, and account identifiers.

A message derived from an exception is permitted **only under an explicit debug predicate**, and
it is escaped on the way out like any other untrusted string — the message may embed input the
client itself supplied.

### 3c. Status Codes Are Part of the Contract

[`BOUNDARIES.md`](./BOUNDARIES.md) §2d owns which status each class of refusal returns. It is
cited rather than restated because a fail-case test asserts the exact number
([`TESTING.md`](./TESTING.md) §5), and two copies of a status table is how that test starts
asserting the wrong one.

---

## 4. Fail-Closed Posture

### 4a. Where the Posture Is Owned

[`BOUNDARIES.md`](./BOUNDARIES.md) §5 owns the fail-closed rule, the `required: false`
asymmetry, the no-silent-swallowing rule, and the conditions under which a fail-open exception
may be ratified. This section restates none of it and owns only what is specific to the error
path.

### 4b. No Error Path Ships an Unprotected Response

**An error response carries the same hardening a success response would**, and where it cannot,
it carries a self-contained baseline instead.

The distinction is chain depth. An error thrown _inside_ the middleware chain unwinds through
it, so the response still reaches whatever queues security headers. An error thrown _outside_ it
— during config resolution, before routing — never reaches the application's middleware, so the
platform handler emits a **baseline-hardened** response: no sniffing, a maximally restrictive
content policy, no referrer.

This is why the global chain queues headers **before** calling downstream
([`BOUNDARIES.md`](./BOUNDARIES.md) §2a). Middleware that queues on the way out contributes
nothing to a response that never comes back through it.

The consequence worth holding on to: **an error page is the response most likely to be rendered
with attacker-influenced content**, so it is the last place a header policy should be missing.

---

## 5. Error Taxonomy

### 5a. Expected Errors — User Input and Business Rules

Predictable outcomes of valid interactions: a missing required field, a malformed email, a
message below the minimum length, a duplicate submission. **These are not exceptional and are
not logged at error level** — they are user-generated, and logging them at error level drowns
the signal that matters.

**Return a `Result` from the validating or deciding function**, and render the failure from the
handler (§3a). **Never throw** — a throw hides the error path from the type system and forces
callers into `try/catch`.

### 5b. Unexpected Errors — Programming Defects

Type errors, null dereferences, unreachable branches actually reached. **Let them propagate.**
The framework's error boundary catches them, returns a `500` that exposes nothing (§3b), and
logs them at error level with a stack.

**Do not handle them defensively in application code.** A defensive catch around a programming
defect converts a loud, fixable failure into a quiet, permanent one — and the code that catches
it cannot know what state the half-executed operation left behind.

The one throw that _belongs_ in application code is a **contract violation by a caller** — an
argument shape the function forbids. That is a bug being surfaced, not a condition being handled.

### 5c. Infrastructure Errors — External Service Failures

Transient or permanent unavailability of something external: an upstream API returning `5xx`, a
storage write timing out, a verification endpoint unreachable.

**Catch at the service call site, log at error level with the request id, and return `503`.**

```ts
const sent = await emailService.send(contact);
if (!sent.ok) {
  requestLog.get(c).error("email: send failed", { error: sent.error.message });
  return fragmentResponse(renderError("Service temporarily unavailable. Please try again later."), 503);
}
```

`503` rather than `500`, because the distinction is actionable: `500` says fix the code, `503`
says retry or check the dependency. Log enough to diagnose — service, operation, sanitised
identifiers — and never user-supplied content ([`BOUNDARIES.md`](./BOUNDARIES.md) §4).

### 5d. Per-Route Recovery Hooks

A declarative handler builder accepts a recovery hook, and **the default differs by handler kind
on purpose**:

- A **full-page** handler with no hook lets the error **re-throw**, so the boundary renders the
  whole document. A half-rendered navigation is worse than an error page.
- A **fragment** handler with no hook returns a **self-contained error fragment**, because it is
  swapping into a page that is already correct.

**Both log on the way out.** The difference is only in what the client receives, never in whether
the failure is recorded. **Use these hooks for per-route recovery instead of ad-hoc `try/catch`**,
which is invisible to a reader auditing the route map.

### 5e. Startup Invariants — Config and Resolvers Throw

A missing or malformed binding is a **deployment defect**, not a runtime condition to degrade
around. Config access, environment validation, and request-time binding resolvers **throw** a
plain error rather than returning a `Result`.

**The dividing line: resolving a binding throws; operating on a resolved store returns
`Result`.** Resolution failure is unrecoverable and identical for every request; an operation
failure is per-request and often handleable.

**Environment failures throw one normalized shape**, produced by the shared formatter rather than
hand-rolled per call site — otherwise the error a developer sees most often during deployment is
the one with the least consistent text
([`WORKERS_PLATFORM.md`](./WORKERS_PLATFORM.md) §4d).
