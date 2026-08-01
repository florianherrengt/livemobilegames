import { z } from "zod";

export const DEFAULT_ROOM_CODE_LENGTH = 5;
export const DEFAULT_MAX_MESSAGES_PER_SECOND = 60;
export const DEFAULT_MAX_ROOM_LIFETIME_MS = 1_800_000;
export const DEFAULT_FINISHED_ROOM_TIMEOUT_MS = 600_000;
export const DEFAULT_RECONNECT_GRACE_MS = 10_000;
export const DEFAULT_MAX_SOCKET_PAYLOAD_BYTES = 65_536;
export const DEFAULT_QUEUE_WARN_DEPTH = 20;
export const DEFAULT_QUEUE_WARN_DURATION_MS = 100;

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export const serverConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  host: z.string().min(1),
  roomCodeLength: z.number().int().min(3).max(12),
  maxMessagesPerSecond: z.number().int().min(1),
  maxRoomLifetimeMs: z.number().int().min(0),
  finishedRoomTimeoutMs: z.number().int().min(0),
  reconnectGraceMs: z.number().int().min(0),
  roomCodeClaimTtlMs: z.number().int().min(1_000).optional(),
  maxSocketPayloadBytes: z.number().int().min(1_024),
  clientOrigins: z.array(z.string()),
  logLevel: z.enum(LOG_LEVELS),
  queueWarnDepth: z.number().int().min(1),
  queueWarnDurationMs: z.number().int().min(1),
  allowSolo: z.boolean(),
  e2eTestMode: z.boolean(),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${key}: "${raw}"`);
  }
  return value;
}

function readBool(
  env: Record<string, string | undefined>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  throw new Error(`Invalid boolean value for ${key}: "${raw}"`);
}

export function loadServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const port = readNumber(env, "PORT", 2567);
  const host = env.HOST?.trim() || "0.0.0.0";
  const roomCodeLength = readNumber(env, "ROOM_CODE_LENGTH", DEFAULT_ROOM_CODE_LENGTH);
  const maxMessagesPerSecond = readNumber(
    env,
    "MAX_MESSAGES_PER_SECOND",
    DEFAULT_MAX_MESSAGES_PER_SECOND,
  );
  const maxRoomLifetimeMs = readNumber(env, "MAX_ROOM_LIFETIME_MS", DEFAULT_MAX_ROOM_LIFETIME_MS);
  const finishedRoomTimeoutMs = readNumber(
    env,
    "FINISHED_ROOM_TIMEOUT_MS",
    DEFAULT_FINISHED_ROOM_TIMEOUT_MS,
  );
  const reconnectGraceMs = readNumber(env, "RECONNECT_GRACE_MS", DEFAULT_RECONNECT_GRACE_MS);
  const claimTtlOverride = readNumber(env, "ROOM_CODE_CLAIM_TTL_MS", 0);
  const maxSocketPayloadBytes = readNumber(
    env,
    "MAX_SOCKET_PAYLOAD_BYTES",
    DEFAULT_MAX_SOCKET_PAYLOAD_BYTES,
  );
  const logLevelRaw = env.LOG_LEVEL?.trim() || "info";
  const queueWarnDepth = readNumber(env, "QUEUE_WARN_DEPTH", DEFAULT_QUEUE_WARN_DEPTH);
  const queueWarnDurationMs = readNumber(
    env,
    "QUEUE_WARN_DURATION_MS",
    DEFAULT_QUEUE_WARN_DURATION_MS,
  );
  const clientOrigins = (env.CLIENT_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const raw = {
    port,
    host,
    roomCodeLength,
    maxMessagesPerSecond,
    maxRoomLifetimeMs,
    finishedRoomTimeoutMs,
    reconnectGraceMs,
    roomCodeClaimTtlMs: claimTtlOverride > 0 ? claimTtlOverride : undefined,
    maxSocketPayloadBytes,
    clientOrigins,
    logLevel: logLevelRaw,
    queueWarnDepth,
    queueWarnDurationMs,
    allowSolo: readBool(env, "ALLOW_SOLO", false),
    e2eTestMode: readBool(env, "E2E_TEST_MODE", false),
  };

  const parsed = serverConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid server configuration: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

export function computeRoomCodeClaimTtl(config: ServerConfig): number {
  if (config.roomCodeClaimTtlMs !== undefined) {
    return config.roomCodeClaimTtlMs;
  }
  return config.maxRoomLifetimeMs + config.finishedRoomTimeoutMs + config.reconnectGraceMs + 60_000;
}
