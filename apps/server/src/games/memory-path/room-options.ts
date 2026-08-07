import { playerNameSchema, roomCodeSchema } from "@phone-party/protocol";
import { z } from "zod";

import { MEMORY_PATH_SERVER_CONSTANTS } from "./constants.js";

/**
 * Trusted room options assembled by the platform lobby when it hands players
 * off to a Memory Path room. The roster is server-issued: it comes from the
 * lobby's synchronized player rows, never from a client payload.
 */
export const memoryPathRoomOptionsSchema = z.object({
  roomCode: roomCodeSchema,
  players: z
    .array(
      z.object({
        playerId: z.string().uuid(),
        playerName: playerNameSchema,
        isHost: z.boolean(),
        joinedOrder: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(MEMORY_PATH_SERVER_CONSTANTS.MAX_PLAYERS),
  /** Trusted test-mode flag; shortens preparing, preview, race, and results timings. */
  e2eMode: z.boolean().optional(),
  /** Trusted transition deadline; defaults to the production constant. */
  transitionTimeoutMs: z.number().int().min(1).optional(),
  /**
   * Server-issued capability token. The room rejects any creation that does
   * not carry it, so public Colyseus matchmaking cannot forge a roster or
   * test-mode flags outside the platform lobby transition.
   */
  roomCreationToken: z.string().min(1),
});

export type MemoryPathRoomOptions = z.infer<typeof memoryPathRoomOptionsSchema>;
