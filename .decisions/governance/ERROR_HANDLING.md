---
title: Error Handling
description: "The one Result primitive and its narrowing rule, how failures cross module and HTTP boundaries, the fail-closed posture, and the error taxonomy."
---

# Error Handling

> Owns the `Result` primitive, its domain aliases, and the error taxonomy every namespace
> classifies against. Other documents link here rather than restating the primitive.
>
> Defers to: [`BOUNDARIES.md`](./BOUNDARIES.md) §5 for the fail-closed posture;
> [`BOUNDARIES.md`](./BOUNDARIES.md) §3 for the validation pipeline that produces a validation
> failure; [`TESTING.md`](./TESTING.md) §5 for the tests an error path requires.

---

## 0. Quick Reference

- §1 Result Monad: the single failure channel and its constructors
- §1a The Unified `Result` Primitive: one primitive, one failure field, constructed not literalled
- §1b Narrowing a Result: the single guard and the early return
- §1c Domain Aliases: shapes that narrow only the failure type
- §2 Failures Crossing a Module Boundary: what a public signature may say
- §2a Never Return a Bare Nullable: why `null | T` loses the reason
- §2b Never Throw Across a Namespace Boundary: the caller cannot see it
- §3 Rendering a Failure to a Client: fragment, page, and what is never sent
- §3a Fragment Versus Full Page: the swap target decides
- §3b What a Client Never Receives: stacks, reason codes, internal identifiers
- §4 Fail-Closed Posture: the pointer, and the baseline-hardened error response
- §4a Where the Posture Is Owned: the single home for the rule
- §4b No Error Path Ships an Unprotected Response: the out-of-chain baseline
- §5 Error Taxonomy: expected, unexpected, and infrastructure failures
- §5a Expected Errors — Return `Result`: return it, never throw
- §5b Unexpected Errors and the Error Boundary: depth and header guarantees
- §5c Infrastructure Errors — Log and Fail Closed: log with context, then refuse
- §5d Per-Route Recovery Hooks: the deliberate page/action divergence
- §5e Startup Invariants — Resolvers Throw: operations still return a `Result`

---

## 1. Result Monad

### 1a. The Unified `Result` Primitive

There is exactly **one** result primitive, published from a single namespace, discriminated on an
`ok` boolean. The repository's own `implementation/ERROR_HANDLING.md` §1a publishes its exact
signatures and the subpath they are imported from; this section carries only the rules they obey.

**Return `Result` from any function that can fail predictably.**

**There is exactly one failure field: `error`.** No `errors`, no `reason`, no `message` — every
domain shape reuses that one channel. Success carries `data`. A second failure field is how a
codebase ends up with two half-honoured conventions and call sites that check the wrong one.

**Build values with `ok()` / `err()`, never object literals.** They are the one documented
exception to the `create*` naming rule
([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4a): they construct values, not configured
objects.

### 1b. Narrowing a Result

**Narrow with a single `if (!r.ok)` guard and return early.** Chaining by early return keeps the
happy path at the left margin; nesting does not. After the guard, the success branch is narrowed
by the discriminant alone.

**A cast after a `Result` check is a defect.** The discriminant exists so the narrowing is free;
reaching for `as` means the guard was written in a shape the compiler cannot follow, and the fix
is the guard.

### 1c. Domain Aliases

A domain alias is a plain alias that narrows **only** the failure type `E`. The discriminant
stays `ok`; the failure channel stays `error`.

**A validation result carries a flat list of already-formatted messages** in `error` — one per
failing field, ready to render. Do not collapse the issues into a single `Error`: the list is
what lets a response surface every failing field at once instead of one at a time.

**A guard result is for predicate checks that produce no success value** — origin, CSRF,
challenge verification. Its failure type is typically a string-literal union of reason codes.

**Never echo a guard's reason code to a client.** It is a server diagnostic, and it describes
which check failed — which is exactly the information an attacker is probing for.

---

## 2. Failures Crossing a Module Boundary

### 2a. Never Return a Bare Nullable

**A public function that can fail does not return `T | null` or `T | undefined`.** A nullable
return collapses every distinct failure into one indistinguishable absence, so the caller cannot
tell "not found" from "malformed" from "the binding was missing" — and it silently invites
`??`, which turns a failure into a default.

`undefined` remains correct for a value that is *legitimately optional*, where absence is not a
failure and carries no reason worth reporting.

### 2b. Never Throw Across a Namespace Boundary

**A throw is invisible in a signature.** A caller reading the type learns nothing about it, gets
no compiler pressure to handle it, and discovers it in production. Within a single module a
throw caught two lines later is a control-flow choice; across a published boundary it is a
missing part of the contract.

The exceptions are enumerated and small: programming errors (§5a), and startup invariants
(§5e). Both are conditions no caller could have handled anyway.

---

## 3. Rendering a Failure to a Client

### 3a. Fragment Versus Full Page

**What the client receives is decided by what it will do with the response, not by the severity
of the error.**

- A response that will be **swapped into an existing page** returns a *fragment* — partial HTML
  with no document wrapper — so the surrounding page survives.
- A response that **is** the navigation returns a *full page*, with the document wrapper and the
  application's full header policy.

**Set the status on the response builder, not on the renderer.** A renderer returns markup; a
status is a property of the HTTP response, and splitting them means one renderer serves every
status instead of one renderer per status.

### 3b. What a Client Never Receives

**A stack trace, ever.** Not in production, not behind a header, not "just this once" — a stack
names internal paths, module structure, and often argument values.

**A guard reason code, ever** (§1c). **An internal identifier**, unless it is opaque and
deliberately safe to expose, such as a request id a user can quote in a support ticket.

An error message derived from an exception is permitted **only under an explicit debug
predicate**, and it is HTML-escaped on the way out like any other untrusted string — the message
may embed input the client itself supplied.

---

## 4. Fail-Closed Posture

### 4a. Where the Posture Is Owned

[`BOUNDARIES.md`](./BOUNDARIES.md) §5 owns the fail-closed rule, the `required: false`
asymmetry, and the conditions under which a fail-open exception may be ratified. This section
restates none of it, and owns only what is specific to the *error path* itself.

### 4b. No Error Path Ships an Unprotected Response

**An error response carries the same hardening a success response would**, and where it cannot,
it carries a self-contained baseline instead.

The distinction is depth. An error thrown *inside* the middleware chain unwinds through the
chain, so the response still reaches whatever queues security headers. An error thrown *outside*
it — in router internals, or during config resolution before routing — never reaches the
application's middleware at all, and so the handler emits its own **baseline-hardened**
response: no sniffing, a maximally restrictive content policy, no referrer.

**A pending queued header always beats one the handler baked into its own `Response`** —
otherwise a handler could silently downgrade the application's policy. The repository's own
`implementation/ERROR_HANDLING.md` §5b states the precedence rule among queued headers and the
exact baseline header set.

The consequence worth holding on to: **an error page is the response most likely to be rendered
with attacker-influenced content**, so it is the last place a header policy should be missing.

---

## 5. Error Taxonomy

### 5a. Expected Errors — Return `Result`

Predictable outcomes of valid interactions: validation errors, not-found resources, business
rule violations. They are not exceptional.

**Return `Result<T, E>` from service and utility functions**, and a rendered failure from
handlers. **Never `throw`** — it hides the error path from the type system and forces callers
into `try/catch`.

The one throw that belongs in this tier is a **programming error**: an argument shape the API
contract forbids, an invariant a caller violated. That is a bug being surfaced, not a runtime
condition being handled, and no caller could have done anything with a `Result` for it.

**Never throw from middleware whose whole purpose is to degrade gracefully** — a non-security
feature that cannot reach its binding returns rather than throwing
([`BOUNDARIES.md`](./BOUNDARIES.md) §5b).

### 5b. Unexpected Errors and the Error Boundary

Mistakes that cannot be recovered at the call site. **The application needs no per-route
`try/catch`** — the router installs an error boundary as middleware, and it is installed at more
than one depth, because a throw from a route handler and a throw from an application-level guard
unwind through different amounts of the chain and therefore carry different headers. The
repository's own `implementation/ERROR_HANDLING.md` §5b names the depths and the guarantee each
one gives.

The portable consequence: **middleware that queues headers before calling next still protects an
error page; middleware that queues on the way out does not**, because the guards downstream of a
throw never ran.

The boundary **logs** every error it catches, with a structured context and no PII
([`BOUNDARIES.md`](./BOUNDARIES.md) §4). What it *sends* is governed by §3b.

### 5c. Infrastructure Errors — Log and Fail Closed

External service failures sit between expected and unexpected: the call is expected to fail
sometimes, but the specific error is not actionable by the user.

**Catch, log with context, return `503`.**

Log enough to diagnose — service, operation, sanitised identifiers — and never user-supplied
content that may carry PII.

### 5d. Per-Route Recovery Hooks

A declarative handler builder accepts a recovery hook, and **the default behaviour differs by
handler kind on purpose**:

- A **full-page** handler with no hook lets the error **re-throw**, so the boundary (§5b) renders
  the whole document. A half-rendered navigation is worse than an error page.
- A **fragment** handler with no hook returns a **self-contained error fragment**, because it is
  swapping into a page that is already correct.

**Both log on the way out.** The difference is only in what the client receives, never in
whether the failure is recorded. **Use these hooks for per-route recovery instead of ad-hoc
`try/catch`**, which is invisible to a reader auditing the route map.

### 5e. Startup Invariants — Resolvers Throw

A missing or malformed binding is a **deployment defect**, not a runtime condition to degrade
around. These surfaces `throw` a plain `Error` rather than returning `Result`: environment
validation, config access, and request-time binding resolvers.

**The dividing line: resolving a binding throws; operating on a resolved store returns
`Result`.** Resolution failure is unrecoverable and identical for every request; an operation
failure is per-request and often handleable.

**Env and config failures throw one normalized shape**, produced by a shared formatter rather
than hand-rolled per call site — otherwise the one error a developer sees most often during
deployment is the one with the least consistent text.

**An HTTP-boundary method may return a `Response` instead**, where its entire job is to produce
one and the caller hands its return value straight back. That is a ratified exception, recorded
in the owning `implementation/` doc, not a licence to widen the rule.
