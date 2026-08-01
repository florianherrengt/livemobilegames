import { type Logger, pino } from "pino";

export type { Logger };

export function createPlatformLogger(level: string): Logger {
  return pino({ level, base: null });
}
