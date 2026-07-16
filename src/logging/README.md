# `@y-core/forge/logging`

Structured, channel-based logging for forge apps on Cloudflare Workers. A logger fans each
log record out to one or more **channels** — write-only `consoleChannel` for development,
read/write `kvLogChannel` for production persistence — plus a `requestLogger` middleware that
records every request/response and an optional SSR **log viewer** for browsing persisted logs.

```ts
import { createLogger, consoleChannel } from "@y-core/forge/logging";

const log = createLogger("app", { channels: [consoleChannel()] });
log.info("server started", { port: 8787 });
```

## Features

- **Structured records** — every entry carries `level`, `prefix`, `message`, ISO `timestamp`, and an arbitrary `data` field. Pass data as discrete fields, never interpolated into the message.
- **Channel fan-out** — one logger writes to any number of channels; `console` and KV in parallel.
- **Symmetric channels** — a channel exposes `write` and an optional `read`, so the same `kvLogChannel` that persists logs also backs the log viewer UI.
- **Child loggers** — `child(bindings)` clones a logger with merged context fields (e.g. a per-request `requestId`) sharing the same channels and pending-flush queue.
- **Min-level filtering** — a logger-wide `minLevel` (inherited by children) drops records before any channel sees them, and `withMinLevel(channel, min)` gates a single channel so e.g. console gets the full stream while KV keeps only `warn`+. `parseLogLevel` turns a `LOG_LEVEL` env var into a `LogLevel`.
- **Per-channel redaction** — `withRedaction(channel, redact)` transforms each record before write, so sensitive fields can be stripped for a persisting channel while the console stream stays intact. Independently, `kvLogChannel` strips error `stack` from persisted `data` by default (`persistStack: false`), keeping stacks out of KV retention.
- **Error serialization** — `serializeError(err)` converts any thrown value into a JSON-safe `{ name, message, stack? }` for structured `data` fields; it never throws.
- **Async-safe flushing** — pending KV writes are tracked and awaited via `flush()`; `requestLogger` flushes them through `executionCtx.waitUntil` so the response is not blocked.
- **Request logging middleware** — one record per request with method, path, status, and duration, with the level derived from the response status code.
- **KV persistence** — time-ordered keys, per-entry metadata for zero-cost listing, TTL retention, and a probabilistic soft-cap purge.
- **SSR log viewer** — a single auth-gated `loadLogViewer` loader from `@y-core/forge/logging/show` that returns a fully rendered `Response` (full page, HTMX `<tbody>` partial, or record-detail fragment) for browsing persisted logs; the JSX components are internal so records cannot render without passing the access check.

## Usage

### Create a logger

`createLogger(prefix, options?)` returns a `Logger`. The `prefix` labels every record (it
appears as the `prefix` field); `options.channels` selects where records go (defaults to a
single `consoleChannel()`).

```ts
import { createLogger, consoleChannel, kvLogChannel } from "@y-core/forge/logging";

const log = createLogger("billing", {
  channels: [consoleChannel(), kvLogChannel(env.LOGS_KV)],
  bindings: { region: "weur" },
});

log.debug("cache miss", { key: "plan:42" });
log.info("invoice issued", { invoiceId: "inv_1" });
log.warn("retrying webhook", { attempt: 2 });
log.error("charge failed", { code: "card_declined" });

await log.flush(); // await pending async channel writes
```

### Log levels

`LogLevel` is `"debug" | "info" | "warn" | "error"`. Each is a method on `Logger` with the
same signature `(message: string, data?: Record<string, unknown>) => void`.

### Child loggers and context fields

`child(bindings)` returns a new logger that merges `bindings` into every record's `data`,
sharing channels and the pending-write queue with the parent.

```ts
const requestLog = log.child({ requestId: "req_abc" });
requestLog.info("handler entered"); // record.data includes requestId: "req_abc"
```

## Core Components & APIs

### `createLogger(prefix, options?)`

Creates a structured logger that dispatches records to its channels.

| Parameter | Type | Description |
|---|---|---|
| `prefix` | `string` | Label written to every record's `prefix` field. |
| `options.channels` | `LogChannel[]` | Channels to fan records out to. Defaults to `[consoleChannel()]`. |
| `options.bindings` | `Record<string, unknown>` | Static fields merged into every record's `data`. |
| `options.minLevel` | `LogLevel` | Records below this level are dropped before any channel sees them. Children inherit it. |

Returns a `Logger`:

| Member | Signature | Description |
|---|---|---|
| `debug` / `info` / `warn` / `error` | `(message, data?) => void` | Emit a record at that level. |
| `flush` | `() => Promise<void>` | Await all pending async channel writes, then clear the queue. |
| `child` | `(bindings) => Logger` | Clone with merged `bindings`, same channels and pending queue. |

### `LogChannel`

A channel is an object, not a function. The logger calls `write`; the viewer calls the
optional `read`.

```ts
interface LogChannel {
  write(record: LogRecord): void | Promise<void>;
  read?(query?: LogQuery): Promise<LogReadResult>;
  readEntry?(key: string): Promise<LogRecord | null>;
}
```

A channel without `read` (such as `consoleChannel`) is write-only; the log viewer renders an
empty table for it rather than erroring. `readEntry` returns the full stored record for one
row key — the viewer's detail view uses it to show fields (such as a stack trace in `data`)
that don't fit in list metadata.

### `LogRecord`

```ts
interface LogRecord {
  level: LogLevel;       // "debug" | "info" | "warn" | "error"
  prefix: string;        // logger prefix
  message: string;       // static, grep-friendly label
  timestamp: string;     // ISO 8601
  data?: Record<string, unknown>; // bindings + call-site fields
}
```

### `consoleChannel()`

Returns a write-only channel that emits each record as a single JSON line to `console.log`,
shaped `{ ...data, level, prefix, message, timestamp }`. Reserved fields win over caller
`data`, so a caller cannot forge `level`, `message`, or `timestamp`. Use in development.

```ts
import { consoleChannel } from "@y-core/forge/logging";

const log = createLogger("dev", { channels: [consoleChannel()] });
```

### `withMinLevel(channel, min)`

Wraps a channel so only records at or above `min` are written; `read`/`readEntry` pass
through unchanged. Use it to fan one logger out at different verbosities per channel —
the typical production split keeps the full stream on console (`wrangler tail`) while a
capped KV namespace retains only `warn`+:

```ts
import { consoleChannel, kvLogChannel, withMinLevel } from "@y-core/forge/logging";

const channels = [consoleChannel(), withMinLevel(kvLogChannel(env.LOGS_KV), "warn")];
```

### `withRedaction(channel, redact)`

Wraps a channel so each record passes through `redact` before `write`; `read`/`readEntry` pass
through unchanged. It mirrors `withMinLevel` — a composable, per-channel transform for stripping
or masking sensitive fields (PII, secrets) before a persisting channel, while the console stream
keeps the full record:

```ts
import { consoleChannel, kvLogChannel, withRedaction } from "@y-core/forge/logging";

const channels = [
  consoleChannel(),
  withRedaction(kvLogChannel(env.LOGS_KV), (r) => ({
    ...r,
    data: r.data ? { ...r.data, email: undefined } : r.data,
  })),
];
```

| Parameter | Type | Description |
|---|---|---|
| `channel` | `LogChannel` | The channel to wrap. |
| `redact` | `(record: LogRecord) => LogRecord` | Called on each record before `write`; return the record to persist. Never mutate the input. |

Independent of `withRedaction`, `kvLogChannel` applies a built-in stack-redaction default — see
`persistStack` under [`kvLogChannel`](#kvlogchannelkv-options).

### `parseLogLevel(value, fallback)` and `levelAtLeast(level, min)`

`parseLogLevel` turns an untrusted string (typically a `LOG_LEVEL` env var) into a
`LogLevel`, case-insensitively, returning `fallback` when unset or invalid. `levelAtLeast`
compares two levels in the `debug < info < warn < error` ordering. `LOG_LEVELS` is the
ordered tuple of all levels.

```ts
import { parseLogLevel } from "@y-core/forge/logging";

const minLevel = parseLogLevel(env.LOG_LEVEL, "info");
```

### `serializeError(err)`

Converts any thrown value into a JSON-safe `SerializedError` — `{ name, message, stack? }`.
Safe on non-`Error` values (thrown strings, numbers, `null`) and never throws, so it is
usable directly on a `catch` binding:

```ts
import { serializeError } from "@y-core/forge/logging";

try {
  await risky();
} catch (err) {
  log.error("import: parse failed", { error: serializeError(err) });
  throw err;
}
```

### `kvLogChannel(kv, options?)`

Returns a read/write channel that persists records to a Cloudflare KV namespace and reads
them back for the log viewer. Keys are `{prefix}||{isoTimestamp}||{rand}`, so a lexicographic
list is oldest-first; a crypto-random suffix avoids same-millisecond collisions. Per-entry
metadata (level, prefix, message, timestamp, requestId) lets the viewer list rows without
per-row reads.

```ts
import { kvLogChannel } from "@y-core/forge/logging";

const channel = kvLogChannel(env.LOGS_KV, { prefix: "app-logs", maxLogs: 1000 });
```

`KvLogChannelOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `"logs"` | Key prefix used for **both** write and read. |
| `defaultTtl` | `number` | `604800` (7 days) | KV `expirationTtl` per entry — the hard retention backstop. |
| `maxLogs` | `number` | `500` | Soft cap; purge trims down to this count. |
| `highWater` | `number` | `maxLogs * 1.2` | Purge only runs once stored keys exceed this. |
| `purgeProbability` | `number` | `0.02` | Chance per write that a best-effort purge sweep runs. |
| `persistStack` | `boolean` | `false` | When `false`, `stack` is recursively stripped from a **cloned** `record.data` before persistence, keeping error stacks out of the KV retention window. The caller's record is never mutated, so `consoleChannel` keeps the stack for local debugging. Set `true` to persist stacks. |

The prefix captured at construction is used for both `write` and `read`, so a channel
configured with `prefix: "app-logs"` always reads `app-logs||…` keys — never the default.

### `requestLogger(options)` and `requestLog`

`requestLogger(options)` is middleware that creates a per-request child logger, stores it on
the context, and flushes pending channel writes through `executionCtx.waitUntil` once the
response is produced. `requestLog` is the context accessor for that logger inside handlers.

```ts
import { requestLogger, requestLog, consoleChannel, kvLogChannel } from "@y-core/forge/logging";
import { requestId, requestIdCtx } from "@y-core/forge/security";

// requestId must run BEFORE requestLogger so its bindings callback can read the id.
app.use("*", requestId());
app.use("*", requestLogger<AppEnv>({
  channels: (c) => c.env.LOGS_KV
    ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
    : [consoleChannel()],
  bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }),
}));

// Inside a handler:
app.get("/orders", (c) => {
  const log = requestLog.get(c);
  log.info("listing orders", { count: 12 });
  return Response.json([]);
});
```

`RequestLoggerOptions`:

| Option | Type | Description |
|---|---|---|
| `prefix` | `string` | Record prefix. Defaults to `"request"`. |
| `channels` | `(c) => LogChannel[]` | Per-request factory returning the channels to write to. |
| `bindings` | `(c) => Record<string, unknown>` | Per-request fields merged into every record (e.g. `requestId`). |
| `minLevel` | `LogLevel \| ((c) => LogLevel \| undefined)` | Logger-wide floor, static or resolved per request (e.g. `(c) => parseLogLevel(c.env.LOG_LEVEL, "info")`). `undefined` means no filtering. |

## Integration Guide

### Wire request logging into an app

1. Register `requestId()` **before** `requestLogger` so the request id is set when the `bindings` callback runs. If reordered, `requestId` is `undefined` in every record.
2. Resolve channels per-request from the environment — fall back to console-only when `LOGS_KV` is unbound (local dev without wrangler).
3. Read the per-request logger with `requestLog.get(c)` in handlers and middleware.

`requestLogger` emits one record per request/response cycle containing `method`, `path`
(no query string), `status`, `duration` (ms), and any `bindings` such as `requestId`. The
level is derived from the response status code:

| Status range | Level | Meaning |
|---|---|---|
| `< 400` | `info` | Successful requests |
| `4xx` | `warn` | Client errors — expected, not ops-actionable |
| `5xx` | `error` | Server errors — ops-actionable |

This keeps alert noise low: 404s and 422s stay at `warn`. `requestLogger` never emits
`debug`; reserve `debug` for explicit `createLogger` use and avoid it in production configs.

If `next()` throws (an error escaping the app's own boundaries), `requestLogger` emits one
`error` record with `serializeError(err)` under `data.error` (no `status` field) and
rethrows; the flush still runs.

### No PII in logs

Records (across all channels — worker `console` output is retained and searchable) must never
contain user-identifiable or credential data: emails, display names, passwords, API keys,
tokens, request bodies, or credential headers (`Authorization`, `Cookie`, `Set-Cookie`).
Reference users only by an opaque internal id. Prefer structured fields over interpolation:

```ts
// BAD — interpolates a value into the message
log.error(`process failed for ${userId}: ${err.message}`);

// GOOD — static label, variable data in fields
log.error("contact: process failed", { requestId, error: err.message });
```

## `@y-core/forge/logging/show` — Log Viewer

The `show` sub-path is a single auth-gated route loader, `loadLogViewer`, that renders a
server-side log viewer. The public surface is deliberately small — the loader plus its two
option types:

```ts
import { loadLogViewer } from "@y-core/forge/logging/show";
import type { LogViewerAccess, LogViewerOptions } from "@y-core/forge/logging/show";
```

The HTMX-driven JSX components (viewer page, table body, filter bar, level badges, detail cell)
and the fragment renderers are **internal**: records can only be rendered by going through
`loadLogViewer`, which enforces the access check first — so an unguarded viewer is impossible by
construction.

### `loadLogViewer(context, options)`

A route loader returning `Promise<Response>` for **every** path. It renders inside the loader,
so there is no view branch in app code. In order:

1. Evaluates the **required** `access` option. A denial (`false`) returns `403 Forbidden` before
   the channel is touched; a throwing predicate propagates to the error boundary (fail closed).
   A deliberately public mount opts out with the greppable literal
   `access: "allow-unauthenticated"`.
2. For `?detail=<key>` (a row's message-cell toggle), reads the full stored record via
   `channel.readEntry?.(key)` and returns the expanded detail `<td>` fragment — including fields
   like `data.stack` that never fit in list metadata. A missing entry (expired TTL, purged, or a
   channel without `readEntry`) renders a not-found cell, not an error.
3. For an HTMX request (`HX-Request: true`), returns the `<tbody>` partial, filtered and
   paginated via `?level=`, `?q=`, and `?cursor=`.
4. Otherwise returns the full HTML-document viewer page.

If the channel has no `read` method, the table renders empty rather than erroring. Logs expose
request paths, request ids, and error messages, so `access` is required at the type level —
forgetting a guard is a compile error.

`LogViewerOptions`:

| Option | Type | Description |
|---|---|---|
| `channel` | `(c) => LogChannel` | Per-request factory for the channel to read from. |
| `access` | `((c) => boolean \| Promise<boolean>) \| "allow-unauthenticated"` | **Required.** Access decision, run before the channel is touched; `false` → `403 Forbidden`. A throwing predicate propagates to the error boundary (fail closed). |
| `icon` | `ForgeIcon<"chevron-down">` | **Required.** App-bound icon rendered in the filter bar's level select. The app injects its own icon so `logging/show` need not own an icon set. |
| `basePath` | `string` | URL prefix the viewer is mounted at, used for HTMX targets. Defaults to `/admin/logs`. |

### Mounting the viewer

The single call is the entire mount. Because a loader that returns a `Response` short-circuits
rendering (see `definePage`), the page `view` never runs:

```ts
import { definePage } from "@y-core/forge/app";
import { kvLogChannel } from "@y-core/forge/logging";
import { loadLogViewer } from "@y-core/forge/logging/show";
import { sessionCtx } from "@y-core/forge/session";
import { chevronDownIcon } from "./ui/icons";

export const logsPage = definePage<AppEnv, AppConfig>({
  loader: (c) =>
    loadLogViewer(c, {
      channel: (cc) => kvLogChannel(cc.env.LOGS_KV!),
      access: (cc) => isAdmin(sessionCtx.getOptional(cc)), // required — 403 when false
      icon: chevronDownIcon, // required — app-bound ForgeIcon<"chevron-down">
      basePath: "/admin/logs",
    }),
  // Unreachable: the loader always returns a Response, which short-circuits rendering.
  view: () => new Response(null, { status: 404 }),
});
```

The rendered viewer wires the HTMX interactions itself: the filter bar issues an `hx-get` to
`basePath` and swaps the table body; the load-more control appends `?cursor=`; each row's
message cell issues `?detail=<key>` and swaps itself for the expanded detail cell the loader
returns.

### Types

`LogViewerAccess` and `LogViewerOptions` are the two exported types. The row/query/result shapes
that describe the channel read contract — `LogRow`, `LogQuery`, `LogReadResult` — are exported
from the main entry `@y-core/forge/logging`, not from `show`.

## Advanced

### Flush semantics

Async channel writes (KV) return promises that the logger tracks in a pending queue capped at
1000 entries; the oldest is dropped if the cap is exceeded, bounding memory in long-lived
loggers. `flush()` awaits and clears the queue. `requestLogger` calls `flush()` in a `finally`
block and hands the promise to `executionCtx.waitUntil` so writes complete after the response
is returned, falling back to awaiting inline if no execution context is available.

### KV key layout and retention

`kvLogChannel` keys are `{prefix}||{isoTimestamp}||{rand}` where `rand` is 8 hex chars (32
bits) of crypto randomness, avoiding the same-millisecond collisions that last-write-wins KV
would otherwise drop. Each `write` stores `KvLogMetadata` (`level`, `prefix`, `message`
truncated to 256 chars, `timestamp`, optional `requestId` truncated to 64 chars) so the
viewer lists rows from list metadata alone. Retention is enforced two ways: `defaultTtl` is
the hard backstop on every entry, and a probabilistic purge (running with `purgeProbability`
per write, only once stored keys exceed `highWater`) trims the oldest entries down to
`maxLogs` in batches. The purge is best-effort and swallows errors; the TTL is authoritative.

### Reading with filters and pagination

`read(query)` lists up to `query.limit` keys (default 50) from the channel prefix, optionally
continuing from `query.cursor`. It applies `query.level` and `query.q` (case-insensitive
substring over message, prefix, and requestId) as in-memory filters over the listed page, and
returns `complete` plus an optional `cursor` for the next page. Because filtering is per-page,
a narrow `level`/`q` filter may return fewer than `limit` rows even when more matching entries
exist on later pages — follow the cursor to continue.

## Architecture

For the design rationale — the symmetric read/write channel contract, status-to-level
mapping, KV storage layout, and the no-PII rule — see
[`.decisions/STRUCTURED_LOGGING.md`](../../.decisions/STRUCTURED_LOGGING.md).
