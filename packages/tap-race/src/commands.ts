import { z } from "zod";

export const tapCommandSchema = z.object({ type: z.literal("tap") }).strict();

export const tapRaceCommandSchema = z.discriminatedUnion("type", [tapCommandSchema]);

export type TapRaceCommand = z.infer<typeof tapRaceCommandSchema>;
