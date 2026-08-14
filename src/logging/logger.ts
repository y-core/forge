import { consoleChannel } from "./channels";
import { serializeError } from "./serialize-error";
import type { LogChannel, Logger, LoggerOptions, LogLevel, LogRecord } from "./types";
import { levelAtLeast } from "./types";

const PENDING_CAP = 1000;

interface LoggerCore {
  channels: LogChannel[];
  pending: Promise<void>[];
  onChannelError: (error: unknown) => void;
}

function reportChannelError(error: unknown): void {
  console.error(
    JSON.stringify({
      error: serializeError(error),
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
      // A failing report must not become a second failure on the request path.
    }
  }

  function dispatch(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (minLevel !== undefined && !levelAtLeast(level, minLevel)) return;
    const hasBindings = Object.keys(bindings).length > 0;
    const merged = hasBindings || data ? { ...bindings, ...(data ?? {}) } : undefined;
    const record: LogRecord = { level, prefix, message, timestamp: new Date().toISOString(), ...(merged !== undefined ? { data: merged } : {}) };
    for (const channel of channels) {
      try {
        const result = channel.write(record);
        if (result instanceof Promise) {
          result.catch(notifyChannelError);
          if (pending.length >= PENDING_CAP) {
            pending.splice(0, 1);
          }
          pending.push(result);
        }
      } catch (error) {
        notifyChannelError(error);
      }
    }
  }

  return {
    debug: (message, data) => dispatch("debug", message, data),
    info: (message, data) => dispatch("info", message, data),
    warn: (message, data) => dispatch("warn", message, data),
    error: (message, data) => dispatch("error", message, data),
    /** Awaits all writes currently tracked as pending and returns once they settle. */
    async flush(): Promise<void> {
      const toAwait = pending.splice(0);
      await Promise.allSettled(toAwait);
    },
    child(extra: Record<string, unknown>): Logger {
      return makeLogger(prefix, { ...bindings, ...extra }, core, minLevel);
    },
  };
}
