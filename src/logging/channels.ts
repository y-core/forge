import type { LogChannel, LogRecord } from "./types";

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
