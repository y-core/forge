---
title: Library Boundaries
description: "The recurring boundary rulings: SSR versus browser, transport versus application security, validate-at-boundary, no-PII logging, and fail-closed."
---

# Library Boundaries

> Owns the five boundaries that every namespace is judged against. Each is a rule about *where*
> a concern is allowed to live, not about how to implement it — the owning document supplies
> the mechanism, this one supplies the line.
>
> Defers to: [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §3 for the leaf/integration split
> these boundaries are enforced within; [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 for the
> `Result` primitive §5 relies on; [`TESTING.md`](./TESTING.md) §5 for the tests each boundary
> requires.

---

## 0. Quick Reference

- §1 SSR Versus Browser — the Hard Runtime Boundary: kept by import path, not a runtime check
- §1a What May Be Imported Where: the subpath tiers
- §1b Splitting a Component Across the Boundary: markup here, behaviour there
- §1c Why It Is a Path Convention and Not a Guard: the failure mode each catches
- §2 Transport Versus Application Security Layer: what a security namespace may know
- §2a What Belongs at the Transport Layer: the closed list
- §2b What Does Not: identity, sessions, permissions
- §2c Why Identity Is Application-Layer: composability and the test cost
- §3 Validate at the Boundary: untrusted input stops at the handler
- §3a The Boundary Rule: services receive typed domain objects
- §3b Ordered Validation Steps: reject cheaply before parsing expensively
- §3c Trust Boundaries on Inbound Headers: a header is input until proven otherwise
- §4 No PII in Logs: what a log record may never carry
- §4a The Prohibited Field Classes: the enumerated ban
- §4b Structured Fields Over String Interpolation: static messages, filterable data
- §5 Fail Closed: a missing security dependency is an error, never a downgrade
- §5a Fail Closed on Missing Critical Context: absent binding means refuse
- §5b `required: false` — Non-Security Features Only: the deliberate asymmetry
- §5c Recording a Fail-Open Exception: how the rare carve-out is ratified

---

## 1. SSR Versus Browser — the Hard Runtime Boundary

**Browser-only exports run only in the browser, after the page is delivered.** They reference
`document`, `window`, and `localStorage`, none of which exists in a Worker. **Importing one from
Worker-executed code throws at runtime** — there is no DOM to degrade to.

### 1a. What May Be Imported Where

The boundary is kept by **import path**. Every published subpath sits in exactly one tier, and
the tier is legible from the path without opening the module:

| Subpath shape | Where it may be imported |
|---|---|
| A component, chrome, or server-render namespace | Worker-safe — SSR views, handlers, routers |
| A `…/client` namespace | **Browser only** — the bundled client entry and code it bundles |
| A `…/*/client` side-effect registration entry | **Browser only** — controller and scope registration |
| A vendored browser bundle | **Browser only** — a side-effect import, no exported surface |

The repository's own catalog names which namespace is which; this section owns only the rule
that the tier is a property of the path.

### 1b. Splitting a Component Across the Boundary

**When a component needs both SSR markup and client behaviour, render the markup from the
SSR namespace and wire the behaviour from the bundled client entry.** The two halves share a
declared DOM contract — attribute names, scope names, selectors — published as pure data that
both tiers import, so neither hand-writes a string the other has to match.

**Never inline a browser-only import in a `.tsx` file outside the client directory.** That is
precisely the mistake the path convention exists to make visible: it typechecks, it passes a
unit test that never renders in a Worker, and it fails in production on the first request.

### 1c. Why It Is a Path Convention and Not a Guard

A runtime guard would report the violation at the moment it is least recoverable — inside a
live request, after the route matched. The path convention reports it at review time, to a
reader who can see both the import and the file it sits in.

The convention also survives bundling. A guard has to run to fire; an import that should never
have crossed the tier is visible in the module graph whether or not the code path executes.

---

## 2. Transport Versus Application Security Layer

**A security namespace is strictly transport-layer.** It operates on the raw HTTP
request and response, before any application logic runs, and it **does not know about users,
sessions, or application state**.

### 2a. What Belongs at the Transport Layer

A closed list. Everything here reads or writes the HTTP envelope and nothing else:

HTTP security headers and CSP nonce injection · CORS policy · origin and cross-origin
verification · request rate limiting · request identity · content-type enforcement on incoming
requests.

### 2b. What Does Not

| Concern | Correct home |
|---|---|
| CSRF token minting and verification | a form-parsing namespace — it reads the body |
| Session management and cookie storage | a session namespace |
| Authentication — JWT, OAuth, magic links, login | a dedicated identity namespace |
| Permissions and RBAC | the same identity namespace |
| Timing-safe comparison and other primitives | a sealed-internal crypto module |
| Input sanitization and schema validation | the form-parsing and validation namespaces |

The repository's own catalog names the namespace behind each row; this table owns only which
side of the line a concern falls on.

**Any feature that requires reading session data or user identity belongs in a higher-level
namespace.** Adding one to the security namespace is a layering violation even when the code
is short and the import resolves.

### 2c. Why Identity Is Application-Layer

Two consequences follow from the split, and both are the reason it is held:

- **Composability.** A transport guard is a pure function of the request. It can be unit-tested
  against a hand-built `Request` with no storage binding, no session, and no user fixture. The
  moment it reads identity, every test of it needs an authenticated world.
- **Auditability.** A reviewer auditing "what can reject this request before the handler runs"
  reads one namespace. Identity checks scattered into transport code make that list unknowable.

CSRF is the boundary case worth naming: it is a *transport* guard by placement in the
middleware chain — it rejects before the body's contents matter — but it lives with the form
namespace because it reads a body field. Placement in the chain and ownership of the code are
different questions.

---

## 3. Validate at the Boundary

### 3a. The Boundary Rule

**All untrusted input is validated at the boundary — the handler — before it reaches services,
domain logic, or storage.** Raw `FormData`, query strings, headers, and unvalidated strings
must not be passed into a service function. **Services receive typed domain objects.**

The corollary is what makes the rule enforceable: a service signature that accepts `FormData`
or `Record<string, string>` is a defect on its face, because it makes the boundary
unlocatable. Type the parameter to the domain shape and the validation has nowhere to hide.

### 3b. Ordered Validation Steps

The canonical sequence for a mutating handler. **The order is the rule** — each step is cheaper
than the one after it, and each rejects a class of request the next would otherwise have to
parse:

1. **Read the body with a size limit.** An unbounded read is a denial-of-service surface.
2. **Honeypot check.** Rejects the cheapest class of bot before any crypto runs.
3. **CSRF verification** — applied as route-level middleware, so it rejects before the handler
   is entered at all.
4. **CAPTCHA or challenge verification**, where configured.
5. **Schema parse** of the whole body, producing typed output or an issue list.
6. **Pass the typed output to the service.**

Steps 1–4 reject invalid requests before schema validation runs; steps 5–6 produce the typed
domain object services consume.

**A declarative handler builder should supply steps 1, 2, 4, 5 and 6 from configuration**, so a
route names its schema and its guard fields and nothing else. Step 3 stays middleware, because
a transport guard belongs in the chain where a reader auditing the route map can see it.

### 3c. Trust Boundaries on Inbound Headers

**A request header is untrusted input until something makes it otherwise.** Platform-injected
headers — client IP, country, TLS metadata — are trustworthy only when the request provably
arrived through the platform edge that sets them; a direct-to-origin request can carry any
value a client chose.

**A namespace that reads such a header exposes the trust decision as an explicit option**, and
the option defaults to *not trusting*. A default of trust is a silent spoofing surface in every
deployment that has not thought about it, which is most of them.

---

## 4. No PII in Logs

### 4a. The Prohibited Field Classes

**A log record must never contain user-identifiable or credential data**, on any channel —
console output is retained and searchable exactly as a persisted channel is.

Never present in a log record:

- Email addresses, display names, or any user identifier beyond an opaque request id
- Passwords, API keys, tokens, or secrets
- Request body content — it may carry passwords, national identifiers, or free-text PII
- Headers that carry credentials: `Authorization`, `Cookie`, `Set-Cookie`

Where a handler must reference a user for debugging, use an **opaque internal id** that cannot
be reverse-mapped without database access.

A persisting channel additionally strips stack traces by default — a stack embeds argument
values and file paths, and a persisted log is a longer-lived artifact than a console line.
Provide a redaction wrapper so an application can strip its own sensitive fields before any
persisting channel sees them.

### 4b. Structured Fields Over String Interpolation

Pass data as discrete key-value fields on the record, never interpolated into the message
string. The message is a static, grep-friendly label; variable data belongs in the fields object where
it can be filtered independently. The rule is also a PII control: interpolation is how a
sensitive value ends up adjacent to a benign one inside a single opaque string that no
redaction pass can reach into.

---

## 5. Fail Closed

### 5a. Fail Closed on Missing Critical Context

**When a security-critical dependency is absent, return an error response immediately.** Silent
continuation with degraded behaviour is never acceptable.

```typescript
// BAD — the guard is skipped entirely when the signing key is absent
if (signingKey) await verifyRequest(c)

// GOOD — refuse rather than degrade
if (!signingKey) return new Response("Service Unavailable", { status: 503 })
await verifyRequest(c, signingKey)
```

This covers authentication tokens, signing keys, and origin validation secrets: absent binding
→ `503`, never a degraded unauthenticated mode.

The same posture governs startup: a missing or malformed binding is a **deployment defect**, not
a runtime condition to degrade around, so a binding resolver throws rather than returning a
`Result` ([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e).

### 5b. `required: false` — Non-Security Features Only

Some middleware accepts a `required: false` option for graceful degradation. **It is scoped to
non-security hardening only** — rate limiting, where a missing binding should not hard-fail a
deployment.

**Never acceptable with `required: false`:** CSRF verification, authentication middleware,
origin and Referer checks, signature validation.

The asymmetry is deliberate: bypassed rate limiting is an availability concern, bypassed CSRF
is an integrity breach. A single option name spanning both would make the difference invisible
at the call site, which is exactly where it needs to be visible.

### 5c. Recording a Fail-Open Exception

A fail-open behaviour is ratifiable, and occasionally correct — a class-name conflict resolver
that meets an unrecognised utility has no safe way to refuse, and refusing would break every
consumer for a token it merely did not know about.

**Three conditions, all required:** the surface is provably outside the security boundary; the
open failure degrades presentation and never authorisation; and the exception is written into
the owning `implementation/` document and listed in [`CODE_REVIEW.md`](./CODE_REVIEW.md) §6 so
a reviewer meets it as a known pattern rather than as a finding.

**An exception that is not written down does not exist.** The next reviewer is right to flag
it, and the argument gets had again from scratch.
