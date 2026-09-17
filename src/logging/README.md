---
title: Structured Channel-Based Logging
description: "Fans each log record out to one or more channels, with request-logging middleware and an optional viewer for persisted logs."
audience: consumer
---

# `@y-core/forge/logging`

A log line on Workers is only useful if something kept it. This namespace gives you a structured record, a set of **channels** to fan it out to —
`console` for a `wrangler tail`, KV for anything you want to read back tomorrow — and a middleware that records every request without you writing
the call.

```ts
import { consoleChannel, createLogger } from "@y-core/forge/logging";

const log = createLogger("app", { channels: [consoleChannel()] });
log.info("server started", { port: 8787 });
```

---

## Getting started

`createLogger(prefix, options?)` returns a logger with one method per level — `debug`, `info`, `warn`, `error` — each taking a static message and an
optional field bag. The `prefix` labels every record it writes.

```ts
import { consoleChannel, createLogger, kvLogChannel } from "@y-core/forge/logging";

const log = createLogger("billing", {
  channels: [consoleChannel(), kvLogChannel(env.LOGS_KV)],
  bindings: { region: "weur" }, // merged into every record
});

log.info("invoice issued", { invoiceId: "inv_1" });
log.warn("retrying webhook", { attempt: 2 });

await log.flush(); // settle the writes already started
```

Every record carries `level`, `prefix`, `message`, an ISO `timestamp`, and whatever `data` you passed merged over the logger's `bindings`. The
message stays a static, greppable label and the variable part goes in fields — that is the rule, and it is also a PII control
([`BOUNDARIES.md`][boundaries-4] §4).

`child(bindings)` clones a logger with extra fields, sharing its channels and its pending-write queue. This is how per-request context travels:

```ts
const requestLog = log.child({ requestId: "req_abc" });
requestLog.info("handler entered"); // record.data carries requestId
```

An asynchronous channel write does not block the call — the logger tracks it and `flush()` awaits what it is holding.

---

## Sending records to more than one place

A logger writes to every channel in its list. The usual production pair is console plus KV: the console stream is what you watch live, the KV
stream is what you read back. Neither one waits for the other.

Resolve the list from the request context so a missing binding degrades instead of throwing — locally, without `wrangler`, `LOGS_KV` is unbound.
That fallback is the canonical form and [`STRUCTURED_LOGGING.md`][sl-2d] §2d owns it:

```ts
channels: (c) => (c.env.LOGS_KV ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)] : [consoleChannel()]);
```

`consoleChannel()` is write-only: one JSON line per record, with `level`, `prefix`, `message` and `timestamp` winning over anything of the same name
in your `data`, so a caller cannot forge them. `kvLogChannel(kv, options?)` is read/write — the same object the log viewer reads back through.

---

## Persisting logs to KV

`kvLogChannel(env.LOGS_KV, options?)` persists each record under a time-ordered key and stores a small metadata blob alongside it, so the viewer can
list rows without reading each one. Keys sort newest-first by construction; the format and what a purge deletes are
[`STRUCTURED_LOGGING.md`][sl-2g] §2g's.

```ts
const channel = kvLogChannel(env.LOGS_KV, { prefix: "app-logs", maxLogs: 1000 });
```

The options are two independent decisions.

**How long an entry may live.** `defaultTtl` is a hard per-entry expiry — the backstop, always enforced. `maxLogs` is a soft cap on how many entries
you want to keep around; the channel trims towards it on a small, random fraction of writes (`purgeProbability`), and only once the stored count
passes `highWater`. Raising `maxLogs` buys history at the cost of a longer listing per sweep; lowering `defaultTtl` is the only change that
_guarantees_ an entry is gone.

**Which key space it is.** `prefix` is captured once and used for **both** write and read, so a channel built with `prefix: "app-logs"` never reads
the default space. Apps sharing one KV namespace need a prefix each.

`persistStack` is the one option whose default reverses what you might expect: it is `false`, so `stack` is stripped from a _clone_ of `record.data`
before the put. Your record is untouched, so the console still shows the full stack — see [Keeping sensitive data out of logs][pii-section].

The defaults for all of these live in `src/logging/kv-channel.ts`.

---

## Controlling how much each channel keeps

Cut the stream at the logger or at a single channel; the two places answer different questions.

**`minLevel` on the logger** drops a record before any channel sees it. Children inherit it. Use it when the record should not exist at all.

**A wrapper on one channel** lets the same record reach one sink and not another. Use it when the console should stay verbose while KV stays cheap:

```ts
import { consoleChannel, kvLogChannel, withMinLevel } from "@y-core/forge/logging";

const channels = [consoleChannel(), withMinLevel(kvLogChannel(env.LOGS_KV), "warn")];
```

`withMinLevel(channel, min)` names a floor. `withLevels(channel, levels)` names the set outright, which buys two things a floor cannot express — a
non-contiguous selection, and silence from an empty array. Why "off" is a _value_ here rather than a different config shape is
[`STRUCTURED_LOGGING.md`][sl-4c] §4c's.

```ts
import { consoleChannel, kvLogChannel, LOG_LEVELS, parseLogLevels, withLevels } from "@y-core/forge/logging";

// Failures only on the console; the KV history stays complete.
const channels = [withLevels(consoleChannel(), ["warn", "error"]), kvLogChannel(env.LOGS_KV)];

// LOG_LEVEL="warn,error" → failures only; "none" → silent; unset or unrecognised → the fallback.
const fromEnv = [withLevels(consoleChannel(), parseLogLevels(env.LOG_LEVEL, LOG_LEVELS))];
```

`parseLogLevel(value, fallback)` is the single-level form, for a `minLevel` driven by a `LOG_LEVEL` variable. Both parsers are case-insensitive and
fall back rather than failing, so a typo degrades to the configured default instead of to silence. `levelAtLeast(level, min)` compares two levels in
the `debug < info < warn < error` ordering, and `LOG_LEVELS` is that ordering as a tuple.

Both wrappers pass `read` and `readEntry` through untouched — writes go quiet, history stays readable.

---

## Logging every request

`requestLogger(options)` builds a per-request child logger, puts it on the context, emits one summary record per request/response, and flushes
pending writes through `executionCtx.waitUntil` so the response is never held up. `requestLog` is the accessor handlers read it back with.

Register `requestId()` **before** it, or the `bindings` callback has no id to read ([`STRUCTURED_LOGGING.md`][sl-3c] §3c):

```ts
import { consoleChannel, kvLogChannel, parseLogLevel, requestLog, requestLogger } from "@y-core/forge/logging";
import { requestId, requestIdCtx } from "@y-core/forge/security";

app.use("*", requestId());
app.use(
  "*",
  requestLogger<AppEnv>({
    channels: (c) => (c.env.LOGS_KV ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)] : [consoleChannel()]),
    bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }),
    minLevel: (c) => parseLogLevel(c.env.LOG_LEVEL, "info"),
  }),
);

app.get("/orders", (c) => {
  const log = requestLog.get(c);
  log.info("listing orders", { count: 12 });
  return Response.json([]);
});
```

The summary record carries `method`, `path` (no query string), `status` and `duration` in milliseconds, plus your `bindings`. Its level comes from
the response status, so 404s and 422s do not page anyone; the mapping is [`STRUCTURED_LOGGING.md`][sl-4a] §4a's.

`prefix` defaults to `"request"` if you do not set one, and `minLevel` may be a level or a per-request function of the context.

**A 500 persists as two correlated records.** The app's error boundary sits below this middleware, so a throwing handler is already a 500 response
by the time the summary is written — the summary shows `status: 500` and no error detail. The boundary publishes the detail separately on the same
per-request logger, as an `error` record with the message `unhandled error` carrying the serialized error under `data.error`. Deduplicating the
pair is out of scope; `message === "unhandled error"` tells them apart.

---

## Logging a caught error

`serializeError(err)` turns any thrown value — including a thrown string, number or `null` — into a JSON-safe `{ name, message, stack? }`. It never
throws, so it is safe directly on a `catch` binding:

```ts
import { serializeError } from "@y-core/forge/logging";

try {
  await risky();
} catch (err) {
  log.error("import: parse failed", { error: serializeError(err) });
  throw err;
}
```

---

## Keeping sensitive data out of logs

The field classes that must never reach a record, and why console output counts as a retained log exactly as KV does, are
[`BOUNDARIES.md`][boundaries-4] §4's. Two things in this namespace enforce it.

**`withRedaction(channel, redact)`** runs each record through your function before that channel's `write`, so you can strip a field for a persisting
channel while the console stream stays intact. Return a new record; never mutate the input.

```ts
import { consoleChannel, kvLogChannel, withRedaction } from "@y-core/forge/logging";

const channels = [
  consoleChannel(),
  withRedaction(kvLogChannel(env.LOGS_KV), (r) => ({ ...r, data: r.data ? { ...r.data, email: undefined } : r.data })),
];
```

**`kvLogChannel` strips stacks by default**, independently of any wrapper — a stack embeds argument values and file paths, and a persisted log
outlives a console line. Set `persistStack: true` only for a short-retention debug namespace; the posture is
[`STRUCTURED_LOGGING.md`][sl-2e] §2e's.

The call-site half is yours, and it is the one no wrapper can fix — a value interpolated into the message is inside an opaque string no redaction
pass can reach into:

```ts
// BAD — the id is now part of the message
log.error(`process failed for ${userId}: ${err.message}`);

// GOOD — static label, variable data in fields
log.error("contact: process failed", { requestId, error: err.message });
```

---

## Knowing when a log write failed

`flush()` **never rejects**, and that is deliberate: logging describes work and must not fail the work it describes. The consequence is that
`onChannelError` is the only thing that ever sees a failed write — the full contract is [`STRUCTURED_LOGGING.md`][sl-2f] §2f's.

You get one for free. With no hook configured, a failed write prints a single structured `console.error` line, so a `LOGS_KV` outage shows up in
`wrangler tail` with no setup at all. Pass a hook when you want it somewhere else — a counter, a health route, an alerting channel:

```ts
let droppedWrites = 0;

const log = createLogger("billing", {
  channels: [consoleChannel(), kvLogChannel(env.LOGS_KV)],
  onChannelError: (error) => {
    droppedWrites++;
    console.error(JSON.stringify({ event: "log_write_failed", error: serializeError(error) }));
  },
});
```

`requestLogger` takes the same option and threads it into the per-request logger. A hook that throws is swallowed, so reporting a logging failure
cannot become a second failure on the request path.

---

## Mounting the log viewer

`@y-core/forge/logging/show` exports one loader, `loadLogViewer`, plus the two types it takes. Everything that renders a record is internal, so a
viewer that skipped the access check cannot be built. A single call in a `definePage` loader is the entire mount — a loader returning a `Response`
short-circuits rendering, so the `view` never runs:

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
      icon: chevronDownIcon, // required — your own ForgeIcon<"chevron-down">
      basePath: "/admin/logs",
    }),
  // Unreachable: the loader always returns a Response.
  view: () => new Response(null, { status: 404 }),
});
```

`access` and `icon` are required at the type level rather than defaulted, and [`STRUCTURED_LOGGING.md`][sl-5b] §5b says why: logs expose request
paths, request ids and error messages — a deliberately public mount opts out with the greppable literal `"allow-unauthenticated"` — and this
namespace need not own an icon set. `basePath` is the URL the viewer is mounted at and is what its own HTMX requests target.

The loader answers every path itself — the page, the filtered `<tbody>`, the next page of rows, the expanded detail row — in the order
[`STRUCTURED_LOGGING.md`][sl-5a] §5a sets out. Behaviours worth knowing before you mount it: a channel with no `read` renders an empty
table rather than an error, and a `read` that _rejects_ is caught and drawn in place as an alert with a retry, with the reason withheld because a
channel error can name a binding or a key prefix.

The viewer renders into the shell you registered with `createApp({ shell })` ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6) and builds no document of its
own. That is what puts it inside your nav and your theme — a viewer with its own bare `<html>` would put dark mode out of reach, since the dark
class and the pre-paint script live on the document. With no shell registered it renders bare and unstyled.

For the table to fill the viewport instead of growing the page, the shell's content must be a direct child of a flex column that goes _definite_:

```html
<body class="flex min-h-dvh flex-col has-[[data-fill-viewport]]:h-dvh has-[[data-fill-viewport]]:overflow-hidden"></body>
```

`min-h-dvh` alone is not enough — an indefinite column takes its height from its content, so a long table grows the document. Any other layout still
renders correctly; the table just falls back to a `max-h-dvh` box.

The viewer's markup is Tailwind-classed and `forge.css` does not scan it, so an app that mounts it must add
`@source "…/@y-core/forge/src/logging";` to its own stylesheet or every class renders unstyled.

---

## Writing your own channel

A channel is an object, not a function. `write` is the only required member; implement `read` and `readEntry` when there is a store behind it and
you want the viewer to show it. The full contract is [`STRUCTURED_LOGGING.md`][sl-2a] §2a's.

```ts
import type { LogChannel } from "@y-core/forge/logging";

const channel: LogChannel = {
  write(record) {
    return fetch(SINK, { method: "POST", body: JSON.stringify(record) }).then(() => undefined);
  },
};
```

Returning a promise carries obligations. **It must cover every operation the write started**, maintenance included — `flush()` awaits what it
is handed and nothing else, so anything left outside it can be cancelled when the isolate suspends. And **only a failure of the record write itself
may reject**: a maintenance failure stays inside the channel.

`LogRow`, `LogQuery` and `LogReadResult` describe the read side and are exported from `@y-core/forge/logging`, not from `show`. A read lists a page,
applies `level` and `q` to that page, and returns `complete` plus a `cursor` when more remain.

---

## Gotchas

**A filtered read can come back short, or empty, with matches still ahead.** Filtering happens per listed page, not across the store, so a narrow
`level` or `q` may match nothing on page one. Follow the cursor. The viewer's empty state says exactly this rather than claiming there were no
matches.

**`flush()` settles the writes already started — it is not a barrier.** Anything dispatched after the splice belongs to the next flush. This is why
the error boundary schedules its own flush for the `unhandled error` record: `requestLogger`'s window has closed by then, and on an asynchronous
channel the record would otherwise be lost to isolate teardown.

**A selected purge is inside the `write` promise, not detached.** So `flush()` and `waitUntil()` hold the isolate open until the sweep finishes —
the alternative is a sweep cancelled mid-pass, which is exactly when the soft cap stops being enforced. On the small fraction of writes that trigger
one, the flush window covers a `list` and a series of delete batches, post-response under `waitUntil`.

**`record.data` is cloned into a JSON-faithful shape before it is persisted.** `Date`, `Map` and `Set` carry their payload outside enumerable own
properties, so each gets an explicit form instead of flattening to `{}`; a reference that reappears on its own path becomes `"[circular]"`, so a
cyclic structure stores rather than overflowing the stack.

**Row metadata is bounded by KV's limit, not by your message.** A long message is truncated, then the prefix, then the request id is dropped — the
list view degrades, the full record in the value does not.

**`readEntry` refuses a key outside the channel's prefix.** Without that, a viewer mounted on a shared namespace would be a read oracle for any key
in it.

---

## See also

- [`docs/STRUCTURED_LOGGING.md`][sl] — the channel contract and its wrappers (§2), the flush contract (§2f), key ordering (§2g), `requestLogger` and
  its ordering (§3), the status-to-level mapping (§4), and the viewer's ordered contract (§5)
- [`BOUNDARIES.md`][boundaries-4] §4 — the no-PII rule, the prohibited field classes, and structured fields over interpolation
- [`docs/ROUTING_AND_MIDDLEWARE.md`][ram-6] §6 — the shell the viewer renders into

[boundaries-4]: ../../warden/canon/libs/BOUNDARIES.md#4-no-pii-in-logs
[pii-section]: #keeping-sensitive-data-out-of-logs
[ram-6]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[sl]: ../../docs/STRUCTURED_LOGGING.md
[sl-2a]: ../../docs/STRUCTURED_LOGGING.md#2a-logchannel-object-interface
[sl-2d]: ../../docs/STRUCTURED_LOGGING.md#2d-channel-selection-by-environment
[sl-2e]: ../../docs/STRUCTURED_LOGGING.md#2e-withredaction-and-stack-redaction-posture
[sl-2f]: ../../docs/STRUCTURED_LOGGING.md#2f-channel-write-failures-and-flushs-error-contract
[sl-2g]: ../../docs/STRUCTURED_LOGGING.md#2g-log-ordering--newest-first-by-inverted-key
[sl-3c]: ../../docs/STRUCTURED_LOGGING.md#3c-ordering-requestid-before-requestlogger
[sl-4a]: ../../docs/STRUCTURED_LOGGING.md#4a-level-mapping-convention
[sl-4c]: ../../docs/STRUCTURED_LOGGING.md#4c-silencing-and-level-allowlists
[sl-5a]: ../../docs/STRUCTURED_LOGGING.md#5a-loadlogviewer--auth-gated-response-for-every-path
[sl-5b]: ../../docs/STRUCTURED_LOGGING.md#5b-why-access-and-icon-are-required-options
