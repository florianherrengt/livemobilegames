import { z } from "zod";

import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "./constants.js";
import { ROOM_CODE_ALPHABET } from "./ids.js";

export const displayNameSchema = z
  .string()
  .trim()
  .min(NAME_MIN_LENGTH, "Display name must not be empty")
  .max(NAME_MAX_LENGTH, "Display name is too long");

export const roomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`), "Room code contains invalid characters")
      .max(5, "Room code is too long"),
  );

export const joinOptionsSchema = z.object({
  name: displayNameSchema,
});

export const hopRequestSchema = z
  .object({
    sequence: z.number().int().finite(),
    targetPlatformId: z.string().regex(/^\d+:\d+$/, "Invalid platform id"),
  })
  .strict();

export const startMatchSchema = z.object({}).strict();
