import { consoleChannel } from "./channels";
import type { LogChannel, Logger, LoggerOptions, LogLevel, LogRecord } from "./types";
import { levelAtLeast } from "./types";

const PENDING_CAP = 1000;

/** Creates a structured logger that dispatches log records to one or more channels. @public */
export function createLogger(prefix: string, options?: LoggerOptions): Logger {
  const channels: LogChannel[] = options?.channels ?? [consoleChannel()];
  const pending: Promise<void>[] = [];
  return makeLogger(prefix, options?.bindings ?? {}, channels, pending, options?.minLevel);
}

function makeLogger(
  prefix: string,
  bindings: Record<string, unknown>,
  channels: LogChannel[],
  pending: Promise<void>[],
  minLevel?: LogLevel,
): Logger {
  function dispatch(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (minLevel !== undefined && !levelAtLeast(level, minLevel)) return;
    const hasBindings = Object.keys(bindings).length > 0;
    const merged = hasBindings || data ? { ...bindings, ...(data ?? {}) } : undefined;
    const record: LogRecord = { level, prefix, message, timestamp: new Date().toISOString(), ...(merged !== undefined ? { data: merged } : {}) };
    for (const channel of channels) {
      const result = channel.write(record);
      if (result instanceof Promise) {
        if (pending.length >= PENDING_CAP) {
          // Drop the oldest entry to prevent unbounded memory growth in long-lived loggers.
          // The dropped write is fire-and-forget by design: it is no longer tracked, so `flush()`
          // will not await it (see the best-effort contract on `flush`).
          pending.splice(0, 1);
        }
        pending.push(result);
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
     */
    async flush(): Promise<void> {
      const toAwait = pending.splice(0);
      await Promise.all(toAwait);
    },
    child(extra: Record<string, unknown>): Logger {
      return makeLogger(prefix, { ...bindings, ...extra }, channels, pending, minLevel);
    },
  };
}
