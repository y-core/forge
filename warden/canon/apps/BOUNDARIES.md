---
title: Application Boundaries
description: "SSR versus browser, middleware ordering and guard placement, validate-at-boundary, no-PII logging, and the fail-closed posture."
---

# Application Boundaries

> Owns the five boundaries every request path is judged against. Each is a rule about _where_ a
> concern is allowed to live, not how to implement it — the owning document supplies the
> mechanism, this one supplies the line.
>
> Defers to: [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §2 for the layer stack these
> boundaries sit inside; [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 for the `Result`
> primitive §5 relies on; [`TESTING.md`](./TESTING.md) §5 for the tests each boundary requires.

---

## 0. Quick Reference

- §1 SSR Versus Browser — the Hard Runtime Boundary: kept by import path, not a runtime check
- §1a What May Be Imported Where: the tiers
- §1b Splitting a Component Across the Boundary: markup here, behaviour there
- §1c Why It Is a Path Convention and Not a Guard: the failure mode each catches
- §2 Middleware Ordering and Guard Placement: the chain is the security boundary
- §2a The Global Chain Order: identity, headers, logging, policy
- §2b Guards Live in the Route's Middleware List: never inline in a handler
- §2c Guard Order Within a Route: cheapest and most transport-shaped first
- §2d Rejection Status Discipline: what each refusal returns
- §3 Validate at the Boundary: untrusted input stops at the handler
- §3a The Boundary Rule: services receive typed domain objects
- §3b Ordered Validation Steps: reject cheaply before parsing expensively
- §3c Trust Boundaries on Inbound Headers: a header is input until proven otherwise
- §4 No PII in Logs: what a log record may never carry
- §4a The Prohibited Field Classes: the enumerated ban
- §4b Structured Fields Over String Interpolation: static messages, filterable data
- §5 Fail Closed: a missing security dependency is an error, never a downgrade
- §5a Fail Closed on Missing Critical Context: absent binding means refuse
- §5b required false — Non-Security Features Only: the deliberate asymmetry
- §5c No Silent Error Swallowing: a caught exception is not a passed check
- §5d Recording a Fail-Open Exception: how the rare carve-out is ratified

---

## 1. SSR Versus Browser — the Hard Runtime Boundary

**Browser-only code runs only in the browser, after the page is delivered.** It references
`document`, `window`, and `localStorage`, none of which exists in a Worker. **Importing it from
Worker-executed code throws at runtime** — there is no DOM to degrade to.

### 1a. What May Be Imported Where

The boundary is kept by **import path**, and the tier is legible from the path without opening
the module:

| Import | Where it may appear |
| --- | --- |
| SSR components, layouts, server-render helpers | Worker-safe — views, controllers, routers |
| The application's own browser entry and anything it bundles | **Browser only** |
| A library's `…/client` subpath, or a side-effect controller registration | **Browser only** |

The application's browser entry is a single module the asset pipeline bundles. **Everything
browser-only is reachable from it and from nowhere else.**

### 1b. Splitting a Component Across the Boundary

**When a component needs both SSR markup and client behaviour, render the markup with the SSR
components and wire the behaviour from the browser entry.** The two halves agree through a
declared DOM contract — attribute names, scope names, selectors — rather than hand-matched
strings.

**Never inline a browser-only import in a view or a controller.** That is precisely the mistake
the path convention exists to make visible: it typechecks, it passes a test that never renders
in a Worker, and it fails on the first real request.

### 1c. Why It Is a Path Convention and Not a Guard

A runtime guard reports the violation at the moment it is least recoverable — inside a live
request, after the route matched. The path convention reports it at review time, to a reader who
can see both the import and the file it sits in.

The convention also survives bundling: an import that should never have crossed the tier is
visible in the module graph whether or not the code path executes.

---

## 2. Middleware Ordering and Guard Placement

### 2a. The Global Chain Order

**The middleware chain is a security boundary, and its order is part of the boundary.** The
global chain is registered once, in the composition root
([`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §1b), in this order:

1. **Request identity** — a request id, so every later record and error can be correlated.
2. **Security headers** — queued _before_ the downstream chain runs, so a later throw still
   yields a hardened error page ([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §4b).
3. **Logging** — after identity, so the id is available; around everything, so failures are
   recorded.
4. **Cross-origin policy** — scoped to the path prefix it applies to, never applied globally by
   accident.

**Middleware that queues on the way out is not a substitute for one that queues on the way in.**
The difference is invisible on a successful request and decisive on a failing one.

### 2b. Guards Live in the Route's Middleware List

**A route's guards are declared in its middleware list, never inline inside the handler.**

An inline guard is invisible to anyone auditing the route map, which is the one artifact a
reviewer reads to answer "which routes are protected". A guard that is not in that list does not
exist for review purposes, however correct its code is.

The corollary: **a state-changing route with an empty middleware list is a finding on its face**,
without reading the handler at all.

### 2c. Guard Order Within a Route

Order guards **cheapest and most transport-shaped first**, so a hostile request is refused before
anything expensive runs:

1. **Request-shape guards** — method, content type, expected client hints.
2. **Origin and cross-origin verification.**
3. **Rate limiting.**
4. **CSRF verification** — it reads the body, so it comes after the shape checks that make a body
   worth reading.

A guard that performs a network call or a cryptographic verification never runs before one that
inspects a header.

### 2d. Rejection Status Discipline

**A policy violation is `403`, not `400`.** The distinction is load-bearing for edge logging and
for rate-limit rules: `400` says the client sent something malformed, `403` says the client sent
something it was not allowed to send, and conflating them makes an attack indistinguishable from
a bug.

**A malformed or bot-shaped body is `400`.** **An oversized body is `413`.** **A wrong content
type is `415`.** **A failed schema validation is `422`.** Consistency here is what makes a
fail-case test assertable ([`TESTING.md`](./TESTING.md) §5).

---

## 3. Validate at the Boundary

### 3a. The Boundary Rule

**All untrusted input is validated at the boundary — the handler — before it reaches services,
domain logic, or storage.** Raw form data, query strings, headers, and unvalidated strings are
never passed into a service function. **Services receive typed domain objects.**

The corollary is what makes the rule enforceable: **a service signature that accepts raw form
data is a defect on its face**, because it makes the boundary unlocatable. Type the parameter to
the domain shape and validation has nowhere to hide.

### 3b. Ordered Validation Steps

The canonical sequence for a mutating handler. **The order is the rule** — each step is cheaper
than the next, and each rejects a class of request the next would otherwise have to parse:

1. **Read the body with a size limit.** An unbounded read is a denial-of-service surface.
2. **Honeypot check.** The cheapest class of bot, rejected before any crypto runs.
3. **CSRF verification** — already applied as route middleware (§2b), so it rejected before the
   handler was entered.
4. **Challenge or CAPTCHA verification**, where configured.
5. **Schema parse** of the whole body, producing typed output or an issue list.
6. **Pass the typed output to the service.**

**A declarative handler builder should supply steps 1, 2, 4, 5 and 6 from configuration**, so a
route names its schema and its guard fields and nothing else. Step 3 stays middleware, because a
transport guard belongs where a reader auditing the route map can see it.

### 3c. Trust Boundaries on Inbound Headers

**A request header is untrusted input until something makes it otherwise.** Platform-injected
headers — client IP, country, TLS metadata — are trustworthy only when the request provably
arrived through the platform edge that sets them; a direct-to-origin request can carry any value
a client chose.

**Where a guard reads such a header, the trust decision is an explicit option that defaults to
not trusting.** A default of trust is a silent spoofing surface in every deployment that has not
thought about it, which is most of them.

---

## 4. No PII in Logs

### 4a. The Prohibited Field Classes

**A log record must never contain user-identifiable or credential data**, on any channel —
console output is retained and searchable exactly as persisted storage is.

Never present in a log record:

- Email addresses, display names, or any user identifier beyond an opaque request id
- Passwords, API keys, tokens, or secrets
- Request body content — it may carry passwords, national identifiers, or free-text PII
- Headers that carry credentials: `Authorization`, `Cookie`, `Set-Cookie`

Where a handler must reference a user for debugging, use an **opaque internal id** that cannot be
reverse-mapped without database access.

**Stack traces stay out of persisted logs.** A stack embeds argument values and file paths, and a
persisted record is a far longer-lived artifact than a console line. Where the platform offers a
redaction wrapper, apply it before any persisting channel.

### 4b. Structured Fields Over String Interpolation

Pass data as discrete key-value fields on the record, never interpolated into the message string.

    // BAD: interpolating values into a message string
    logger.error(`Failed to process request for ${userId}: ${error.message}`)

    // GOOD: structured key-value fields on the record
    logger.error("contact: process failed", { requestId, error: error.message })

The message is a static, grep-friendly label; variable data belongs in the fields object where it
can be filtered independently. This is also a PII control: interpolation is how a sensitive value
ends up inside a single opaque string that no redaction pass can reach into.

---

## 5. Fail Closed

### 5a. Fail Closed on Missing Critical Context

**When a security-critical dependency is absent, return an error response immediately.** Silent
continuation with degraded behaviour is never acceptable.

```ts
// BAD — silently skips CSRF when the key is absent
if (csrfKey) await verifyCsrf(c);

// GOOD — fail closed
const csrfKey = configStore.get(c.env).security.csrf.secret;
if (!csrfKey) return new Response("Service Unavailable", { status: 503 });
await verifyCsrf(c, csrfKey);
```

**Every guard rejects on any check it cannot confirm.** There is no fallback, no retry, and no
skip path: partial guard execution that continues is a security regression whatever the
intention.

The same posture governs startup — a missing or malformed binding is a **deployment defect**, so
config access and binding resolution throw rather than defaulting
([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e).

### 5b. `required: false` — Non-Security Features Only

Some middleware accepts a `required: false` option for graceful degradation. **It is scoped to
non-security hardening only** — rate limiting, where a missing binding should not hard-fail a
local run or a test.

**Never acceptable with `required: false`:** CSRF verification, authentication middleware, origin
and Referer checks, signature validation.

The asymmetry is deliberate: bypassed rate limiting is an availability concern, bypassed CSRF is
an integrity breach. A single option name spanning both would make the difference invisible at
the call site, which is exactly where it needs to be visible.

### 5c. No Silent Error Swallowing

**Never catch an exception from a verification step and continue.**

```ts
// WRONG — swallows the error and silently succeeds
try {
  await verifyChallenge(token);
} catch {
  // continue anyway
}
```

If verification throws unexpectedly, let it reach the error boundary and become a `500`. **A
failed challenge surfaced as a 500 is strictly better than one silently bypassed**: the first is
an outage that gets fixed, the second is a control that quietly stopped existing.

The permitted shape is to catch, **log**, and **return a refusal** — never to catch and proceed.

### 5d. Recording a Fail-Open Exception

A fail-open behaviour is occasionally correct, and is ratifiable. **Three conditions, all
required:** the surface is provably outside the security boundary; the open failure degrades
presentation and never authorisation; and the exception is written into the application's
`docs/` docs and listed in [`CODE_REVIEW.md`](./CODE_REVIEW.md) §6, so a reviewer meets
it as a known pattern rather than as a finding.

**An exception that is not written down does not exist.** The next reviewer is right to flag it,
and the argument gets had again from scratch.
