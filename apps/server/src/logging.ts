import { type Logger as PinoLogger, pino } from "pino";

export type Logger = PinoLogger;
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
