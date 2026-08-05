import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const CAPITAL_PIN_GAME_ID = "capital-pin";

// --- Phases ---

export const capitalPinPhaseSchema = z.enum(["lobby", "round", "round-results", "finished"]);

export type CapitalPinPhase = z.infer<typeof capitalPinPhaseSchema>;

// --- Client commands ---

/**
 * The only Capital Pin game command: lock a guess for the active round.
 * Coordinates are the player's intent; the server validates them again before
 * any distance math and derives the actor from the connected client.
 *
 * The payload is strict so unknown fields cannot smuggle extra intent into the
 * room boundary.
 */
export const capitalPinSubmitSchema = z
  .object({
    type: z.literal("submit"),
    roundNumber: z.number().int().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

export type CapitalPinSubmit = z.infer<typeof capitalPinSubmitSchema>;

export const capitalPinCommandSchema = z.discriminatedUnion("type", [capitalPinSubmitSchema]);

export type CapitalPinCommand = z.infer<typeof capitalPinCommandSchema>;

export const GAME_MESSAGE_TYPES = {
  submit: "game:submit",
} as const;

/**
 * Format a guess distance for display: under 10 km one decimal place, 10 km or
 * more the nearest whole kilometre. Shared by the server's score labels and
 * the results list so both sides render identical text.
 */
export function formatDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm)) {
    return "—";
  }
  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`;
  }
  return `${Math.round(distanceKm).toLocaleString("en-US")} km`;
}

// --- Synchronized Colyseus state ---

/**
 * One player's standing in a finished round. Only synchronized after the round
 * ends; the active round never reveals guesses or coordinates.
 */
export class GuessResultState extends Schema {
  @type("string") sessionId = "";
  @type("string") displayName = "";
  @type("number") latitude = 0;
  @type("number") longitude = 0;
  @type("number") distanceKm = 0;
  @type("boolean") isWinner = false;
}

/** The result of a finished round: the capital and every revealed guess. */
export class RoundResultState extends Schema {
  @type("number") roundNumber = 0;
  @type("string") capitalName = "";
  @type("string") country = "";
  @type("number") correctLatitude = 0;
  @type("number") correctLongitude = 0;
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([GuessResultState]) guesses = new ArraySchema<GuessResultState>();
}

export class LeaderboardEntryState extends Schema {
  @type("string") sessionId = "";
  @type("number") rank = 0;
  @type("number") primaryScore = 0;
  @type("string") label = "";
}

/** The final match result, synchronized while the room is finished. */
export class CapitalPinResultState extends Schema {
  @type(["string"]) winnerSessionIds = new ArraySchema<string>();
  @type([LeaderboardEntryState]) leaderboard = new ArraySchema<LeaderboardEntryState>();
  @type("number") finishedAt = 0;
}

export class CapitalPinPlayerState extends Schema {
  @type("string") playerId = "";
  @type("string") name = "";
  @type("boolean") isHost = false;
  @type("string") connectionStatus: "connected" | "reconnecting" | "disconnected" = "connected";
  @type("number") roundWins = 0;
  @type("number") totalDistanceKm = 0;
  @type("boolean") submitted = false;
}

/**
 * Synchronized Capital Pin room state.
 *
 * The active round exposes only the capital name and who has submitted. The
 * coordinates, country, and every guess stay server-only and are revealed
 * through `lastResult` only after the round ends. This is the structural
 * data-leak guarantee.
 */
export class CapitalPinState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: CapitalPinPhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  /** Absolute epoch ms when the active round ends. 0 when not in a round. */
  @type("number") roundEndsAt = 0;
  /** Absolute epoch ms when the results screen advances. 0 unless in round-results. */
  @type("number") resultsEndsAt = 0;
  /** Capital name for the active round. "" outside a round. */
  @type("string") currentCapitalName = "";
  /** Most recently completed round, revealed once it ends. Null until then. */
  @type(RoundResultState) lastResult: RoundResultState | null = null;
  /** Final match result while the room is finished. Null until then. */
  @type(CapitalPinResultState) result: CapitalPinResultState | null = null;
  @type({ map: CapitalPinPlayerState }) players = new MapSchema<CapitalPinPlayerState>();
}
