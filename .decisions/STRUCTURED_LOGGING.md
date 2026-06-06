---
title: Structured Logging
description: "createLogger, consoleChannel, kvLogChannel, requestLogger, requestLog, LogLevel, LogChannel, log channels, KV log storage, logging/http logViewer, readLogs, LogTable, LogFilterBar, no PII in logs, level by status code"
weight: 23
---

# Structured Logging

> Authoritative source for forge's logging namespace: channels, request logger, KV
> log storage, and the logging/http log viewer UI component.
>
> Complements [ROUTING_AND_MIDDLEWARE.md](./ROUTING_AND_MIDDLEWARE.md) (middleware usage),
> [ERROR_HANDLING.md](./ERROR_HANDLING.md) (fail-closed log behavior).
>
> Forge runs on `@remix-run/fetch-router`. Middleware is the
> `Middleware = (context, next) => Response | Promise<Response>` type; the request
> context is `AppContext<Bindings>` (`c.env`, `c.executionCtx`, `c.request`).

---

## 0. Quick Reference

- §1 logging namespace exports: createLogger, consoleChannel, kvLogChannel, requestLogger
- §2 Channel pattern: consoleChannel for dev, kvLogChannel for prod
- §3 requestLogger middleware: config, bindings (requestId), channel selection
- §4 Log levels: info/warn/error mapping to HTTP status codes
- §5 logging/http: logViewer route, readLogs, LogTable, LogFilterBar, LogLevelBadge
- §6 No-PII rule and structured fields

---

## 1. Logging Namespace Exports

From `@y-core/forge/logging` (`src/logging/mod.ts`):

- `createLogger(prefix, options?)` — creates a Logger instance bound to a string `prefix`
- `consoleChannel()` — log channel that writes structured JSON to console
- `kvLogChannel(kv, options?)` — log channel that writes structured JSON to Workers KV
- `requestLogger(options)` — middleware that logs the request/response lifecycle
- `requestLog` — typed `contextVar<Logger>` accessor for the per-request child logger
- Types: `LogChannel`, `Logger`, `LoggerOptions`, `LogLevel`, `LogRecord`, `LoggerContext`,
  `KvLogChannelOptions`, `KvLogMetadata`, `RequestLoggerOptions`

From `@y-core/forge/logging/http` (`src/logging/http/mod.ts`):

- `logViewer(options)` — returns a `RequestHandler` for the admin log viewer
- `readLogs(kv, query)` — reads log entries from KV with filtering
- `LogFilterBar` — JSX: filter controls component
- `LogLevelBadge` — JSX: colored badge for log level
- `LogTable`, `LogTableBody`, `LogViewerContent` — JSX: table and page-content components
- `LOG_TBODY_ID` — stable `<tbody>` id shared by the table and the HTMX partial swap target
- Types: `LogQuery`, `LogReadResult`, `LogRow`, `LogViewerLoaderData`, `LogViewerOptions`

---

## 2. Channel Pattern

### 2a. consoleChannel for Development

`consoleChannel` writes formatted log records to `console.log` (INFO), `console.warn` (WARN),
and `console.error` (ERROR). Always use in development.

    import { consoleChannel } from "@y-core/forge/logging"
    const channels = [consoleChannel()]

### 2b. kvLogChannel for Production Persistence

`kvLogChannel` writes structured JSON log records to a Workers KV namespace. Requires
a `LOGS_KV` binding. Pair with `consoleChannel` for dual output.

    import { kvLogChannel } from "@y-core/forge/logging"
    const channels = [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]

### 2c. Channel Selection by Environment

When `LOGS_KV` is absent (local dev without wrangler), fall back to console-only. Bind
channel selection to the request context so the channel list is resolved per-request.

    channels: (c) => c.env.LOGS_KV
      ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
      : [consoleChannel()]

---

## 3. requestLogger Middleware

### 3a. requestLogger Configuration

`requestLogger` is a `Middleware`. Register it with `app.use("*", ...)` near the top
of the middleware chain. The `channels` function is called per-request to allow
env-dependent channel selection. `bindings` adds extra fields to every log record.
`requestIdCtx` is exported from `@y-core/forge/security` (set by the `requestId()`
middleware — see §3c).

    import { consoleChannel, kvLogChannel, requestLogger } from "@y-core/forge/logging"
    import { requestIdCtx } from "@y-core/forge/security"

    app.use("*", requestLogger<AppEnv>({
      channels: (c) => c.env.LOGS_KV
        ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
        : [consoleChannel()],
      bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }),
    }))

`requestLogger` creates a per-request child logger via `createLogger(prefix, { channels })`,
sets it on the context under `requestLog`, and flushes pending async channel writes through
`c.executionCtx.waitUntil` after the handler returns. Read it inside a handler with
`requestLog.get(c)`.

### 3b. What requestLogger Provides

`requestLogger` installs a per-request child logger; it does not emit a record on its own.
The child logger carries the `bindings` fields (e.g. `requestId`) on every record written
through it, so handlers and services that call `requestLog.get(c)` automatically correlate
their log lines. A `LogRecord` always carries `level`, `prefix`, `message`, and `timestamp`;
`bindings` and call-site `data` are merged into the record's `data` object.

When a handler logs request outcome explicitly, include structured fields such as:

- `method` — HTTP verb (GET, POST, etc.)
- `path` — URL pathname (no query string)
- `status` — HTTP response status code
- `requestId` — from `bindings` (correlation key)

Choose the level for those records using the convention in §4.

### 3c. Ordering: requestId Before requestLogger

The `requestId()` middleware (from `@y-core/forge/security`) MUST run before
`requestLogger` in the middleware chain so the `bindings` callback can read the
already-set request ID from context via `requestIdCtx`. If ordered incorrectly,
`requestId` will be undefined in every log record.

    import { requestId } from "@y-core/forge/security"

    app.use("*", requestId())
    app.use("*", requestLogger<AppEnv>({ ... }))

---

## 4. Log Levels by HTTP Status

### 4a. Level Mapping Convention

When logging the outcome of a request, choose the `LogLevel` from the HTTP response
status code emitted by the handler:

| Status range | Level | Meaning |
|---|---|---|
| `< 400` | `info` | Successful requests |
| `4xx` | `warn` | Client errors — expected, not actionable by ops |
| `5xx` | `error` | Server errors — unexpected, ops-actionable |

This convention keeps alert noise low: 404s and 422s stay at `warn` and do not page on-call.

### 4b. LogLevel Type

    type LogLevel = "debug" | "info" | "warn" | "error"

Levels are lowercase. `debug` is available for verbose diagnostics via the `Logger`
methods (`logger.debug(...)`) but should be avoided in production channel configs.

---

## 5. Log Viewer (logging/http)

### 5a. logViewer Action Wiring

`logViewer` returns a `RequestHandler`. Wire it into a controller action and mount that
action on an admin route. Declare the route in the route map, then map its name to
`logViewer` in `createController`. The viewer is unauthenticated by default — attach auth
via the action's `middleware` array.

    // routes.ts
    import { route } from "@y-core/forge/router"
    export const routes = route({
      adminLogs: { method: "GET", pattern: "/admin/logs" },
      // ...other routes
    })

    // router.tsx
    import { logViewer } from "@y-core/forge/logging/http"
    import { createController } from "@y-core/forge/router"
    import { CoreIcon } from "@assets"
    import { routes } from "./routes"

    export const controller = createController(routes, {
      actions: {
        adminLogs: logViewer<AppEnv>({
          kv: (c) => c.env.LOGS_KV,
          icon: CoreIcon,
          // basePath defaults to "/admin/logs"; set it when mounted elsewhere
        }),
      },
    })

Supply a `kv` accessor so the handler can resolve the KV namespace from the request
context per request. The full HTML page is produced by the renderer installed via
`renderWith(pageRenderer)` and read by `logViewer` through `context.get(Renderer)`;
when no renderer is installed it falls back to `Response.json(data)`. The required
`icon` supplies the filter `Select`'s chevron. HTMX requests (`HX-Request: true`) receive
only the `<tbody>` partial for incremental load-more.

### 5b. readLogs Query

`readLogs` is the imperative read interface. It accepts a `LogQuery` and returns
`{ rows: LogRow[], complete: boolean, cursor?: string }`. `complete` reports whether
the KV list is exhausted; use `cursor` for pagination. The `level` and `q` filters are
applied page-locally, since KV lists only by key prefix.

    import { readLogs } from "@y-core/forge/logging/http"

    const result = await readLogs(kv, { level: "error", q: "contact", limit: 50 })
    // result: { rows: LogRow[], complete: boolean, cursor?: string }

    // Next page:
    const next = await readLogs(kv, { level: "error", limit: 50, cursor: result.cursor })

### 5c. Log Viewer UI Components

All components are forge JSX and accept typed props. Import from `@y-core/forge/logging/http`.

- `LogViewerContent` — full viewer content (`<main>`): filter bar plus table; takes
  `{ data: LogViewerLoaderData; icon }`
- `LogTable` — renders a full `<table>` of log rows including header; takes
  `{ rows, cursor?, complete, loadMoreAction, tbodyId? }`
- `LogTableBody` — renders only the `<tbody>` rows; returned standalone for HTMX partial
  swaps; takes `{ rows, cursor?, complete, loadMoreAction, id? }`
- `LogFilterBar` — renders level/search filter `<form>` controls submitted via HTMX
  `hx-get`; takes `{ level?, q?, targetId, formAction, icon }`
- `LogLevelBadge` — inline colored `<span>` badge for `debug` / `info` / `warn` / `error`;
  takes `{ level }`

`LOG_TBODY_ID` is the shared `<tbody>` id; the filter bar targets it and the HTMX partial
returns a `<tbody>` with the same id so an `outerHTML` swap replaces the rows in place.

    // Example: viewer content with HTMX-driven filter and load-more
    <LogViewerContent data={data} icon={CoreIcon} />

    // Or compose the pieces directly:
    <LogFilterBar level={data.level} q={data.q} targetId={LOG_TBODY_ID} formAction={data.basePath} icon={CoreIcon} />
    <LogTable rows={data.rows} cursor={data.cursor} complete={data.complete} loadMoreAction={data.basePath} tbodyId={LOG_TBODY_ID} />

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
