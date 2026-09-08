---
title: Workers Platform
description: "The V8 isolate model and what module scope may hold, post-response work, rate limiting, deploy safety and secret handling, and static asset serving."
---

# Workers Platform

> Owns the runtime facts an application must design around: the isolate model, work that
> outlives a response, rate limiting, deployment safety, and asset serving. These are platform
> properties, not preferences — the rules here are consequences.
>
> Defers to: [`CODE_RULES.md`](./CODE_RULES.md) §1 for the zero-global-state
> rule §1 here justifies; [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §3 for typed config
> access; [`BOUNDARIES.md`](./BOUNDARIES.md) §5 for the fail-closed posture §3 depends on.

---

## 0. Quick Reference

- §1 The Isolate Model: one isolate, no shared heap, no background threads
- §1a One Request at a Time, Recycled Isolates: what actually bleeds
- §1b Safe and Unsafe Module Scope: the two patterns
- §1c No Background Threads: the two places async work can live
- §1d Cold Start Versus Warm Reuse: keep module init cheap and pure
- §2 Post-Response Work: extending the isolate past the response
- §2a The waitUntil Pattern: what it is for
- §2b Errors Do Not Propagate: catching for visibility
- §2c Cover Every Started Promise: the untracked-branch failure
- §2d Limits: CPU time, and when to reach for a queue
- §3 Rate Limiting: the binding, degradation, and key selection
- §3a The Rate Limit Binding: configuration and the response it produces
- §3b Graceful Degradation Is Scoped to This: why the option is safe here alone
- §3c Key Selection: client IP by default, identity after auth
- §4 Deploy Safety: secrets, parity, and the pre-deploy gate
- §4a Secrets Are Provisioned, Never Committed: the CLI path
- §4b Local Development Variables: the gitignored file
- §4c The Pre-Deploy Gate: what must pass, and what must not be skipped
- §4d Environment Parity: schema validation surfaces misconfiguration early
- §4e Development Transport Posture: https at every hop, so origins survive the round trip
- §5 Static Assets: serving files without spending Worker CPU
- §5a The Public Directory and Build Outputs: what lands where
- §5b Serve Assets Before the Worker: the routing decision
- §5c Cache Busting: fingerprinting and the reference it forces
- §5d Never Serve Files From a Handler: the anti-pattern

---

## 1. The Isolate Model

### 1a. One Request at a Time, Recycled Isolates

Each request is handled in a V8 isolate. There is no shared heap between concurrent requests,
and there are no worker pools — everything inside a request handler runs sequentially or through
`await` chains.

**The consequence that matters is recycling, not concurrency.** An isolate handles one request
at a time, so two requests never interleave in memory — but a _second_ request may reuse the
same isolate and observe whatever the first left behind at module scope. That is the leak: not a
race, a residue.

### 1b. Safe and Unsafe Module Scope

```ts
// SAFE: computed once at cold start, never mutated
export const securityHeaders = makeSecurityHeaders({/* … */});
export const configStore = createConfig(appConfig, AppConfigSchema);
export const routes = route({ health: { method: "GET", pattern: "/api/health" } });

// UNSAFE: per-request mutable state at module scope
let currentUser: User | null = null;
```

**Module-level constants are safe; module-level mutable state is not.** Per-request data belongs
on the request context, read through typed accessors
([`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §3b).

The subtle version is a **cache**. A memo keyed on something request-scoped is per-request
mutable state wearing a performance argument; a memo keyed on something deployment-scoped — a
parsed config, a compiled schema — is a constant computed lazily and is fine.

### 1c. No Background Threads

There is no timer-driven background processing, no worker threads, and no process-level
concurrency. All async work is one of exactly two things:

1. **Awaited within the handler** — it completes before the response is returned.
2. **Handed to the execution context** — it completes after the response (§2).

There is no third option, and code written as though there were one silently loses work.

### 1d. Cold Start Versus Warm Reuse

Isolates are reused across requests when traffic is steady. **Module scope runs only on cold
start**, so module initialisation must be cheap and side-effect-free: no network connections, no
environment reads, no work whose result depends on which request happened to be first.

An expensive module-level computation is not amortised in the way it would be in a long-lived
process — it is paid on every cold start, which under bursty traffic is often.

---

## 2. Post-Response Work

### 2a. The `waitUntil` Pattern

`c.executionCtx.waitUntil(promise)` keeps the isolate alive until the promise settles, _after_
the response has been sent. Use it for work that must not block the response but must complete
before the isolate is recycled.

```ts
c.executionCtx.waitUntil(logChannel.flush());
```

Log flushing is the canonical case: the records accumulate during the request and are written
afterwards, so storage latency never lands on the user's response time.

### 2b. Errors Do Not Propagate

**An error thrown inside a `waitUntil` promise does not reach the HTTP response** — the response
has already been sent. An unhandled rejection there is silent.

```ts
c.executionCtx.waitUntil(logChannel.flush().catch((err) => console.error("flush failed", err)));
```

Attach a catch wherever the failure is worth knowing about, which is nearly always.

### 2c. Cover Every Started Promise

**The promise handed to `waitUntil` must cover every piece of work the function started**, not
only the headline one. A detached branch inside the function — a fire-and-forget cleanup, a
probabilistic purge — is untracked, so the isolate may suspend before it settles.

The failure is load-dependent and therefore ships: under light traffic the isolate lives long
enough for the detached work to finish anyway, and the bug appears only when it matters.

### 2d. Limits

`waitUntil` work counts against the isolate's CPU budget. Keep post-response work small. Work
that is genuinely large — a bulk import, a fan-out — belongs in a queue or a durable object,
not in the tail of a request.

---

## 3. Rate Limiting

### 3a. The Rate Limit Binding

Rate limiting is configured as a platform binding with an explicit limit and period, and the
guard that consumes it returns `429` when the window is exceeded. **The limit and period live in
the deployment config, not in code** — they are an operational dial, and changing one should not
be a code review.

### 3b. Graceful Degradation Is Scoped to This

A rate-limit guard is registered with graceful degradation enabled: when the binding is absent —
in tests, or in a local run without it — the guard is skipped rather than throwing.

**This is the one place that option is correct, and it is not a precedent.** Bypassed rate
limiting is an availability concern; bypassed CSRF, origin checking, or authentication is an
integrity breach. [`BOUNDARIES.md`](./BOUNDARIES.md) §5b owns the asymmetry, and
[`CODE_REVIEW.md`](./CODE_REVIEW.md) §6 records that this specific usage is not a finding.

### 3c. Key Selection

**The default key is the client IP**, read from the platform's own connecting-IP header. That
header is trustworthy only because the request provably arrived through the platform edge — the
trust boundary [`BOUNDARIES.md`](./BOUNDARIES.md) §3c states.

**After authentication, key on identity instead.** IP-keyed limits are simultaneously too loose
for shared egress and too tight for a large NAT; once a request has an authenticated subject,
that subject is the honest key.

---

## 4. Deploy Safety

### 4a. Secrets Are Provisioned, Never Committed

**Never hardcode an API key, token, or credential in a source file.** Provision secrets through
the platform CLI, which encrypts them at rest and injects them into the environment at runtime,
where they appear alongside ordinary bindings.

A secret in git is compromised the moment it is pushed and stays compromised after it is
deleted, because history retains it. Rotation is the only remedy, and it is not a code change.

### 4b. Local Development Variables

Local development reads secrets from a **gitignored variables file**, with obviously non-production
values. Two rules: **verify it is gitignored before adding the first value**, and **commit an
example file** listing the required keys with placeholder values, so a new checkout fails with a
missing-key error rather than a mysterious one.

### 4c. The Pre-Deploy Gate

**The full verification gate must pass before every deployment**, and a failure blocks the
deploy ([`TESTING.md`](./TESTING.md) §6). Asset builds run before deploy, not as part of it.

**Never use a force flag to skip build or asset validation.** The validation exists because a
deploy that half-succeeds leaves markup pointing at assets that were never uploaded, and the
symptom is an unstyled production site.

### 4d. Environment Parity

**The config schema validates the environment at request time**, so a missing or malformed
variable throws a structured error naming the field rather than defaulting silently
([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e).

This is what makes staging worth having: a misconfiguration surfaces as an immediate, legible
failure in the first environment it reaches, instead of as a subtly wrong behaviour in the last
one.

### 4e. Development Transport Posture

**Development is https at every hop.** Origin guards compare origins by exact string, so any scheme
mismatch between what the browser sends and what the app believes its own origin to be rejects every
write. The dev server stamps its configured local protocol onto the request URL and onto every
origin-bearing header, so an app serving http behind a TLS-terminating proxy sees the browser's
`https://` origin arrive as `http://` and 403s its own forms.

The ruling:

- **The dev server's local protocol is set to https.** This is what makes the scheme survive the
  round trip; it is not optional tuning.
- **The configured site origin is whatever URL the browser is actually pointed at**, https and all.
  It is one variable with one meaning and three values, each supplied by the surface that owns the
  environment: the deployed origin in production; the TLS-terminating proxy's origin in the local
  variables file, for ordinary development in a container (§4b); and the loopback https port on the
  dev server's own command line, for a browser suite that reaches the app without the proxy. It is
  the single source of truth the allowed-origin set is derived from, and it is validated at boot like
  every other environment value (§4d).
- **Never a scheme-rewriting middleware.** The rejected alternative reconstructs the request URL or
  the `Origin` header with the scheme corrected before the guard runs. A guard whose input is
  rewritten by the app verifies nothing — it launders an attacker-supplied origin into a trusted one,
  and it is a dev-only code path sitting in the production request chain. Fix the transport, not the
  evidence.
- **A browser suite targets loopback https**, rather than dropping to http and diverging from the
  posture under test.
- **`upgrade-insecure-requests`, HSTS, and `Secure` cookies stay hardcoded.** They are not made
  conditional on the environment, because under this posture they are correct in development by
  construction.

Where a case needs an origin the site origin cannot express, the extra entries are supplied from a
development entry point the production bundle never imports — each a normalized https-or-loopback
origin that throws at boot otherwise, so the production bundle structurally contains none of them.
Carried as an ordinary environment variable instead, an extra-origins list is a production allowlist
waiting to be widened by a typo.

---

## 5. Static Assets

### 5a. The Public Directory and Build Outputs

Stylesheets, client bundles, images, and fonts are emitted into a public directory that the
platform uploads and serves from its edge. **The directory is build output, not source** — it is
generated by the asset pipeline from the application's stylesheet entry and client entry.

### 5b. Serve Assets Before the Worker

**Configure static assets to be served without invoking the Worker.** Routing an asset request
through a handler spends CPU on a file that needs no dynamic logic and bypasses edge caching.

### 5c. Cache Busting

Where the pipeline does not fingerprint filenames, cache correctness depends on the platform's
own asset versioning. **If fingerprinting is added, the markup that references the assets must be
updated in the same change** — a fingerprinted file with an unfingerprinted reference is a 404
that only appears after the first deploy.

### 5d. Never Serve Files From a Handler

**Do not add a route that reads and returns a file from the public directory.** It wastes CPU,
bypasses the edge cache, and — worse — introduces a path-handling surface where directory
traversal becomes possible. The asset pipeline has no such surface because it never takes a path
from a request.
