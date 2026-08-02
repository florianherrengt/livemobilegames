import { z } from "zod";

export const flapCommandSchema = z
  .object({
    type: z.literal("flap"),
    sequence: z.number().int().finite(),
    roundNumber: z.number().int().min(1),
  })
  .strict();

export const flappyRaceCommandSchema = z.discriminatedUnion("type", [flapCommandSchema]);

export type FlapCommand = z.infer<typeof flapCommandSchema>;
export type FlappyRaceCommand = z.infer<typeof flappyRaceCommandSchema>;

export type FlapRejectionReason =
  | "not-active"
  | "old-round"
  | "stale-sequence"
  | "rate-limited"
  | "not-running";

export interface FlapRejection {
  sequence: number;
  roundNumber: number;
  reason: FlapRejectionReason;
}
