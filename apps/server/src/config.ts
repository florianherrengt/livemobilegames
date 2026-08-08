import { existsSync } from "node:fs";
import { z } from "zod";

const envFile = new URL("../../../.env", import.meta.url);
// Load the repository-root .env before validation so `pnpm dev` works without
// exporting variables manually. Tests pass explicit env objects and are not
// affected by the developer's local .env.
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const logLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);
const booleanFromEnv = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
const rateLimitSchema = z.coerce.number().int().positive().max(100_000);
const pathPrefixSchema = z
  .string()
  .trim()
  .regex(/^\/[^\s/?#]+(?:\/[^\s/?#]+)*\/?$/, "COLYSEUS_PATH must be a non-root URL path prefix")
  .transform((value) => value.replace(/\/$/, ""));

export const configSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  port: z.coerce.number().int().min(0).max(65535).default(3000),
  host: z.string().min(1).default("0.0.0.0"),
  cookieSecret: z.string().min(32, "COOKIE_SECRET must be at least 32 characters"),
  publicOrigin: z.string().url().default("http://localhost:5173"),
  colyseusPath: pathPrefixSchema.default("/colyseus"),
  lobbyMaxClients: z.coerce.number().int().min(1).max(32).default(8),
  createRoomPlayerRateLimit: rateLimitSchema.default(10),
  createRoomAddressRateLimit: rateLimitSchema.default(60),
  joinRoomPlayerRateLimit: rateLimitSchema.default(20),
  joinRoomAddressRateLimit: rateLimitSchema.default(120),
  /** Shortens game round timings for integration and E2E suites. */
  e2eTestMode: booleanFromEnv,
  /** Optional E2E-only drawing turn duration; defaults to the game constant. */
  e2eTurnDurationMs: z.coerce.number().int().min(100).optional(),
  /** Deadline for all roster players to arrive in a registered game room. */
  capitalPinTransitionTimeoutMs: z.coerce.number().int().min(1).default(15_000),
  logLevel: logLevelSchema.default("info"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    cookieSecret: env.COOKIE_SECRET,
    publicOrigin: env.PUBLIC_ORIGIN,
    colyseusPath: env.COLYSEUS_PATH,
    lobbyMaxClients: env.LOBBY_MAX_CLIENTS,
    createRoomPlayerRateLimit: env.CREATE_ROOM_PLAYER_RATE_LIMIT,
    createRoomAddressRateLimit: env.CREATE_ROOM_ADDRESS_RATE_LIMIT,
    joinRoomPlayerRateLimit: env.JOIN_ROOM_PLAYER_RATE_LIMIT,
    joinRoomAddressRateLimit: env.JOIN_ROOM_ADDRESS_RATE_LIMIT,
    e2eTestMode: env.E2E_TEST_MODE,
    e2eTurnDurationMs: env.E2E_TURN_DURATION_MS,
    capitalPinTransitionTimeoutMs: env.CAPITAL_PIN_TRANSITION_TIMEOUT_MS,
    logLevel: env.LOG_LEVEL,
  });

  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid server configuration: ${JSON.stringify(details)}`);
  }

  return parsed.data;
}
