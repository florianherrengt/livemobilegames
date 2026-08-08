import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { z } from "zod";

export const LIVE_DRAWING_GUESSING_GAME_ID = "live-drawing-guessing";

// --- Phases ---

export const liveDrawingGuessingPhaseSchema = z.enum([
  "lobby",
  "preparing",
  "drawing",
  "result",
  "round-summary",
  "finished",
]);

export type LiveDrawingGuessingPhase = z.infer<typeof liveDrawingGuessingPhaseSchema>;

export const liveDrawingTurnOutcomeSchema = z.enum(["solved", "timeout", "skipped", "no-guessers"]);

export type LiveDrawingTurnOutcome = z.infer<typeof liveDrawingTurnOutcomeSchema>;

// --- Shared constants ---

/**
 * Shared Live Drawing and Guessing constants. The server uses these values for
 * turn timing, drawing limits, and scoring; the web client uses the palette,
 * canvas geometry, and message names so strokes and controls match the
 * authoritative contract.
 */
export const LIVE_DRAWING_GUESSING_CONSTANTS = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  MAX_SPECTATORS: 8,
  TOTAL_ROUNDS: 3,
  PREPARATION_MS: 3_000,
  TURN_DURATION_MS: 60_000,
  RESULT_MS: 3_000,
  ROUND_SUMMARY_MS: 3_000,
  DRAWER_DISCONNECT_HOLD_MS: 5_000,
  /** Drawings use a normalized 0..1000 coordinate space on every phone. */
  CANVAS_SIZE: 1_000,
  /** Normalized brush width (1% of the canvas width). */
  BRUSH_WIDTH: 10,
  /** One fixed palette, black by default. */
  PALETTE: [
    "#000000",
    "#e02424",
    "#1f6feb",
    "#22a34a",
    "#f4c20d",
    "#ef7d1a",
    "#8b3fb0",
    "#6b4a2f",
  ] as const,
  /** Maximum point coordinates accepted in one stroke message. */
  MAX_POINT_COORDINATES_PER_MESSAGE: 200,
  /** Maximum points (x,y pairs) in one logical stroke. */
  MAX_POINTS_PER_STROKE: 2_000,
  /** Maximum synchronized points retained across all strokes in one turn. */
  MAX_POINTS_PER_TURN: 10_000,
  /** Maximum simultaneous strokes drawn during one turn (anti-abuse bound). */
  MAX_STROKES_PER_TURN: 1_000,
  /** Flood protection; not a gameplay cooldown. */
  MAX_STROKE_MESSAGES_PER_SECOND: 30,
  MAX_GUESSES_PER_SECOND: 30,
} as const;

export type LiveDrawingGuessingConstants = typeof LIVE_DRAWING_GUESSING_CONSTANTS;

// --- Client commands ---

export const liveDrawingStrokeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid stroke id");

export const liveDrawingPointsSchema = z
  .array(z.number().finite().min(0).max(LIVE_DRAWING_GUESSING_CONSTANTS.CANVAS_SIZE))
  .min(2)
  .max(LIVE_DRAWING_GUESSING_CONSTANTS.MAX_POINT_COORDINATES_PER_MESSAGE)
  .refine((points) => points.length % 2 === 0, "Points must be x,y pairs");

export const liveDrawingStrokeSchema = z
  .object({
    type: z.literal("stroke"),
    strokeId: liveDrawingStrokeIdSchema,
    color: z.enum(LIVE_DRAWING_GUESSING_CONSTANTS.PALETTE),
    points: liveDrawingPointsSchema,
    /** True when the drawer lifted their finger and this stroke is complete. */
    complete: z.boolean().optional(),
  })
  .strict();

export type LiveDrawingStroke = z.infer<typeof liveDrawingStrokeSchema>;

export const liveDrawingUndoSchema = z.object({ type: z.literal("undo") }).strict();

export type LiveDrawingUndo = z.infer<typeof liveDrawingUndoSchema>;

export const liveDrawingGuessSchema = z
  .object({
    type: z.literal("guess"),
    text: z.string().trim().min(1).max(80),
  })
  .strict();

export type LiveDrawingGuess = z.infer<typeof liveDrawingGuessSchema>;

export const liveDrawingCommandSchema = z.discriminatedUnion("type", [
  liveDrawingStrokeSchema,
  liveDrawingUndoSchema,
  liveDrawingGuessSchema,
]);

export type LiveDrawingCommand = z.infer<typeof liveDrawingCommandSchema>;

// --- Server-to-client messages ---

export const liveDrawingGuessFeedbackKindSchema = z.enum([
  "incorrect",
  "not-active",
  "not-guesser",
  "invalid",
]);

export type LiveDrawingGuessFeedbackKind = z.infer<typeof liveDrawingGuessFeedbackKindSchema>;

/**
 * Private guess feedback sent only to the guesser who submitted the guess.
 * Correct guesses are never acknowledged privately: the turn ends immediately
 * and the shared result screen reveals the winner.
 */
export const liveDrawingGuessFeedbackSchema = z
  .object({
    kind: liveDrawingGuessFeedbackKindSchema,
  })
  .strict();

export type LiveDrawingGuessFeedback = z.infer<typeof liveDrawingGuessFeedbackSchema>;

/** Private word briefing sent only to the current drawer at turn start. */
export const liveDrawingDrawerBriefingSchema = z
  .object({
    word: z.string().trim().min(1).max(40),
    category: z.string().trim().min(1).max(30),
    turnNumber: z.number().int().min(1),
    roundNumber: z.number().int().min(1),
    letterCount: z.number().int().min(1),
  })
  .strict();

export type LiveDrawingDrawerBriefing = z.infer<typeof liveDrawingDrawerBriefingSchema>;

/** Empty intent the current drawer sends to request their private word. */
export const liveDrawingDrawerRequestSchema = z.object({}).strict();

export type LiveDrawingDrawerRequest = z.infer<typeof liveDrawingDrawerRequestSchema>;

export const LIVE_DRAWING_GUESSING_MESSAGE_TYPES = {
  stroke: "game:stroke",
  undo: "game:undo",
  guess: "game:guess",
  guessFeedback: "guess:feedback",
  drawerBriefing: "drawer:briefing",
  drawerRequest: "drawer:request",
} as const;

// --- Synchronized Colyseus state ---

/**
 * One logical drawing stroke. Points are a flat [x0,y0,x1,y1,...] array in the
 * shared 0..1000 canvas space. The synchronized array grows live while the
 * drawer draws and shrinks when the drawer undoes a completed stroke.
 */
export class LiveDrawingStrokeState extends Schema {
  @type("string") strokeId = "";
  @type("string") color = "";
  @type("boolean") complete = false;
  @type(["number"]) points = new ArraySchema<number>();
}

export class LiveDrawingPlayerState extends Schema {
  @type("string") playerId = "";
  /** Current (or last known) Colyseus session id for this participant. */
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("boolean") isHost = false;
  @type("string") connectionStatus: "connected" | "reconnecting" | "disconnected" = "connected";
  @type("number") joinedOrder = 0;
  @type("number") score = 0;
  /** True for players who joined after the current match began. */
  @type("boolean") isSpectator = false;
}

/** Public outcome of the most recently completed turn. */
export class LiveDrawingTurnResultState extends Schema {
  @type("string") word = "";
  @type("string") category = "";
  @type("string") outcome: LiveDrawingTurnOutcome = "timeout";
  @type("string") drawerPlayerId = "";
  @type("string") winnerPlayerId = "";
}

export class LiveDrawingLeaderboardEntryState extends Schema {
  @type("string") playerId = "";
  @type("number") rank = 0;
  @type("number") score = 0;
  @type("string") label = "";
}

/** Final match result, synchronized while the room is finished. */
export class LiveDrawingResultState extends Schema {
  @type(["string"]) winnerPlayerIds = new ArraySchema<string>();
  @type([LiveDrawingLeaderboardEntryState]) leaderboard =
    new ArraySchema<LiveDrawingLeaderboardEntryState>();
}

/**
 * Synchronized Live Drawing and Guessing room state.
 *
 * The current word is never exposed: guessers see only the category and a
 * progressive letter pattern, while the drawer receives the full answer in a
 * private drawer:briefing message. The complete answer becomes public only
 * through `lastResult` after the turn ends.
 */
export class LiveDrawingGuessingState extends Schema {
  @type("string") roomCode = "";
  @type("string") gameId = "";
  @type("string") hostSessionId = "";
  @type("string") phase: LiveDrawingGuessingPhase = "lobby";
  @type("number") roundNumber = 0;
  @type("number") totalRounds = 0;
  @type("number") turnNumber = 0;
  @type("number") totalTurns = 0;
  @type("string") drawerPlayerId = "";
  /** Category of the current word; hidden until the drawing phase begins. */
  @type("string") wordCategory = "";
  /** Letter pattern: letters, underscores, spaces, and punctuation. */
  @type(["string"]) letterPattern = new ArraySchema<string>();
  /** Absolute epoch ms when the preparation countdown ends. */
  @type("number") prepareEndsAt = 0;
  /** Absolute epoch ms when the drawing timer ends. */
  @type("number") drawingEndsAt = 0;
  /** Absolute epoch ms when the result screen advances. */
  @type("number") resultEndsAt = 0;
  /** Absolute epoch ms when the round summary advances. */
  @type("number") roundSummaryEndsAt = 0;
  @type([LiveDrawingStrokeState]) strokes = new ArraySchema<LiveDrawingStrokeState>();
  /** Most recently completed turn, revealed once the turn ends. */
  @type(LiveDrawingTurnResultState) lastResult: LiveDrawingTurnResultState | null = null;
  /** Final match result while the room is finished. Null until then. */
  @type(LiveDrawingResultState) result: LiveDrawingResultState | null = null;
  @type({ map: LiveDrawingPlayerState }) players = new MapSchema<LiveDrawingPlayerState>();
}
