import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const PONG_GAME_ID = "pong";

// --- Phases and geometry vocabulary ---

export const pongPhaseSchema = z.enum(["lobby", "countdown", "running", "finished"]);

export type PongPhase = z.infer<typeof pongPhaseSchema>;

export const pongWorldEdgeSchema = z.enum(["top", "right", "bottom", "left"]);

export type PongWorldEdge = z.infer<typeof pongWorldEdgeSchema>;

// --- Client commands ---

/**
 * The only Pong controls: move the paddle toward a proportional target
 * (0 = far left of the player's legal range, 1 = far right) or stop moving.
 * The payload is pure intent: a client-chosen sequence for ordering and a
 * normalized target. The server derives the actor from the connected client
 * and validates phase, membership, sequence, target bounds, and rate against
 * authoritative state.
 *
 * The payloads are strict so unknown fields cannot smuggle positions,
 * velocities, collisions, scores, identity, or outcomes into the room
 * boundary.
 */
export const pongPaddleMoveSchema = z
  .object({
    type: z.literal("paddle_move"),
    sequence: z.number().int().finite(),
    target: z.number().min(0).max(1),
  })
  .strict();

export type PongPaddleMove = z.infer<typeof pongPaddleMoveSchema>;

export const pongPaddleStopSchema = z
  .object({
    type: z.literal("paddle_stop"),
    sequence: z.number().int().finite(),
  })
  .strict();

export type PongPaddleStop = z.infer<typeof pongPaddleStopSchema>;

export const pongCommandSchema = z.discriminatedUnion("type", [
  pongPaddleMoveSchema,
  pongPaddleStopSchema,
]);

export type PongCommand = z.infer<typeof pongCommandSchema>;

export const pongRejectionReasonSchema = z.enum([
  "not-running",
  "not-active",
  "stale-sequence",
  "rate-limited",
]);

export type PongRejectionReason = z.infer<typeof pongRejectionReasonSchema>;

/** Private paddle rejection sent only to the player whose intent was refused. */
export const pongRejectionSchema = z
  .object({
    sequence: z.number().int().finite(),
    reason: pongRejectionReasonSchema,
  })
  .strict();

export type PongRejection = z.infer<typeof pongRejectionSchema>;

export const PONG_MESSAGE_TYPES = {
  paddleMove: "game:paddle-move",
  paddleStop: "game:paddle-stop",
  paddleRejected: "paddle-rejected",
} as const;

// --- Shared gameplay constants ---

/**
 * Shared Pong geometry and tuning. The server uses these values for the
 * authoritative simulation and collision; the web renderer uses the same
 * values so drawn walls, openings, paddles, and balls match the authoritative
 * world. Server-only timing overrides (E2E mode) live in the server game
 * constants module.
 */
export const PONG_CONSTANTS = {
  WORLD_SIZE: 600,
  PADDLE_THICKNESS: 12,
  BALL_RADIUS: 9,
  CORNER_BUMPER_SIZE: 20,
  /** Personal opening width as a fraction of one edge for 3-8 player matches. */
  GOAL_RATIO_MULTI: 0.44,
  SHARED_EDGE_OUTER_RATIO: 0.04,
  SHARED_EDGE_DIVIDER_RATIO: 0.04,
  /** Two-player mode uses larger symmetric openings with solid side walls. */
  TWO_PLAYER_GOAL_RATIO: 0.8,
  TWO_PLAYER_SIDE_RATIO: 0.1,
  /** Paddle length as a fraction of the player's personal opening width. */
  PADDLE_TO_GOAL_RATIO: 0.42,
  /** Smallest allowed |vx| or |vy| fraction of ball speed. */
  MIN_DIRECTION_COMPONENT: 0.3,
  MAX_DEFLECTION_DEGREES: 60,
  MIN_DEFLECTION_DEGREES: 18,
  /** Fixed ball speed in world units per second. */
  BALL_SPEED: 375,
  /** Target time for a paddle to cross its full legal movement range. */
  PADDLE_CROSS_TIME_SECONDS: 0.8,
  /** Warning duration for newly spawned balls. */
  SPAWN_WARNING_MS: 1_000,
  /** Fixed escalation schedule: one more desired ball every interval. */
  ESCALATION_INTERVAL_MS: 12_000,
  TARGET_SCORE: 10,
  MAX_BALLS_BY_PLAYERS: {
    2: 2,
    3: 3,
    4: 3,
    5: 4,
    6: 4,
    7: 5,
    8: 5,
  } as const,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
} as const;

export type PongConstants = typeof PONG_CONSTANTS;

export type PongRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Clockwise rotation applied to the world before drawing so the player's own
 * defended edge appears at the bottom. Positive angles rotate clockwise on
 * screen. With this mapping every player's local right is the same
 * counterclockwise direction around the arena, so clockwise relationships
 * stay consistent between clients.
 */
export const PONG_EDGE_ROTATION: Record<PongWorldEdge, number> = {
  bottom: 0,
  right: 90,
  top: 180,
  left: 270,
};

/** Axis-aligned rectangle of a player's paddle in world coordinates. */
export function paddleRect(input: {
  worldEdge: PongWorldEdge;
  paddleCenter: number;
  paddleLength: number;
}): PongRect {
  const thickness = PONG_CONSTANTS.PADDLE_THICKNESS;
  const size = PONG_CONSTANTS.WORLD_SIZE;
  switch (input.worldEdge) {
    case "top":
      return {
        x: input.paddleCenter - input.paddleLength / 2,
        y: 0,
        width: input.paddleLength,
        height: thickness,
      };
    case "bottom":
      return {
        x: input.paddleCenter - input.paddleLength / 2,
        y: size - thickness,
        width: input.paddleLength,
        height: thickness,
      };
    case "left":
      return {
        x: 0,
        y: input.paddleCenter - input.paddleLength / 2,
        width: thickness,
        height: input.paddleLength,
      };
    case "right":
      return {
        x: size - thickness,
        y: input.paddleCenter - input.paddleLength / 2,
        width: thickness,
        height: input.paddleLength,
      };
  }
}

// --- Synchronized Colyseus state ---

export class PongBallState extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  /** Authoritative velocity; zero while the ball is in its spawn warning. */
  @type("number") vx = 0;
  @type("number") vy = 0;
  /** Empty string means the ball is neutral (no paddle touch yet). */
  @type("string") ownerSessionId = "";
  @type("string") spawnState: "warning" | "moving" = "warning";
  /** Absolute epoch ms when a warning ball launches; 0 for moving balls. */
  @type("number") spawnsAt = 0;
}

export class PongPlayerState extends Schema {
  @type("string") name = "";
  @type("string") connectionStatus: "connected" | "reconnecting" | "disconnected" = "connected";
  @type("number") joinedOrder = 0;
  @type("string") color = "";
  @type("string") worldEdge: PongWorldEdge = "bottom";
  /** 0 for solo edges; 0/1 for the two personal slots of a shared edge. */
  @type("number") slotIndex = 0;
  /** Opening segment along the world edge, in world units. */
  @type("number") openingStart = 0;
  @type("number") openingEnd = 0;
  /** Legal paddle-centre range along the world edge, in world units. */
  @type("number") paddleMin = 0;
  @type("number") paddleMax = 0;
  @type("number") paddleLength = 0;
  @type("number") paddleCenter = 0;
  @type("number") score = 0;
  @type("number") lastAcceptedSequence = 0;
}

export class PongLeaderboardEntryState extends Schema {
  @type("string") sessionId = "";
  @type("number") rank = 0;
  @type("number") score = 0;
  @type("string") label = "";
}

/** Final match result, synchronized while the room is finished. */
export class PongResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([PongLeaderboardEntryState]) leaderboard = new ArraySchema<PongLeaderboardEntryState>();
}

/**
 * Synchronized Pong room state.
 *
 * Only public match facts are exposed: phase, countdown deadline, elapsed
 * time, ball speed, the current ball list, per-player geometry, paddles and
 * scores, and the final result. The seed, RNG, pending input queues, sequence
 * windows, rate-limit state, simulation accumulators, and all other
 * server-only simulation internals stay outside the schema.
 */
export class PongState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: PongPhase = "lobby";
  /** Absolute epoch ms when the countdown ends; 0 outside countdown. */
  @type("number") countdownEndsAt = 0;
  /** Authoritative match elapsed ms since GO; frozen when the match ends. */
  @type("number") matchElapsedMs = 0;
  /** Authoritative shared ball speed for the current match. */
  @type("number") ballSpeed = 0;
  /** Authoritative shared paddle speed for the current match. */
  @type("number") paddleSpeed = 0;
  /** Current desired simultaneous ball count (active + pending warnings). */
  @type("number") desiredBallCount = 0;
  /** Most recent goal event: the defender whose opening was missed. */
  @type("string") lastGoalDefenderSessionId = "";
  /** Most recent goal event: the scorer, or empty for neutral/own-goals. */
  @type("string") lastGoalScorerSessionId = "";
  /** Absolute epoch ms of the most recent goal event; 0 before any goal. */
  @type("number") lastGoalAt = 0;
  @type({ map: PongBallState }) balls = new MapSchema<PongBallState>();
  @type({ map: PongPlayerState }) players = new MapSchema<PongPlayerState>();
  @type(PongResultState) result: PongResultState | null = null;
}
