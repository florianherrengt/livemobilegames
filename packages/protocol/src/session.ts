import { z } from "zod";

export const anonymousSessionSchema = z.object({
  playerId: z.string().uuid(),
});

export type AnonymousSession = z.infer<typeof anonymousSessionSchema>;
