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
- **Async-safe flushing** — pending KV writes are tracked and awaited via `flush()`; `requestLogger` flushes them through `executionCtx.waitUntil` so the response is not blocked.
- **Request logging middleware** — one record per request with method, path, status, and duration, with the level derived from the response status code.
- **KV persistence** — time-ordered keys, per-entry metadata for zero-cost listing, TTL retention, and a probabilistic soft-cap purge.
- **SSR log viewer** — a route loader plus HTMX-driven JSX table, filter bar, and level badges, importable from `@y-core/forge/logging/show`.

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
}
```

A channel without `read` (such as `consoleChannel`) is write-only; the log viewer renders an
empty table for it rather than erroring.

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

The `show` sub-path provides a server-rendered log viewer: a route loader that reads logs via
a channel and HTMX-driven JSX components for filtering and pagination. All JSX components are
SSR-only — **import them in server code only**.

```ts
import {
  loadLogViewer,
  renderLogFragment,
  LogViewerContent,
  LOG_TBODY_ID,
} from "@y-core/forge/logging/show";
```

### Route helpers

#### `loadLogViewer(context, options)`

A route loader. It reads `?level=`, `?q=`, and `?cursor=` from the request URL, calls
`options.channel(c).read?(query)`, and returns `LogViewerLoaderData`. If the channel has no
`read` method, it returns `{ rows: [], complete: true }` — an empty table, not an error.
Forge does not gate access; mount the route behind auth middleware in the consuming app.

`LogViewerOptions`:

| Option | Type | Description |
|---|---|---|
| `channel` | `(c) => LogChannel` | Per-request factory for the channel to read from. |
| `basePath` | `string` | URL prefix the viewer is mounted at, used for HTMX targets. Defaults to `/admin/logs`. |

#### `renderLogFragment(data)`

Renders just the `<tbody>` HTMX partial (id `LOG_TBODY_ID`) from loader data and returns it as
a fragment `Response`. Return this from the view when the request is an HTMX request
(`HX-Request === "true"`); otherwise render the full page with `LogViewerContent`.

```ts
import { loadLogViewer, renderLogFragment, LogViewerContent } from "@y-core/forge/logging/show";
import { kvLogChannel } from "@y-core/forge/logging";
import type { LogViewerLoaderData } from "@y-core/forge/logging/show";

definePage<AppEnv, AppConfig, LogViewerLoaderData>({
  loader: (c) => loadLogViewer(c, {
    channel: (cc) => kvLogChannel(cc.env.LOGS_KV!),
    basePath: "/admin/logs",
  }),
  view: async (c, _config, state) => {
    if (c.request.headers.get("HX-Request") === "true") {
      return renderLogFragment(state.data);
    }
    return <Shell><LogViewerContent data={state.data} icon={chevronDown} /></Shell>;
  },
});
```

### UI components

All components are JSX (`FC`) and SSR-only.

| Component | Description |
|---|---|
| `LogViewerContent` | Full viewer page — heading, filter bar, and table. Props: `{ data: LogViewerLoaderData, icon }`. |
| `LogTable` | Full `<table>` with header. Props: `{ rows, cursor?, complete, loadMoreAction, tbodyId? }`. |
| `LogTableBody` | The `<tbody>` only — the HTMX swap target. Props: `{ rows, cursor?, complete, loadMoreAction, id? }`. |
| `LogFilterBar` | Level/text filter `<form>` that submits via HTMX. Props: `{ level?, q?, targetId, formAction, icon }`. |
| `LogLevelBadge` | Inline colored badge for a level. Props: `{ level }`. |
| `LOG_TBODY_ID` | Stable id (`"log-tbody"`) of the table body, shared so HTMX `outerHTML` swaps target the node the partial returns. |

The filter bar issues an `hx-get` to `formAction` targeting `#targetId` with `outerHTML`
swap; the table's load-more button appends `?cursor=` to `loadMoreAction` and swaps the
closest `<tbody>`. Use `LOG_TBODY_ID` as both `tbodyId`/`targetId` so the full-page and
partial renders agree on the swap target.

### Types

`LogRow` is the shape of a single rendered row; `LogQuery` and `LogReadResult` describe the
channel read contract; `LogViewerLoaderData` is the loader output passed to the components.

```ts
interface LogRow {
  key: string;
  level: string;
  prefix: string;
  requestId?: string;
  message: string;
  timestamp: string;
}

interface LogQuery {
  level?: LogLevel;
  q?: string;
  cursor?: string;
  limit?: number;
}

interface LogReadResult {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
}
```

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
