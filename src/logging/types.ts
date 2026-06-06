import type { AppContext } from "../context/types";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  prefix: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type LogChannel = (record: LogRecord) => void | Promise<void>;

export interface LoggerOptions {
  channels?: LogChannel[];
  bindings?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  flush(): Promise<void>;
  /** Creates a child logger sharing the same channels and pending queue, with merged bindings. @public */
  child(bindings: Record<string, unknown>): Logger;
}

/** Bare variable record set by `requestLogger`. @public */
export type LoggerContext = { logger: Logger };

/**
 * Note: middleware that sets values consumed by `bindings` (e.g. `requestId`) must run
 * **before** `requestLogger` so those values are available when the callbacks execute. @public
 */
export interface RequestLoggerOptions<Bindings = Record<string, unknown>> {
  prefix?: string;
  /** Factory called once per request; return the channels to write log records to. */
  channels: (c: AppContext<Bindings>) => LogChannel[];
  bindings?: (c: AppContext<Bindings>) => Record<string, unknown>;
}

/** @public */
export interface KvLogChannelOptions {
  prefix?: string;
  defaultTtl?: number;
  maxLogs?: number;
  highWater?: number;
  purgeProbability?: number;
}

/** Metadata stored alongside each KV log entry for zero-cost viewer listing. @public */
export interface KvLogMetadata {
  level: string;
  prefix: string;
  requestId?: string;
  message: string;
  timestamp: string;
}
