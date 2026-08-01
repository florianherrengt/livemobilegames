import { z } from "zod";

export const hopCommandSchema = z
  .object({
    type: z.literal("hop"),
    sequence: z.number().int().finite(),
    targetPlatformId: z.string().regex(/^\d+:\d+$/, "Invalid platform id"),
  })
  .strict();

export const fallingPlatformsCommandSchema = z.discriminatedUnion("type", [hopCommandSchema]);

export type FallingPlatformsCommand = z.infer<typeof fallingPlatformsCommandSchema>;
