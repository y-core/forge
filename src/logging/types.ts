import type { AppContext } from "../context/types";

/** All log levels in severity order, least to most severe. @public */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Returns true when `level` is at or above `min` in the `debug < info < warn < error` ordering. @public */
export function levelAtLeast(level: LogLevel, min: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

/** Parses a level string case-insensitively; returns `fallback` when unset or unknown. @public */
export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const normalized = value?.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(normalized ?? "") ? (normalized as LogLevel) : fallback;
}

/** Parses a comma-separated level list case-insensitively; `"none"` yields an empty array. @public */
export function parseLogLevels(value: string | undefined, fallback: readonly LogLevel[]): readonly LogLevel[] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "none") return [];
  const known = normalized
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is LogLevel => (LOG_LEVELS as readonly string[]).includes(part));
  return known.length > 0 ? known : fallback;
}

/** One log event in the shape passed to a channel's `write`. @public */
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

/** A log sink; only a channel that persists its records implements the optional `read` and `readEntry`. @public */
export interface LogChannel {
  /** Persists one record; the returned promise must cover every operation the write starts. @public */
  write(record: LogRecord): void | Promise<void>;
  /** Lists stored rows matching `query`, returning a cursor when more remain. @public */
  read?(query?: LogQuery): Promise<LogReadResult>;
  /** Reads back the full stored record for one row key (e.g. for a viewer detail view). @public */
  readEntry?(key: string): Promise<LogRecord | null>;
}

/** Options for `createLogger`. @public */
export interface LoggerOptions {
  channels?: LogChannel[];
  bindings?: Record<string, unknown>;
  minLevel?: LogLevel;
  /** Called when a channel write fails, with the rejection reason or thrown value. */
  onChannelError?: (error: unknown) => void;
}

/** Structured logger with one method per level, whose `flush` settles the channel writes it has already started. @public */
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

/** Options for the `requestLogger` middleware. @public */
export interface RequestLoggerOptions<Bindings = Record<string, unknown>> {
  prefix?: string;
  channels: (c: AppContext<Bindings>) => LogChannel[];
  bindings?: (c: AppContext<Bindings>) => Record<string, unknown>;
  minLevel?: LogLevel | ((c: AppContext<Bindings>) => LogLevel | undefined);
  onChannelError?: (error: unknown) => void;
}

/** @public */
export interface KvLogChannelOptions {
  prefix?: string;
  defaultTtl?: number;
  maxLogs?: number;
  highWater?: number;
  purgeProbability?: number;
  /** When `false` (the default), `stack` properties are stripped from `record.data` before persisting. */
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
