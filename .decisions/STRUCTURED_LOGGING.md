---
title: Structured Logging
description: "The logging namespace: channels and their composable wrappers, the request logger, KV persistence, the log viewer, and the no-PII rule."
---

# Structured Logging

> Owns the logging namespace: the channel contract, the request logger, KV log storage, the
> `logging/show` viewer, and the no-PII rule. Owns the canonical channel-selection pattern (§2d).
>
> Defers to: [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §3a for middleware
> ordering; [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §5b for request-id correlation;
> [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §5 for absent-binding policy.

---

## 0. Quick Reference

- §1 Logging Namespace Exports: what `logging` and `logging/show` ship
- §2 Channel Pattern: the `LogChannel` object and its wrappers
- §2a LogChannel Object Interface: `write` required, `read` optional
- §2b consoleChannel for Development: write-only structured JSON
- §2c kvLogChannel for Production Persistence: symmetric read/write over KV
- §2d Channel Selection by Environment: the canonical fallback pattern
- §2e withRedaction and Stack-Redaction Posture: per-channel transforms and `persistStack`
- §2f Channel Write Failures and `flush`'s Error Contract: what absorbs a failed write, and who observes it
- §3 requestLogger Middleware: the per-request child logger
- §3a requestLogger Configuration: per-request channels and bindings
- §3b What requestLogger Records: the emitted fields
- §3c Ordering — requestId Before requestLogger: why the order is load-bearing
- §4 Log Levels by HTTP Status: the alert-noise convention
- §4a Level Mapping Convention: status range to level
- §4b LogLevel Type: the four levels and when `debug` applies
- §4c Silencing and Level Allowlists: `withLevels`, and why "off" is a value not a shape
- §5 Log Viewer (logging/show): the auth-gated mount
- §5a loadLogViewer — Auth-Gated Response for Every Path: the ordered contract
- §5b LogViewerOptions and LogViewerAccess: required `access` and `icon`
- §6 No-PII Rule and Structured Fields: what must never be logged
- §6a Never Log PII: the forbidden field list
- §6b Structured Fields Over String Interpolation: greppable messages, filterable data

---

## 1. Logging Namespace Exports

From `@y-core/forge/logging` (`src/logging/mod.ts`):

- `createLogger(prefix, options?)` — creates a Logger instance with channels; `options.onChannelError`
  observes writes that fail, and is the only thing that does (§2f)
- `consoleChannel()` — log channel that writes to console; no `read`
- `kvLogChannel(kv, options?)` — log channel that writes to and reads from Workers KV
- `withMinLevel(channel, min)` — composable wrapper: drops records below `min` per channel
- `withLevels(channel, levels)` — composable wrapper: accepts only the named level set per channel;
  an empty set silences it (§4c)
- `withRedaction(channel, redact)` — composable wrapper: transforms each record before write (§2e)
- `parseLogLevels(value, fallback)` — parses a comma-separated level list (or `"none"`) for
  `withLevels` (§4c)
- `requestLogger(options)` — middleware that creates a per-request child logger
- `requestLog` — context accessor for the per-request logger
- `serializeError(err)` — JSON-safe `{ name, message, stack? }` for structured `data`
- Types: `LogChannel`, `Logger`, `LoggerOptions`, `LogLevel`, `LogRecord`, `LoggerContext`,
  `KvLogChannelOptions` (incl. `persistStack`), `KvLogMetadata`, `RequestLoggerOptions`,
  `LogQuery`, `LogReadResult`, `LogRow`

From `@y-core/forge/logging/show` (`src/logging/show/mod.ts`):

- `loadLogViewer(c, options)` — auth-gated loader that returns a rendered `Response` for every
  path (see §5)
- Types: `LogViewerAccess`, `LogViewerOptions`

The record-rendering components (`LogViewerContent`, `LogTableBody`, `LogDetailCell`, …) and the
fragment renderers (`renderLogFragment`, `renderLogDetailFragment`) are `@internal`: records can
only be rendered by going through `loadLogViewer`, which enforces `access` first.

---

## 2. Channel Pattern

### 2a. LogChannel Object Interface

`LogChannel` is an **object** (not a bare function). The logger calls `channel.write(record)`;
the viewer calls `channel.read?(query)`. `read` is optional — channels that have no backing
store (like `consoleChannel`) simply omit it and the viewer renders an empty table.

    interface LogChannel {
      write(record: LogRecord): void | Promise<void>;
      read?(query?: LogQuery): Promise<LogReadResult>;
    }

    // consoleChannel: write-only
    consoleChannel().read // undefined

    // kvLogChannel: symmetric read/write
    kvLogChannel(kv).write  // writes to KV
    kvLogChannel(kv).read   // reads from the same KV prefix

The prefix captured at construction time is used for **both** write and read, so a
`kvLogChannel` configured with `prefix: "app-logs"` always reads `app-logs||…` keys —
never the default `logs||…` prefix.

### 2b. consoleChannel for Development

`consoleChannel` emits structured JSON to `console.log`. It has no `read` method.
Always use in development.

    import { consoleChannel } from "@y-core/forge/logging"
    const channels = [consoleChannel()]

### 2c. kvLogChannel for Production Persistence

`kvLogChannel` writes structured JSON log records to a Workers KV namespace and exposes a `read`
method for the log viewer. It requires a `LOGS_KV` binding. **Pair it with `consoleChannel` for
dual output** — see §2d for the selection pattern.

`record.data` is cloned into a JSON-faithful shape before persistence. `Date`, `Map` and `Set`
carry their payload outside enumerable own properties, so each gets an explicit form instead of
being flattened to `{}`: an ISO 8601 string, `{ type: "Map", entries: [[key, value], …] }`, and
`{ type: "Set", values: […] }`. A reference that reappears on its own path becomes `"[circular]"`,
so a cyclic structure stores rather than overflowing the stack.

### 2d. Channel Selection by Environment

**When `LOGS_KV` is absent (local dev without wrangler bindings), fall back to console-only.
Bind channel selection to the request context** so the list resolves per-request:

    channels: (c) => c.env.LOGS_KV
      ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
      : [consoleChannel()]

This is the canonical form — every other document links here rather than restating it.

### 2e. withRedaction and Stack-Redaction Posture

`withRedaction(channel, redact)` wraps a channel so each record passes through `redact` before
`write`; `read`/`readEntry` pass through unchanged. It mirrors `withMinLevel` — a composable,
per-channel transform for stripping or masking sensitive fields (PII, secrets). Redact before a
persisting channel while leaving the console stream intact:

    import { consoleChannel, kvLogChannel, withRedaction } from "@y-core/forge/logging"

    const channels = [
      consoleChannel(),
      withRedaction(kvLogChannel(env.LOGS_KV), (r) => ({
        ...r,
        data: r.data ? { ...r.data, email: undefined } : r.data,
      })),
    ]

Independently, `kvLogChannel` applies a built-in **stack-redaction default**:
`KvLogChannelOptions.persistStack` is `false`, so any `stack` property is recursively stripped
from a **cloned** `record.data` before persistence — error stacks never enter the 7-day KV
retention window. The caller's record is never mutated, so `consoleChannel` keeps the full stack
for local debugging. Set `persistStack: true` only when stacks must survive in KV (e.g. a
short-retention debug namespace).

### 2f. Channel Write Failures and flush's Error Contract

**`Logger.flush()` never rejects.** A channel write that fails is absorbed: the failure does not
reach the caller, and one failing channel does not hide the others' completion. This is the
deliberate posture — logging describes work and must never fail the work it describes. It is
load-bearing at the one call site that matters: `requestLogger` flushes inside a `finally` (§3),
and a `finally` that throws *replaces* whatever was propagating, so a rejecting flush could discard
a successful response or mask the handler error being rethrown.

Absorbing the rejection removes the last place a persistence outage was visible, so
**`LoggerOptions.onChannelError` is the only observer of a failed write.** Nothing else reports
one: `flush` resolves, `consoleChannel` writes synchronously and never sees the KV promise, and the
handler attached at dispatch means the runtime sees no unhandled rejection either. A `LOGS_KV`
outage with no observer is an app that looks healthy over an empty log store.

**It is on by default.** Absent a hook, a failed write produces one structured `console.error` line
in the shape `consoleChannel` writes, so an outage is visible in `wrangler tail` with zero
configuration. Supplying a hook replaces that line — route failures to a counter, a health route,
or an alerting channel. A hook that throws is swallowed: reporting a logging failure must not become
a second failure on the request path.

**The hook observes strictly more than `flush` does.** It is attached to the write as a sibling
handler rather than a chain, so `flush` still awaits the original write and its contract is
unchanged; and because the observation happens at dispatch, it also covers writes evicted from the
pending buffer by its cap — writes `flush` never sees, and which would otherwise fail with nobody
watching. The cap, the eviction policy, and `flush`'s best-effort contract over evicted writes are
owned by `src/logging/logger.ts`; usage is in `src/logging/README.md`.

**Both failure modes are absorbed, not only the asynchronous one.** A channel may fail two ways: by
rejecting the promise it returned, or by throwing before it returns one at all. The second is not
hypothetical and is reachable through the default channel — `consoleChannel` calls `JSON.stringify`,
which throws on a cyclic `data` payload, so an object graph holding a back-reference would otherwise
take the request down. A synchronous throw has no promise to attach a sibling handler to, so it is
reported directly instead, and nothing enters the pending buffer for `flush` to await. The guard is
per channel rather than around the fan-out, so one channel throwing still leaves the rest to run.
The claim in the first paragraph is therefore unconditional: **no channel failure of either kind
reaches the caller.**

`RequestLoggerOptions` mirrors the option and threads it into the per-request logger (§3a).

---

## 3. requestLogger Middleware

### 3a. requestLogger Configuration

`requestLogger` is middleware. **Register it with `app.use("*", …)` near the top of the
middleware chain.** The `channels` function is called per-request for env-dependent selection
(§2d); `bindings` adds extra fields to every record.

    import { requestLogger } from "@y-core/forge/logging"

    app.use("*", requestLogger<AppEnv>({
      channels: selectChannels,   // the §2d pattern
      bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }),
    }))

### 3b. What requestLogger Records

For each request/response cycle, `requestLogger` emits one log record containing:

- `method` — HTTP verb (GET, POST, etc.)
- `path` — URL pathname (no query string)
- `status` — HTTP response status code
- `duration` — request duration in milliseconds
- `requestId` — from `bindings` if provided (correlation key)

The log level is derived from `status` — see §4.

### 3c. Ordering: requestId Before requestLogger

`requestId()` middleware MUST run before `requestLogger` in the middleware chain so
the `bindings` callback can read the already-set request ID from context. If ordered
incorrectly, `requestId` will be undefined in every log record.

    app.use("*", requestId())
    app.use("*", requestLogger<AppEnv>({ ... }))

---

## 4. Log Levels by HTTP Status

### 4a. Level Mapping Convention

`requestLogger` automatically assigns a `LogLevel` to each log record based on the
HTTP response status code emitted by the handler:

| Status range | Level | Meaning |
|---|---|---|
| `< 400` | `info` | Successful requests |
| `4xx` | `warn` | Client errors — expected, not actionable by ops |
| `5xx` | `error` | Server errors — unexpected, ops-actionable |

This convention keeps alert noise low: 404s and 422s stay at `warn` and do not page on-call.

### 4b. LogLevel Type

    type LogLevel = "debug" | "info" | "warn" | "error"

`debug` is available for explicit use via `createLogger` but is not emitted by
`requestLogger`. Avoid `debug` in production channel configs.

### 4c. Silencing and Level Allowlists

`LogLevel` has no `"silent"` member and `minLevel` has no "off" value, so before `withLevels` the
only way to spell "log nothing" was structural — `channels: () => []`, a different **shape** of
config. That makes silence unreachable from a deployment variable: an env var can carry a value,
not a channel list.

`withLevels(channel, levels)` closes that gap. It names the accepted set rather than a floor, and
**an empty set is the configured form of "off"**:

    import { LOG_LEVELS, consoleChannel, parseLogLevels, withLevels } from "@y-core/forge/logging"

    // LOG_LEVEL="warn,error" → failures only; "none" → silent; unset → everything.
    channels: (c) => [withLevels(consoleChannel(), parseLogLevels(c.env.LOG_LEVEL, LOG_LEVELS))]

Two properties follow from this being a **per-channel wrapper** rather than a logger-wide setting:

- **One sink can go quiet while another stays complete.** A test harness can silence the console
  stream — whose output is interleaved into a test runner's stdout — without losing the KV history
  that a failure investigation reads back. A logger-wide `minLevel` cannot express that, because it
  drops records before any channel sees them.
- **The wiring is identical in every environment; only the value differs.** Nothing is added or
  removed from the channel list per environment, so there is no config shape that exists only
  locally and no drift for a deployment to reconcile.

`read` and `readEntry` pass through even when the allowlist is empty — writes are off, history
stays readable.

---

## 5. Log Viewer (logging/show)

### 5a. loadLogViewer — Auth-Gated Response for Every Path

`loadLogViewer(c, options)` returns `Promise<Response>` for **every** path — it renders inside
the loader rather than returning data for a view to render. In order:

1. Evaluates the **required** `access` option first. A denial (`false`) returns `403 Forbidden`
   before the channel is touched; the literal `"allow-unauthenticated"` is the explicit,
   greppable opt-out for deliberately public (dev-only) mounts. A throwing `access` predicate
   propagates to the error boundary (fail closed).
2. For `?detail=<key>`, reads the full stored record via `channel.readEntry?.(key)` and returns
   the expanded detail `<td>` fragment `Response`.
3. For an `HX-Request` (via `isHxRequest`) carrying a `?cursor=`, returns the next page as a bare
   `<tr>` sequence. The "Load more" control swaps its own row (`hx-target="closest tr"`,
   `hx-swap="outerHTML"`) rather than the `<tbody>`, so the rows already loaded survive, and its
   URL carries the active `?level=`/`?q=` so the next page comes from the same filtered set.
4. For any other `HX-Request`, returns the `<tbody>` HTMX partial, filtered via `?level=` and
   `?q=`. An unrecognised `?level=` is dropped and the view renders unfiltered — the filter only
   narrows rows `access` has already permitted, so the fallback cannot widen exposure.
5. Otherwise returns the full HTML-document viewer page.

**Auth by construction:** the record-rendering components are `@internal`, so records can never
be rendered without first passing `access`. If the channel has no `read` method,
`loadLogViewer` renders an empty table rather than erroring.

    import { loadLogViewer } from "@y-core/forge/logging/show"
    import { kvLogChannel } from "@y-core/forge/logging"
    import { definePage } from "@y-core/forge/app"

    export const logsPage = definePage<AppEnv, AppConfig>({
      loader: (c) => loadLogViewer(c, {
        channel: (cc) => kvLogChannel(cc.env.LOGS_KV!),
        access: (cc) => isAdmin(cc),        // required — 403 when false
        icon: chevronDownIcon,              // required — app-bound ForgeIcon<"chevron-down">
        basePath: "/admin/logs",
      }),
      // Unreachable: the loader always returns a Response, which short-circuits rendering.
      view: () => new Response(null, { status: 404 }),
    })

The single call is the entire mount. Because a loader that returns a `Response` short-circuits
rendering, `view` never executes — there is no HX-branch or fragment call in app code.

### 5b. LogViewerOptions and LogViewerAccess

    type LogViewerAccess<Bindings = Record<string, unknown>> =
      | ((c: AppContext<Bindings>) => boolean | Promise<boolean>)
      | "allow-unauthenticated";

    type LogViewerOptions<Bindings = Record<string, unknown>> = {
      /** Returns the log channel to read from. Called per request. */
      channel: (c: AppContext<Bindings>) => LogChannel;
      /** Required access decision; runs before the channel is touched. */
      access: LogViewerAccess<Bindings>;
      /** App-bound icon (must provide `chevron-down`) for the filter bar's level select. */
      icon: ForgeIcon<"chevron-down">;
      /** URL path prefix where the viewer is mounted (used for HTMX targets). Defaults to `/admin/logs`. */
      basePath?: string;
    };

The `channel` factory is called once per request. For `kvLogChannel`, the channel captures the
KV namespace and prefix at construction time and uses both for write and read — the viewer
always reads from the same key space the logger writes to.

**`access` is required because logs expose request paths, ids, and error messages** — forgetting
a guard is a compile error, and public mounts must opt out explicitly.

**`icon` is required**: the app injects its own bound `ForgeIcon<"chevron-down">` (from
`@y-core/forge/ui/core`) so `logging/show` renders the filter-bar chevron without owning an icon
set. This is what makes `logging/show` a declared cross-namespace edge onto `ui/core` — see
[`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4b.

---

## 6. No-PII Rule and Structured Fields

### 6a. Never Log PII

Log records must never contain user-identifiable or credential data. This applies to
all channels including `consoleChannel` (worker logs are retained and searchable).

Fields that must never appear in a log record:

- Email addresses, display names, or any user identifier beyond an opaque `requestId`
- Passwords, API keys, tokens, or secrets
- Request body content (may contain sensitive form fields such as passwords or SSNs)
- Headers that carry credentials: `Authorization`, `Cookie`, `Set-Cookie`

If a handler needs to reference a user for debugging, use an opaque internal ID
(e.g., a UUID primary key) that cannot be reverse-mapped without database access.

For error diagnostics, `kvLogChannel` strips `stack` from persisted `data` by default
(`persistStack: false`, §2e) — stacks stay in `consoleChannel` only. Use `withRedaction` (§2e)
to strip additional app-specific sensitive fields before a persisting channel.

### 6b. Structured Fields Over String Interpolation

Always pass data as discrete key-value fields on the log record, not interpolated into
the message string. Structured fields are indexable, filterable, and never accidentally
expose data adjacent to a sensitive value.

    // BAD: interpolating values into a message string
    logger.error(`Failed to process request for ${userId}: ${error.message}`)

    // GOOD: structured key-value fields on the record
    logger.error("contact: process failed", { requestId, error: error.message })

The message string should be a static, grep-friendly label. Variable data belongs in
the fields object where it can be filtered independently.
