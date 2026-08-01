import { z } from "zod";

/**
 * The only game command: lock a guess for the active round. Coordinates are
 * validated here (Zod) and again before any distance math (assertValidCoordinates).
 *
 * `roundNumber` guards against a late submit landing in a new round: the server
 * rejects it if the active round number differs.
 */
export const submitCommandSchema = z
  .object({
    type: z.literal("submit"),
    roundNumber: z.number().int().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

export const capitalPinCommandSchema = z.discriminatedUnion("type", [submitCommandSchema]);

export type SubmitCommand = z.infer<typeof submitCommandSchema>;
export type CapitalPinCommand = z.infer<typeof capitalPinCommandSchema>;
