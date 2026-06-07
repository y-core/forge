import type { LogChannel, LogRecord } from "./types";

/** Emits structured JSON to console: `{ level, prefix, message, timestamp, ...data }`. */
export function consoleChannel(): LogChannel {
  return {
    write(record: LogRecord): void {
      const { data, ...rest } = record;
      console.log(JSON.stringify({ ...rest, ...(data ?? {}) }));
    },
  };
}
