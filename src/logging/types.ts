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
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  flush(): Promise<void>;
}
