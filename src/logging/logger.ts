import { consoleChannel } from "./channels";
import type { LogChannel, Logger, LoggerOptions, LogLevel, LogRecord } from "./types";

/** Creates a structured logger that dispatches log records to one or more channels. @public */
export function createLogger(prefix: string, options?: LoggerOptions): Logger {
  const channels: LogChannel[] = options?.channels ?? [consoleChannel()];
  const pending: Promise<void>[] = [];
  return makeLogger(prefix, options?.bindings ?? {}, channels, pending);
}

function makeLogger(prefix: string, bindings: Record<string, unknown>, channels: LogChannel[], pending: Promise<void>[]): Logger {
  function dispatch(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const hasBindings = Object.keys(bindings).length > 0;
    const merged = hasBindings || data ? { ...bindings, ...(data ?? {}) } : undefined;
    const record: LogRecord = { level, prefix, message, timestamp: new Date().toISOString(), ...(merged !== undefined ? { data: merged } : {}) };
    for (const channel of channels) {
      const result = channel(record);
      if (result instanceof Promise) {
        pending.push(result);
      }
    }
  }

  return {
    debug: (message, data) => dispatch("debug", message, data),
    info: (message, data) => dispatch("info", message, data),
    warn: (message, data) => dispatch("warn", message, data),
    error: (message, data) => dispatch("error", message, data),
    async flush(): Promise<void> {
      const toAwait = pending.splice(0);
      await Promise.all(toAwait);
    },
    child(extra: Record<string, unknown>): Logger {
      return makeLogger(prefix, { ...bindings, ...extra }, channels, pending);
    },
  };
}
