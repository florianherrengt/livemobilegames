import { z } from "zod";

import { PROTOCOL_ERROR_CODES, PROTOCOL_OPERATIONS } from "./errors.js";
import { ROOM_CODE_ALPHABET } from "./room-codes.js";

export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 20;

export const displayNameSchema = z
  .string()
  .trim()
  .min(NAME_MIN_LENGTH, "Display name must not be empty")
  .max(NAME_MAX_LENGTH, "Display name is too long")
  .refine(
    (value) =>
      ![...value].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127;
      }),
    "Display name contains control characters",
  );

export function roomCodeSchema(length: number): z.ZodType<string> {
  return z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(
      z
        .string()
        .regex(
          new RegExp(`^[${ROOM_CODE_ALPHABET}]{${length}}$`),
          "Room code contains invalid characters or has the wrong length",
        ),
    );
}

export const requestIdSchema = z.string().min(1).max(64);

export const joinOptionsSchema = z.object({ name: displayNameSchema }).strict();

export const setReadySchema = z.object({ ready: z.boolean(), requestId: requestIdSchema }).strict();

export const startSchema = z.object({ requestId: requestIdSchema }).strict();

export const playAgainSchema = z.object({ requestId: requestIdSchema }).strict();

export const gameCommandSchema = z
  .object({
    command: z.unknown(),
    requestId: requestIdSchema.optional(),
  })
  .strict();

export const timeSyncRequestSchema = z
  .object({
    requestId: requestIdSchema,
    sentAt: z.number().finite(),
  })
  .strict();

export const timeSyncResponseSchema = z
  .object({
    requestId: requestIdSchema,
    sentAt: z.number().finite(),
    serverTime: z.number().finite(),
  })
  .strict();

export const protocolErrorSchema = z
  .object({
    code: z.enum(PROTOCOL_ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const platformErrorPayloadSchema = z
  .object({
    operation: z.enum(PROTOCOL_OPERATIONS),
    requestId: requestIdSchema.optional(),
    error: protocolErrorSchema,
  })
  .strict();

export const commandResultPayloadSchema = z.discriminatedUnion("ok", [
  z
    .object({
      requestId: requestIdSchema,
      operation: z.enum(PROTOCOL_OPERATIONS),
      ok: z.literal(true),
      data: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      requestId: requestIdSchema,
      operation: z.enum(PROTOCOL_OPERATIONS),
      ok: z.literal(false),
      error: protocolErrorSchema,
    })
    .strict(),
]);

export const storedConnectionSchema = z
  .object({
    serverUrl: z.string().min(1).max(500),
    roomId: z.string().min(1).max(100),
    roomName: z.string().min(1).max(100),
    reconnectToken: z.string().min(1),
    updatedAt: z.number().finite(),
  })
  .strict();

export type StoredConnection = z.infer<typeof storedConnectionSchema>;
