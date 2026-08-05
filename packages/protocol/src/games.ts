import { z } from "zod";

export const gameIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only")
  .max(50);

export const gameManifestSchema = z
  .object({
    id: gameIdSchema,
    name: z.string().trim().min(1).max(50),
    description: z.string().trim().min(1).max(500),
    version: z.number().int().positive(),
    minPlayers: z.number().int().min(1),
    maxPlayers: z.number().int(),
    orientation: z.enum(["portrait", "landscape", "any"]),
  })
  .refine((manifest) => manifest.maxPlayers >= manifest.minPlayers, {
    message: "maxPlayers must be greater than or equal to minPlayers",
    path: ["maxPlayers"],
  });

export type GameManifest = z.infer<typeof gameManifestSchema>;

export const gamesResponseSchema = z.object({
  games: z.array(gameManifestSchema),
});

export type GamesResponse = z.infer<typeof gamesResponseSchema>;
