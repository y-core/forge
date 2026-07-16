import type { LogChannel, LogLevel, LogRecord } from "./types";
import { levelAtLeast } from "./types";

/** Emits structured JSON to console: `{ level, prefix, message, timestamp, ...data }`. */
export function consoleChannel(): LogChannel {
  return {
    write(record: LogRecord): void {
      const { data, ...rest } = record;
      // reserved fields win — caller data cannot forge level/message/timestamp
      console.log(JSON.stringify({ ...(data ?? {}), ...rest }));
    },
  };
}

/**
 * Wraps a channel so only records at or above `min` are written; reads pass through
 * unchanged. Lets one logger fan out at different verbosities per channel — e.g. the
 * full stream to console but only `warn`+ to a capped KV namespace. @public
 */
export function withMinLevel(channel: LogChannel, min: LogLevel): LogChannel {
  return {
    write(record: LogRecord): void | Promise<void> {
      if (!levelAtLeast(record.level, min)) return;
      return channel.write(record);
    },
    ...(channel.read ? { read: channel.read.bind(channel) } : {}),
    ...(channel.readEntry ? { readEntry: channel.readEntry.bind(channel) } : {}),
  };
}

/**
 * Wraps a channel so each record is passed through `redact` before being written; reads pass
 * through unchanged. Composable transform for stripping or masking sensitive fields (PII,
 * secrets) on a per-channel basis — e.g. redact before persisting to KV while leaving the
 * console stream intact. @public
 */
export function withRedaction(channel: LogChannel, redact: (record: LogRecord) => LogRecord): LogChannel {
  return {
    write(record: LogRecord): void | Promise<void> {
      return channel.write(redact(record));
    },
    ...(channel.read ? { read: channel.read.bind(channel) } : {}),
    ...(channel.readEntry ? { readEntry: channel.readEntry.bind(channel) } : {}),
  };
}
