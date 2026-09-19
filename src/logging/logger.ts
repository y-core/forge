import { consoleChannel } from "./channels";
import { LOG_REDACTION_FAILED } from "./log-clone";
import { applyLogRedaction, DEFAULT_LOG_REDACTION } from "./redact";
import { serializeError } from "./serialize-error";
import type { LogChannel, Logger, LoggerOptions, LogLevel, LogRecord, LogRedactionOff, LogRedactionPolicy } from "./types";
import { levelAtLeast } from "./types";

const PENDING_CAP = 1000;
const REDACTION_OFF: LogRedactionOff = "allow-unredacted-logs";

interface LoggerCore {
  channels: LogChannel[];
  pending: Promise<void>[];
  onChannelError: (error: unknown) => void;
  redact: LogRedactionPolicy | null;
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
    redact: options?.redact === REDACTION_OFF ? null : (options?.redact ?? DEFAULT_LOG_REDACTION),
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

  // Both steps run caller-supplied code — the spread invokes getters, and the walk `toJSON` — so
  // both are inside the guard: a logging call may not fail the work it describes.
  /** The record's `data`, redacted; a failure here drops it rather than passing it through unredacted. */
  function safeData(data?: Record<string, unknown>): { data?: Record<string, unknown> } {
    if (Object.keys(bindings).length === 0 && !data) return {};
    try {
      const merged = { ...bindings, ...data };
      // Once, ahead of the fan-out: every channel gets the same redacted clone, so no channel can be
      // dirtier than another and a `withRedaction` wrapper downstream can only redact further.
      return { data: core.redact === null ? merged : applyLogRedaction(merged, core.redact) };
    } catch (error) {
      notifyChannelError(error);
      return { data: { [LOG_REDACTION_FAILED]: true } };
    }
  }

  function dispatch(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (minLevel !== undefined && !levelAtLeast(level, minLevel)) return;
    const record: LogRecord = { level, prefix, message, timestamp: new Date().toISOString(), ...safeData(data) };
    for (const channel of channels) {
      try {
        const result = channel.write(record);
        if (result instanceof Promise) {
          result.catch(notifyChannelError);
          if (pending.length >= PENDING_CAP) {
            // oxlint-disable-next-line typescript/no-floating-promises -- splice returns the evicted promise, which already carries the .catch attached above
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
