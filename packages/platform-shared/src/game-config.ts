import { z } from "zod";

export const gameConfigSchema = z
  .object({
    minPlayers: z.number().int().min(1),
    maxPlayers: z.number().int().min(1),
    reconnectGraceMs: z.number().int().min(0),
    allowJoinAfterStart: z.boolean(),
    removeDisconnectedPlayers: z.boolean(),
    requiresReady: z.boolean(),
  })
  .strict()
  .refine((config) => config.maxPlayers >= config.minPlayers, {
    message: "maxPlayers must be greater than or equal to minPlayers",
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
