---
title: Structured Logging
description: "createLogger, consoleChannel, kvLogChannel, requestLogger, requestLog, LogLevel, LogChannel object write/read, log channels, KV log storage, logging/http loadLogViewer, renderLogFragment, LogTable, LogFilterBar, no PII in logs, level by status code, symmetric read/write channel"
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
- §2 Channel pattern: `LogChannel` is `{ write, read? }` — consoleChannel for dev, kvLogChannel for prod
- §3 requestLogger middleware: config, bindings (requestId), channel selection
- §4 Log levels: INFO/WARN/ERROR mapping to HTTP status codes
- §5 logging/http: loadLogViewer, renderLogFragment, LogTable, LogFilterBar, LogLevelBadge
- §6 No-PII rule and structured fields

---

## 1. Logging Namespace Exports

From `@y-core/forge/logging` (`src/logging/mod.ts`):

- `createLogger(options)` — creates a Logger instance with channels
- `consoleChannel()` — log channel that writes to console; no `read`
- `kvLogChannel(kv, options?)` — log channel that writes to and reads from Workers KV
- `requestLogger(options)` — middleware that creates a per-request child logger
- `requestLog` — context accessor for the per-request logger
- Types: `LogChannel`, `Logger`, `LoggerOptions`, `LogLevel`, `LogRecord`, `LoggerContext`,
  `KvLogChannelOptions`, `KvLogMetadata`, `RequestLoggerOptions`,
  `LogQuery`, `LogReadResult`, `LogRow`

From `@y-core/forge/logging/http` (`src/logging/http/mod.ts`):

- `loadLogViewer(c, options)` — loader that reads via `options.channel.read?(query)`
- `renderLogFragment(data)` — renders the `<tbody>` HTMX partial
- `LogFilterBar` — JSX: filter controls component
- `LogLevelBadge` — JSX: colored badge for log level
- `LogTable`, `LogTableBody` — JSX: table components for log display
- Types: `LogQuery`, `LogReadResult`, `LogRow`, `LogViewerLoaderData`, `LogViewerOptions`

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

`kvLogChannel` writes structured JSON log records to a Workers KV namespace and
exposes a `read` method for the log viewer. Requires a `LOGS_KV` binding. Pair
with `consoleChannel` for dual output.

    import { kvLogChannel } from "@y-core/forge/logging"
    const channels = [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]

### 2d. Channel Selection by Environment

When `LOGS_KV` is absent (local dev without wrangler), fall back to console-only. Bind
channel selection to the request context so the channel list is resolved per-request.

    channels: (c) => c.env.LOGS_KV
      ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
      : [consoleChannel()]

---

## 3. requestLogger Middleware

### 3a. requestLogger Configuration

`requestLogger` is middleware. Register it with `app.use("*", ...)` near the top of the
middleware chain. The `channels` function is called per-request to allow env-dependent
channel selection. `bindings` adds extra fields to every log record.

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
| `< 400` | `info` | Successful requests |
| `4xx` | `warn` | Client errors — expected, not actionable by ops |
| `5xx` | `error` | Server errors — unexpected, ops-actionable |

This convention keeps alert noise low: 404s and 422s stay at `warn` and do not page on-call.

### 4b. LogLevel Type

    type LogLevel = "debug" | "info" | "warn" | "error"

`debug` is available for explicit use via `createLogger` but is not emitted by
`requestLogger`. Avoid `debug` in production channel configs.

---

## 5. Log Viewer (logging/http)

### 5a. loadLogViewer — Symmetric Read via Channel

`loadLogViewer` first evaluates the **required** `access` option — `false` returns a
`403 Forbidden` `Response` before the channel is touched; the literal
`"allow-unauthenticated"` is the explicit, greppable opt-out for deliberately public
(dev-only) mounts. On allow, it reads log entries by calling `channel.read?(query)` on
the channel supplied through `options.channel`. The channel owns its prefix and storage
mechanics, so the viewer is agnostic to KV key format. If the channel has no `read`
method, `loadLogViewer` returns `{ rows: [], complete: true }` — an empty table with no
error.

    import { loadLogViewer, renderLogFragment } from "@y-core/forge/logging/http"
    import { kvLogChannel } from "@y-core/forge/logging"
    import type { AppEnv } from "./app/context"

    definePage<AppEnv, AppConfig, LogViewerLoaderData>({
      loader: (c) => loadLogViewer(c, {
        channel: (cc) => kvLogChannel(cc.env.LOGS_KV!),
        access: (cc) => isAdmin(cc),          // required — 403 when false
        basePath: "/admin/logs",
      }),
      view: async (c, config, state) => {
        if (c.request.headers.get("HX-Request") === "true") {
          return renderLogFragment(state.data)
        }
        // … full page render
      },
    })

`loadLogViewer` reads optional `?level=`, `?q=`, and `?cursor=` query parameters for
filtering and cursor-based pagination. It returns `LogViewerLoaderData`, or a `403`
`Response` on denial (which `definePage` loaders short-circuit on).

### 5b. LogViewerOptions

    type LogViewerAccess<Bindings = Record<string, unknown>> =
      | ((c: AppContext<Bindings>) => boolean | Promise<boolean>)
      | "allow-unauthenticated";

    type LogViewerOptions<Bindings = Record<string, unknown>> = {
      /** Returns the log channel to read from. Called per request. */
      channel: (c: AppContext<Bindings>) => LogChannel;
      /** Required access decision; runs before the channel is touched. */
      access: LogViewerAccess<Bindings>;
      /** URL path prefix where the viewer is mounted (used for HTMX targets). */
      basePath?: string;
    };

The `channel` factory is called once per request. For `kvLogChannel`, the channel
captures the KV namespace and prefix at construction time and uses both for write
and read — the viewer always reads from the same key space the logger writes to.
`access` is required because logs expose request paths, ids, and error messages —
forgetting a guard is a compile error, and public mounts must opt out explicitly.

### 5c. Log Viewer UI Components

All components are JSX and accept typed props. Import from `@y-core/forge/logging/http`.

- `LogTable` — renders a full `<table>` of log rows including header
- `LogTableBody` — renders only the `<tbody>` rows; use for HTMX partial updates
- `LogFilterBar` — renders level/text filter `<form>` controls; posts via HTMX
- `LogLevelBadge` — inline colored `<span>` badge for debug / info / warn / error display

    ## Example: HTMX partial refresh of log table body
    <LogFilterBar targetId="log-tbody" formAction="/admin/logs" icon={icon} />
    <LogTable rows={data.rows} complete={data.complete} loadMoreAction="/admin/logs">
      <LogTableBody id="log-tbody" rows={data.rows} complete={data.complete}
                   loadMoreAction="/admin/logs" />
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
