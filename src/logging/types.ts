import type { AppContext } from "../context/types";

/** All log levels in severity order, least to most severe. @public */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Returns true when `level` is at or above `min` in the `debug < info < warn < error` ordering. @public */
export function levelAtLeast(level: LogLevel, min: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

/**
 * Parses a level string (e.g. a `LOG_LEVEL` env var) case-insensitively; returns `fallback`
 * when the value is unset or not a known level. @public
 */
export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const normalized = value?.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(normalized ?? "") ? (normalized as LogLevel) : fallback;
}

export interface LogRecord {
  level: LogLevel;
  prefix: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/** A single log row as returned by the channel reader. @public */
export interface LogRow {
  key: string;
  level: string;
  prefix: string;
  requestId?: string;
  message: string;
  timestamp: string;
}

/** Query parameters for reading logs. The channel owns its prefix. @public */
export interface LogQuery {
  level?: LogLevel;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** Result of a channel read call including rows and an optional pagination cursor. @public */
export interface LogReadResult {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
}

export interface LogChannel {
  write(record: LogRecord): void | Promise<void>;
  read?(query?: LogQuery): Promise<LogReadResult>;
  /** Reads back the full stored record for one row key (e.g. for a viewer detail view). @public */
  readEntry?(key: string): Promise<LogRecord | null>;
}

export interface LoggerOptions {
  channels?: LogChannel[];
  bindings?: Record<string, unknown>;
  /** Records below this level are dropped before reaching any channel. Children inherit it. */
  minLevel?: LogLevel;
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
  /** Static level, or a per-request resolver (e.g. from an env var); `undefined` means no filtering. */
  minLevel?: LogLevel | ((c: AppContext<Bindings>) => LogLevel | undefined);
}

/** @public */
export interface KvLogChannelOptions {
  prefix?: string;
  defaultTtl?: number;
  maxLogs?: number;
  highWater?: number;
  purgeProbability?: number;
  /**
   * When `false` (the default), any `stack` property is recursively stripped from `record.data`
   * before the record is persisted to KV, keeping error stacks out of the 7-day retention window.
   * They remain visible in `consoleChannel` for local debugging. Set `true` to persist stacks.
   */
  persistStack?: boolean;
}

/** Metadata stored alongside each KV log entry for zero-cost viewer listing. @public */
export interface KvLogMetadata {
  level: string;
  prefix: string;
  requestId?: string;
  message: string;
  timestamp: string;
}
