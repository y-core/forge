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

---

## 0. Quick Reference

- §1 logging namespace exports: createLogger, consoleChannel, kvLogChannel, requestLogger
- §2 Channel pattern: consoleChannel for dev, kvLogChannel for prod
- §3 requestLogger middleware: config, bindings (requestId), channel selection
- §4 Log levels: INFO/WARN/ERROR mapping to HTTP status codes
- §5 logging/http: logViewer route, readLogs, LogTable, LogFilterBar, LogLevelBadge
- §6 No-PII rule and structured fields

---

## 1. Logging Namespace Exports

From `@y-core/forge/logging` (`src/logging/mod.ts`):

- `createLogger(options)` — creates a Logger instance with channels
- `consoleChannel()` — log channel that writes to console.log/warn/error
- `kvLogChannel(kv, options?)` — log channel that writes structured JSON to Workers KV
- `requestLogger(options)` — Hono middleware that logs request/response lifecycle
- `requestLog(c, options)` — imperative version of request logging
- Types: `LogChannel`, `Logger`, `LoggerOptions`, `LogLevel`, `LogRecord`, `LoggerContext`,
  `KvLogChannelOptions`, `KvLogMetadata`, `RequestLoggerOptions`

From `@y-core/forge/logging/http` (`src/logging/http/mod.ts`):

- `logViewer(options)` — route definition for the admin log viewer
- `readLogs(kv, query)` — reads log entries from KV with filtering
- `LogFilterBar` — JSX: filter controls component
- `LogLevelBadge` — JSX: colored badge for log level
- `LogTable`, `LogTableBody` — JSX: table components for log display
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

`requestLogger` is a Hono middleware. Register it with `app.use("*", ...)` near the top
of the middleware chain. The `channels` function is called per-request to allow
env-dependent channel selection. `bindings` adds extra fields to every log record.

    import { requestLogger } from "@y-core/forge/logging"

    app.use("*", requestLogger<AppEnv>({
      channels: (c) => c.env.LOGS_KV
        ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
        : [consoleChannel()],
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
| `< 400` | `INFO` | Successful requests |
| `4xx` | `WARN` | Client errors — expected, not actionable by ops |
| `5xx` | `ERROR` | Server errors — unexpected, ops-actionable |

This convention keeps alert noise low: 404s and 422s stay at WARN and do not page on-call.

### 4b. LogLevel Type

    type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG"

`DEBUG` is available for explicit use via `createLogger` but is not emitted by
`requestLogger`. Avoid `DEBUG` in production channel configs.

---

## 5. Log Viewer (logging/http)

### 5a. logViewer Route Definition

`logViewer` returns a route-compatible object containing a `loader` and a default `view`.
Mount it under an authenticated admin route. Supply a `kv` accessor so the loader can
resolve the KV namespace from the request context.

    import { logViewer } from "@y-core/forge/logging/http"
    import type { AppEnv } from "./app/context"

    route("/admin/logs", {
      ...logViewer<AppEnv>({ kv: (c) => c.env.LOGS_KV }),
      view: logsView as RouteView<AppEnv>,
    })

The custom `logsView` receives `LogViewerLoaderData` as its loader data and can override
the default rendering while reusing the individual UI components (§5c).

### 5b. readLogs Query

`readLogs` is the imperative read interface. It accepts a `LogQuery` and returns
`{ rows: LogRow[], cursor?: string }`. Use `cursor` for pagination.

    import { readLogs } from "@y-core/forge/logging/http"

    const result = await readLogs(kv, { level: "ERROR", limit: 50 })
    // result: { rows: LogRow[], cursor?: string }

    // Next page:
    const next = await readLogs(kv, { level: "ERROR", limit: 50, cursor: result.cursor })

### 5c. Log Viewer UI Components

All components are Hono JSX and accept typed props. Import from `@y-core/forge/logging/http`.

- `LogTable` — renders a full `<table>` of log rows including header
- `LogTableBody` — renders only the `<tbody>` rows; use for HTMX partial updates
- `LogFilterBar` — renders level/date filter `<form>` controls; posts via HTMX
- `LogLevelBadge` — inline colored `<span>` badge for INFO / WARN / ERROR display

    ## Example: HTMX partial refresh of log table body
    <LogFilterBar action="/admin/logs/rows" />
    <LogTable rows={data.rows}>
      <LogTableBody rows={data.rows} />
    </LogTable>

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
