import { consoleChannel } from "./channels";
import { serializeError } from "./serialize-error";
import type { LogChannel, Logger, LoggerOptions, LogLevel, LogRecord } from "./types";
import { levelAtLeast } from "./types";

const PENDING_CAP = 1000;

/** State shared by a logger and every child it spawns, so a child inherits it by reference. */
interface LoggerCore {
  channels: LogChannel[];
  pending: Promise<void>[];
  onChannelError: (error: unknown) => void;
}

/**
 * Default channel-error report: one structured line in the same shape `consoleChannel` writes, so a
 * persistence outage is visible in `wrangler tail` with no configuration. Written to `console.error`
 * to keep it distinguishable from the log stream it is reporting on.
 */
function reportChannelError(error: unknown): void {
  console.error(
    JSON.stringify({
      error: serializeError(error),
      // reserved fields last, matching `consoleChannel` — the report reads like any other record
      level: "error",
      prefix: "logger",
      message: "log channel write failed",
      timestamp: new Date().toISOString(),
    }),
  );
}

/** Creates a structured logger that dispatches log records to one or more channels. @public */
export function createLogger(prefix: string, options?: LoggerOptions): Logger {
  const core: LoggerCore = {
    channels: options?.channels ?? [consoleChannel()],
    pending: [],
    onChannelError: options?.onChannelError ?? reportChannelError,
  };
  return makeLogger(prefix, options?.bindings ?? {}, core, options?.minLevel);
}

function makeLogger(prefix: string, bindings: Record<string, unknown>, core: LoggerCore, minLevel?: LogLevel): Logger {
  const { channels, pending } = core;

  function notifyChannelError(error: unknown): void {
    try {
      core.onChannelError(error);
    } catch {
      // A failing report must not become a second failure on the request path: logging is
      // best-effort about persistence, and a caller-supplied hook is no exception to that.
    }
  }

  function dispatch(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (minLevel !== undefined && !levelAtLeast(level, minLevel)) return;
    const hasBindings = Object.keys(bindings).length > 0;
    const merged = hasBindings || data ? { ...bindings, ...(data ?? {}) } : undefined;
    const record: LogRecord = { level, prefix, message, timestamp: new Date().toISOString(), ...(merged !== undefined ? { data: merged } : {}) };
    for (const channel of channels) {
      // Per channel, so one channel failing synchronously still leaves the rest of the fan-out to
      // run. A write can fail either way — `consoleChannel` throws outright on a cyclic `data`
      // payload, because `JSON.stringify` does — and both modes are absorbed identically.
      try {
        const result = channel.write(record);
        if (result instanceof Promise) {
          // A sibling handler, never a chain: `pending` keeps the *original* promise, so `flush` still
          // awaits the write itself rather than a derived one that always resolves. Observing here
          // rather than in `flush` also covers writes evicted by `PENDING_CAP`, which `flush` never
          // sees and which would otherwise fail with nobody watching.
          result.catch(notifyChannelError);
          if (pending.length >= PENDING_CAP) {
            // Drop the oldest entry to prevent unbounded memory growth in long-lived loggers.
            // The dropped write is fire-and-forget by design: it is no longer tracked, so `flush()`
            // will not await it (see the best-effort contract on `flush`).
            pending.splice(0, 1);
          }
          pending.push(result);
        }
      } catch (error) {
        // A synchronous throw produced no promise, so there is nothing to track — reporting it is the
        // whole of the handling, and `pending` stays free of a bogus entry `flush` would await.
        notifyChannelError(error);
      }
    }
  }

  return {
    debug: (message, data) => dispatch("debug", message, data),
    info: (message, data) => dispatch("info", message, data),
    warn: (message, data) => dispatch("warn", message, data),
    error: (message, data) => dispatch("error", message, data),
    /**
     * Awaits all writes currently tracked as pending and returns once they settle.
     *
     * @remarks
     * Best-effort contract: `flush` only awaits writes still in the pending buffer. Writes evicted
     * by `PENDING_CAP` (dropped to bound memory in long-lived loggers) are fire-and-forget and may
     * not have completed when `flush` resolves. A guaranteed-drain contract would require backpressure
     * that makes the synchronous log API async — out of scope.
     *
     * A channel write that rejects is absorbed rather than propagated — `allSettled`, so one failing
     * channel neither hides the others' completion nor turns a logging failure into a caller-visible
     * error. Logging is best-effort about persistence in both directions: it must not fail the work
     * it is describing.
     */
    async flush(): Promise<void> {
      const toAwait = pending.splice(0);
      await Promise.allSettled(toAwait);
    },
    child(extra: Record<string, unknown>): Logger {
      return makeLogger(prefix, { ...bindings, ...extra }, core, minLevel);
    },
  };
}
