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

/** Wraps a channel so only records at or above `min` are written; reads pass through unchanged. @public */
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

/** Wraps a channel so only records whose level is in `levels` are written; reads pass through unchanged. @public */
export function withLevels(channel: LogChannel, levels: readonly LogLevel[]): LogChannel {
  const allowed = new Set(levels);
  return {
    write(record: LogRecord): void | Promise<void> {
      if (!allowed.has(record.level)) return;
      return channel.write(record);
    },
    ...(channel.read ? { read: channel.read.bind(channel) } : {}),
    ...(channel.readEntry ? { readEntry: channel.readEntry.bind(channel) } : {}),
  };
}

/** Wraps a channel so each record passes through `redact` before being written; reads pass through unchanged. @public */
export function withRedaction(channel: LogChannel, redact: (record: LogRecord) => LogRecord): LogChannel {
  return {
    write(record: LogRecord): void | Promise<void> {
      return channel.write(redact(record));
    },
    ...(channel.read ? { read: channel.read.bind(channel) } : {}),
    ...(channel.readEntry ? { readEntry: channel.readEntry.bind(channel) } : {}),
  };
}
