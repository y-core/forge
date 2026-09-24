---
title: Structured Logging
description: "The logging namespace: channels and their composable wrappers, the request logger, KV persistence, the log viewer, and the no-PII rule."
audience: consumer
---

# Structured Logging

> Owns the logging namespace: the channel contract, the request logger, KV log storage, the log viewer (`logging/viewer`), and the no-PII rule.
> Owns the canonical channel-selection pattern (§2d). The export list and every signature are owned by `src/logging/mod.ts` and
> `src/logging/README.md`.
>
> Defers to: [`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e for middleware ordering; [`SECURITY_HARDENING.md`][sh-5b] §5b for request-id correlation;
> [`STORAGE_BINDINGS.md`][sb-5] §5 for absent-binding policy.

---

## 0. Quick Reference

- §2 Channel Pattern: the `LogChannel` object and its wrappers
- §2a LogChannel Object Interface: `write` required, `read` optional
- §2b consoleChannel for Development: write-only structured JSON
- §2c kvLogChannel for Production Persistence: symmetric read/write over KV
- §2d Channel Selection by Environment: the canonical fallback pattern
- §2e Redaction Is Logger-Wide and On by Default: the default policy, its controls, and `persistStack`
- §2f Channel Write Failures and `flush`'s Error Contract: what absorbs a failed write, and who observes it
- §2g Log Ordering — Newest First by Inverted Key: the key format, the clamps, and what purge deletes
- §2h One Value, One Meaning Across Sinks: `toJSON`, a narrowed `URL` and one redacted clone, on every channel
- §3 requestLogger Middleware: the per-request child logger
- §3a requestLogger Configuration: per-request channels and bindings
- §3c Ordering — requestId Before requestLogger: why the order is load-bearing
- §4 Log Levels by HTTP Status: the alert-noise convention
- §4a Level Mapping Convention: status range to level
- §4b Debug Is Not Emitted by requestLogger: why the level exists but never appears
- §4c Silencing and Level Allowlists: `withLevels`, and why "off" is a value not a shape
- §5 Log Viewer (logging/viewer): the auth-gated mount
- §5a loadLogViewer — Auth-Gated Response for Every Path: the ordered contract
- §5b Why access and icon Are Required Options: the obligations the type enforces
- §6 No-PII Rule and Structured Fields: pointer to the governance rule that owns it

---

## 2. Channel Pattern

### 2a. LogChannel Object Interface

`LogChannel` is an **object** (not a bare function). The logger calls `channel.write(record)`; the viewer calls `channel.read?(query)`. `read` is
optional — channels that have no backing store (like `consoleChannel`) simply omit it and the viewer renders an empty table.

The prefix captured at construction time is used for **both** write and read, so a `kvLogChannel` configured with `prefix: "app-logs"` always reads
`app-logs||…` keys — never the default `logs||…` prefix.

### 2b. consoleChannel for Development

`consoleChannel` emits structured JSON to `console.log`. It has no `read` method. Always use in development.

### 2c. kvLogChannel for Production Persistence

`kvLogChannel` writes structured JSON log records to a Workers KV namespace and exposes a `read` method for the log viewer. It requires a `LOGS_KV`
binding. **Pair it with `consoleChannel` for dual output** — see §2d for the selection pattern.

`record.data` is cloned into a JSON-faithful shape before persistence. `Date`, `Map` and `Set` carry their payload outside enumerable own
properties, so each gets an explicit form instead of being flattened to `{}`: an ISO 8601 string, `{ type: "Map", entries: [[key, value], …] }`, and
`{ type: "Set", values: […] }`. A reference that reappears on its own path becomes `"[circular]"`, so a cyclic structure stores rather than
overflowing the stack. `toJSON` handling and `URL` narrowing are §2h's, and hold on every channel.

**The key format is §2g's**, and the viewer inherits its ordering from it.

### 2d. Channel Selection by Environment

**When `LOGS_KV` is absent (local dev without wrangler bindings), fall back to console-only. Bind channel selection to the request context** so the
list resolves per-request:

    channels: (c) => c.env.LOGS_KV
      ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
      : [consoleChannel()]

This is the canonical form — every other document links here rather than restating it.

### 2e. Redaction Is Logger-Wide and On by Default

**Every logger redacts every record, with no configuration.** `createLogger` applies `DEFAULT_LOG_REDACTION` once inside `dispatch`, between the
bindings merge and the channel fan-out, so **redaction is not a per-channel question**: every channel — built-in, third-party, or one of the loggers
forge constructs internally — receives the same already-redacted record. A console stream cannot be dirtier than the KV store it sits beside, which
is what [`BOUNDARIES.md`][bnd-4a] §4a requires when it bans its field classes on **any** channel.

**The match is a substring over a normalized key, applied recursively.** A key is lowercased with `_` and `-` dropped, and is redacted when it
**contains** a stem — so `email`, `emailAddress`, `user_email`, `USER-EMAIL` and a nested `user.email` are one rule rather than five entries.
Exact-key matching fails silently by leaking; substring matching fails loudly by masking a field a reader expected (`[redacted]` where a number
was), which is the direction §5 fail-closed chooses. The over-capture is deliberate and pinned by test — `tokenCount` and `emailVerifiedAt` are
masked — and `allow` is what pays for it.

**The default set covers the §4a field classes a library-wide stem can carry**, and is owned by `src/logging/redact.ts` — it is not the whole of
§4a, and the classes it leaves are the application's `also`. A bare `name` and a bare `message` are deliberately **absent**, each pinned by a
deletion check: `name` under substring matching would take `hostname` and `filename` with it, and masking every `message` in the system is log
destruction rather than redaction. An opaque user id is absent for the opposite reason: §4a directs an application to log one, so a `userid` stem
would redact the affordance §4a sanctions.

**Masking, never a length-preserving mask.** A redacted value becomes the fixed literal `LOG_REDACTED` (`"[redacted]"`), so a reader can tell "an
email was suppressed here" from "there is no email here". The mask is never derived from its value — no repeated `*`, no preserved character, no
`[redacted:17]` — because a mask sized to its value leaks a password's length and narrows an email by it. `mode: "remove"` deletes the key instead,
for a byte budget or a typed-column sink, and gives up that signal.

**The consumer controls are `also` and `allow`,** both bare key stems rather than dotted paths — `data` is a flat merge of bindings and
call-site data, so one field class arrives at both `email` and `user.email`, and a path is undefined for a key inside a `Map` or under a shifting
array index:

    import { defineLogRedaction } from "@y-core/forge/logging"

    redact: defineLogRedaction({ also: ["invoice"], allow: ["tokenCount"] })

`allow` is consulted first, so it wins over both the built-in set and the application's own `also`. An `allow` entry that matches nothing is a no-op
rather than an error: validating it would forbid allowing back one's own `also`, and a throw at logger construction is a throw on the request path.

**Forge spells its own record fields so an application's `also` cannot collide with them.** A stem matches by substring at every depth, and there is
no scoped form to reach past that — so a field forge writes into a record and a field an application writes are redacted by one rule.
`serializeError` therefore emits `{ type, detail, stack? }` rather than `{ name, message }`: `also: ["name", "message"]` masks the app's own two and
leaves the thrown value's type and text, which is the only place either survives.

**The rule covers the fields forge invents, not the request shape it reports.** `requestLogger` writes `method`, `path`, `status` and `duration`
(`src/logging/request-logger.ts`), and those spellings are the request's own — renaming them to dodge a stem would cost every reader of a log the
words the HTTP request is described in, which is a worse trade than the collision. So the rule binds a field forge names for itself, including
`serializeError`'s three: if an application might plausibly log a field of that name, forge picks another spelling. **`path` is the accepted cost of
the exception.** A URL carries ids and occasionally a token, so `also: ["path"]` is a stem an application may genuinely want — and it masks `path`
on `request.completed` and `request.failed` too. `allow` cannot separate them, so an application needing both writes its own path field under a
name of its own and leaves the stem off.

**A redaction that cannot run costs the payload, never the request.** Both halves of the pass execute caller-supplied code — the bindings merge
invokes a getter, the walk invokes a `toJSON` — and either can throw, as a deep enough structure can exhaust the walk's recursion. All of it is
inside the same guard `dispatch` puts around a channel write (§2f): the failure is reported through `onChannelError`, and the record is written with
its `data` replaced by the single field `LOG_REDACTION_FAILED`. Failing closed is the whole point — passing the half-walked payload through would
publish exactly the values the pass exists to remove, and throwing would let a logging call fail the work it describes.

**The opt-out is one greppable literal**, `redact: "allow-unredacted-logs"` — after the log viewer's `"allow-unauthenticated"` precedent (§5a), and
deliberately not an `"off"` member of `mode`, which §5b forbids: a security relaxation must not share an option name with a choice between two
equally-safe behaviours. It disables the pass for the whole logger.

**`withRedaction(channel, redact)` can only tighten.** It wraps a channel so each record passes through `redact` before `write`; `read`/`readEntry`
pass through unchanged. It runs **after** the logger-wide floor, on a record whose masked values are already gone, so it cannot restore one — the
configuration where console is dirtier than KV is unrepresentable, and that is the point of the ordering. Its use is a sink held to a **stricter**
standard than the floor: a third-party destination, or dropping `body` on the persisting channel while console keeps it.

Independently, `kvLogChannel` applies a built-in **stack-redaction default**: `KvLogChannelOptions.persistStack` is `false`, so any `stack` property
is recursively stripped from a **cloned** `record.data` before persistence — error stacks never enter the 7-day KV retention window. The caller's
record is never mutated, so `consoleChannel` keeps the full stack for local debugging. Set `persistStack: true` only when stacks must survive in KV
(e.g. a short-retention debug namespace).

### 2f. Channel Write Failures and flush's Error Contract

**`Logger.flush()` never rejects.** A channel write that fails is absorbed: the failure does not reach the caller, and one failing channel does not
hide the others' completion. This is the deliberate posture — logging describes work and must never fail the work it describes. It is load-bearing
at the one call site that matters: `requestLogger` flushes inside a `finally` (§3), and a `finally` that throws _replaces_ whatever was propagating,
so a rejecting flush could discard a successful response or mask the handler error being rethrown.

Absorbing the rejection removes the last place a persistence outage was visible, so **`LoggerOptions.onChannelError` is the only observer of a
failed write** — and of a failed redaction (§2e), absorbed the same way and for the same reason. Nothing else reports one: `flush` resolves,
`consoleChannel` writes synchronously and never sees the KV promise, and the handler attached at dispatch means the runtime sees no unhandled
rejection either. A `LOGS_KV` outage with no observer is an app that looks healthy over an empty log store.

**It is on by default.** Absent a hook, a failed write produces one structured `console.error` line in the shape `consoleChannel` writes, so an
outage is visible in `wrangler tail` with zero configuration. Supplying a hook replaces that line — route failures to a counter, a health route, or
an alerting channel. A hook that throws is swallowed: reporting a logging failure must not become a second failure on the request path.

**The hook observes strictly more than `flush` does.** It is attached to the write as a sibling handler rather than a chain, so `flush` still awaits
the original write and its contract is unchanged; and because the observation happens at dispatch, it also covers writes evicted from the pending
buffer by its cap — writes `flush` never sees, and which would otherwise fail with nobody watching. The cap, the eviction policy, and `flush`'s
best-effort contract over evicted writes are owned by `src/logging/logger.ts`; usage is in `src/logging/README.md`.

**Both failure modes are absorbed, not only the asynchronous one.** A channel may fail two ways: by rejecting the promise it returned, or by
throwing before it returns one at all. The second is reachable through the default channel — `consoleChannel` calls `JSON.stringify`, which throws
on a cyclic `data` payload, so an object graph holding a back-reference would otherwise take the request down. The logger's own clone marks a
back-reference `"[circular]"` before any channel sees it (§2e), so that payload reaches the throw only on a hand-built record or a logger carrying
the `"allow-unredacted-logs"` opt-out — both of which the absorption still covers. A synchronous throw has no promise to attach a sibling handler
to, so it is reported directly instead, and nothing enters the pending buffer for `flush` to await. The guard is per channel rather than around the
fan-out, so one channel throwing still leaves the rest to run.

`RequestLoggerOptions` mirrors the option and threads it into the per-request logger (§3a).

### 2g. Log Ordering — Newest First by Inverted Key

**A log listing must open on the newest record**, and KV lists keys in lexicographic order with no reverse option — so the order is a property of
the key, not of the reader. `kvLogChannel` writes

    `${prefix}||${inverted}||${rand}`,  inverted = String(999_999_999_999_999 - ms).padStart(15, "0")

**Width 15 covers every instant past the year 33000**, so the segment never changes length and lexicographic order over it equals numeric order over
the instant, reversed. Decimal rather than base36: a KV key is read in the dashboard and typed into fixtures, and five saved bytes do not pay for
the opacity.

**Both clamps are load-bearing.** An unclamped pre-1970 instant yields a **16**-digit string, and `"1000000000000000" < "999999999999999"` — it
would sort above every real record, at the top of the newest-first listing. A `NaN` timestamp falls back to `Date.now()`, so it lands with its
neighbours rather than at an arbitrary end.

**`purge` slices the other end.** Under an inverted key the head of a listing is the newest record, so `keys.slice(maxLogs)` is what may be deleted
— `keys.slice(0, deleteCount)` would delete precisely what is worth keeping. No key is ever parsed: the ISO timestamp stays in the metadata and the
value.

**Filtering stays per page.** `read` filters the page it listed, so an empty filtered page is not an empty result — the empty state says so
(`"No log entries match these filters on this page. Load more to keep searching."`) rather than claiming no matches. A paging loop is the
alternative and is refused: it would issue an unbounded number of billed `kv.list` subrequests inside one invocation, and would break the cursor
contract, since `complete` would then correspond to no single call.

### 2h. One Value, One Meaning Across Sinks

**A value means the same thing on every channel.** `consoleChannel` and `kvLogChannel` are verified in different places — the console stream in a
local test, the KV record days later in the viewer — so a shape that differs between them is a shape nobody checks. What makes them agree is the
`toJSON` rule, the `URL` rule, and §2e's redaction:

**Every channel receives one JSON-stable clone, built before the fan-out.** Redaction clones `data` inside `dispatch`, so what reaches `write` is
never the caller's live object: a `Date` is its ISO instant, a `Map` and a `Set` carry their tagged form, a repeated reference on its own path is
`"[circular]"`, and a `URL` is `origin + pathname`. `consoleChannel` prints exactly what `kvLogChannel` stores, and **a channel author must not
expect a live instance** — this is the contract, not an implementation detail. `consoleChannel` keeps its own `urlNarrowing` replacer anyway,
because it is a public factory a caller may hand a hand-built record to; it is defence in depth at zero cost rather than dead code.

**A value's own `toJSON` decides its logged form.** This is the standard "safe to log" pattern: give a domain object a `toJSON` that drops its
secret, and the secret is absent from the console line _and_ from the KV record. `kvLogChannel` consults `toJSON` before its own `Map`/`Set` forms,
exactly as `JSON.stringify` does, and then walks the result — so `persistStack: false` (§2e) still strips a `stack` the `toJSON` returned.

**A `URL` narrows to `origin + pathname` — never its query or fragment.** A `URL` is the one value where honouring `toJSON` would make things worse:
`URL.prototype.toJSON` returns the full href, so `log.info("redirecting", { to: url })` would put a `?token=…` magic link into the 7-day KV window.
Both channels drop everything after the path instead. [`BOUNDARIES.md`][bnd-4a] §4a bans a credential on **any** channel, console included, so this
is not a persistence-only concern. Log a query parameter you actually need as its own named field, after deciding it is not a credential.

---

## 3. requestLogger Middleware

### 3a. requestLogger Configuration

`requestLogger` is middleware. **Register it with `app.use("*", …)` near the top of the middleware chain.** The `channels` function is called
per-request for env-dependent selection (§2d); `bindings` adds extra fields to every record.

### 3c. Ordering: requestId Before requestLogger

`requestId()` middleware MUST run before `requestLogger` in the middleware chain so the `bindings` callback can read the already-set request ID from
context. If ordered incorrectly, `requestId` will be undefined in every log record.

`applyMiddlewareChain` produces that order, along with the rest of the chain's — see [`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e, which is where the
whole order is stated. A hand-written chain owes the same two lines:

    app.use("*", requestId())
    app.use("*", requestLogger<AppEnv>({ ... }))

---

## 4. Log Levels by HTTP Status

### 4a. Level Mapping Convention

`requestLogger` assigns each record a `LogLevel` from the handler's HTTP response status:

| Status range | Level | Meaning |
| --- | --- | --- |
| `< 400` | `info` | Successful requests |
| `4xx` | `warn` | Client errors — expected, not actionable by ops |
| `5xx` | `error` | Server errors — unexpected, ops-actionable |

This convention keeps alert noise low: 404s and 422s stay at `warn` and do not page on-call.

### 4b. Debug Is Not Emitted by requestLogger

`debug` is available for explicit use via `createLogger` but is never assigned by `requestLogger`, whose level comes entirely from the status
mapping in §4a. Avoid enabling `debug` in production channel configs.

### 4c. Silencing and Level Allowlists

`LogLevel` has no `"silent"` member and `minLevel` has no "off" value, so without `withLevels` the only way to spell "log nothing" is structural —
`channels: () => []`, a different **shape** of config, and unreachable from a deployment variable: an env var can carry a value, not a channel list.

`withLevels(channel, levels)` closes that gap. It names the accepted set rather than a floor, and **an empty set is the configured form of "off"**:

    import { LOG_LEVELS, consoleChannel, parseLogLevels, withLevels } from "@y-core/forge/logging"

    // LOG_LEVEL="warn,error" → failures only; "none" → silent; unset → everything.
    channels: (c) => [withLevels(consoleChannel(), parseLogLevels(c.env.LOG_LEVEL, LOG_LEVELS))]

These properties follow from this being a **per-channel wrapper** rather than a logger-wide setting:

- **One sink can go quiet while another stays complete.** A test harness can silence the console stream — whose output is interleaved into a test
  runner's stdout — without losing the KV history that a failure investigation reads back. A logger-wide `minLevel` cannot express that, because it
  drops records before any channel sees them.
- **The wiring is identical in every environment; only the value differs.** Nothing is added or removed from the channel list per environment, so
  there is no config shape that exists only locally and no drift for a deployment to reconcile.

`read` and `readEntry` pass through even when the allowlist is empty — writes are off, history stays readable.

**This argument does not reach `channels` itself, and `channels: (c) => LogChannel[]` is unchanged** — the one structural difference left in a
channel list turns on a **binding** (§2d), which no env var can carry. What each channel redacts is not a per-channel question at all (§2e).

---

## 5. Log Viewer (logging/viewer)

### 5a. loadLogViewer — Auth-Gated Response for Every Path

`loadLogViewer(c, options)` returns `Promise<Response>` for **every** path — it renders inside the loader rather than returning data for a view to
render. In order:

1. Evaluates the **required** `access` option first. A denial (`false`) returns `403 Forbidden` before the channel is touched; the literal
   `"allow-unauthenticated"` is the explicit, greppable opt-out for deliberately public (dev-only) mounts. A throwing `access` predicate propagates
   to the error boundary (fail closed).
2. For `?detail=<key>`, reads the full stored record via `channel.readEntry?.(key)` and returns the expanded detail `<td>` fragment `Response`.
3. For an `HX-Request` (via `isHxRequest`) carrying a `?cursor=`, returns the next page as a bare `<tr>` sequence. The "Load more" control swaps its
   own row (`hx-target="closest tr"`, `hx-swap="outerHTML"`) rather than the `<tbody>`, so the rows already loaded survive, and its URL carries the
   active `?level=`/`?q=` so the next page comes from the same filtered set.
4. For any other `HX-Request`, returns the `<tbody>` HTMX partial, filtered via `?level=` and `?q=`. An unrecognised `?level=` is dropped and the
   view renders unfiltered — the filter only narrows rows `access` has already permitted, so the fallback cannot widen exposure.
5. Otherwise returns the viewer as a full document, rendered through the shell the app registered under the slot
   `{ mount: "logs", page: "logs", meta: { title: "Logs", robots: "noindex" } }` ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6). The viewer takes no
   chrome options of its own, so a theme lives in one place for every mount.

**Auth by construction:** the record-rendering components are `@internal`, so records can never be rendered without first passing `access`. If the
channel has no `read` method, `loadLogViewer` renders an empty table rather than erroring.

**A single `loadLogViewer` call in a `definePage` loader is the entire mount.** Because a loader that returns a `Response` short-circuits rendering,
the page's `view` never executes — there is no HX-branch and no fragment call left for app code to get wrong.

### 5b. Why access and icon Are Required Options

`LogViewerOptions` and `LogViewerAccess` are declared in `src/logging/viewer/route.tsx`, which owns their fields and defaults.

The `channel` factory is called once per request, and §2a's prefix rule is what makes the viewer read the key space the logger writes to.

**`access` is required because logs expose request paths, ids, and error messages** — forgetting a guard is a compile error, and public mounts must
opt out explicitly.

**`icon` is required**: the app injects its own bound `ForgeIcon<"chevron-down">` (from `@y-core/forge/ui/core`) so `logging/viewer` renders the
filter-bar chevron without owning an icon set. This is what makes `logging/viewer` a declared cross-namespace edge onto `ui/core` — see
[`NAMESPACES.md`][namespaces-4b] §4b.

---

## 6. No-PII Rule and Structured Fields

See [`BOUNDARIES.md`][boundaries-4] §4 for the no-PII rule, the prohibited field classes, and the structured-fields-over-interpolation rule. The
default redaction policy that implements it, its consumer controls and its opt-out are §2e.

**Message-string scanning is not offered, and that is deliberate.** §4b concedes that a value interpolated into a message is unreachable by any
redaction pass. A scanner would cost a regex over every message on the request path, corrupt the grep-friendly labels §4b exists to protect, both
miss (`user at example dot com`) and over-hit, and — worst — imply that a dynamic message is covered. The control is §4b's call-site rule and
review. Hashing a value to correlate it without reading it is refused for a different reason: an unkeyed digest of an email is reversible against a
known user base, and a keyed one means `crypto.subtle`, which is async, while `dispatch` is synchronous and every `Logger` method returns `void`.
§4a's own answer is the one to use — log the opaque internal id the handler already holds.

[bnd-4a]: ../warden/canon/libs/BOUNDARIES.md#4a-the-prohibited-field-classes
[boundaries-4]: ../warden/canon/libs/BOUNDARIES.md#4-no-pii-in-logs
[namespaces-4b]: ./NAMESPACES.md#4b-integration-namespace-rules
[ram-3e]: ./ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[ram-6]: ./ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[sb-5]: ./STORAGE_BINDINGS.md#5-dev-degradation
[sh-5b]: ./SECURITY_HARDENING.md#5b-logging-integration
