import { createLogger } from "../logging/logger";
import type { LogChannel, LogRecord } from "../logging/types";
import type { CapturedLogs } from "./types";

/** Builds a logger whose records land in memory, redacted exactly as a production logger's are. @public */
export function captureLogs(): CapturedLogs {
  const records: LogRecord[] = [];
  const channel: LogChannel = {
    write: (record) => {
      records.push(record);
    },
  };
  return { logger: createLogger("test", { channels: [channel] }), channel, records };
}

/** Builds a channel that drops every record, for an app's logger in a spec that asserts on none of them. @public */
export function quietChannel(): LogChannel {
  return { write: () => {} };
}
