import { z } from "zod";

export const leaderboardEntrySchema = z
  .object({
    sessionId: z.string().min(1),
    rank: z.number().int().min(1),
    primaryScore: z.number().finite(),
    label: z.string().min(1).max(64),
    secondaryLabel: z.string().max(64).optional(),
  })
  .strict();

export const matchResultSchema = z
  .object({
    winnerSessionIds: z.array(z.string().min(1)),
    leaderboard: z.array(leaderboardEntrySchema),
    finishedAt: z.number().finite(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;
