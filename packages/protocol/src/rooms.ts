import type { ISeatReservation } from "@colyseus/shared-types";
import { z } from "zod";
import { gameIdSchema, gameManifestSchema } from "./games.js";

/**
 * Wire message types shared by the server and the web client. The lobby and
 * every game room use these exact type names.
 */
export const ROOM_MESSAGE_TYPES = {
  selectGame: "select_game",
  startGame: "start_game",
  resumeTransition: "room:resume_transition",
  transition: "room:transition",
  playAgain: "play_again",
  error: "room:error",
} as const;

/**
 * Stable machine-readable room error codes. Clients branch on codes, never on
 * message prose. These are separate from the HTTP ERROR_CODES because they
 * travel over the Colyseus socket rather than the REST API.
 */
export const ROOM_ERROR_CODES = [
  "INVALID_REQUEST",
  "NOT_HOST",
  "NOT_ENOUGH_PLAYERS",
  "ROOM_FULL",
  "GAME_ALREADY_STARTED",
  "GAME_NOT_RUNNING",
  "PLAYER_NOT_IN_ROOM",
  "INVALID_GAME_COMMAND",
  "INTERNAL_ERROR",
] as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

export const roomErrorCodeSchema = z.enum(ROOM_ERROR_CODES);

export const roomErrorPayloadSchema = z.object({
  code: roomErrorCodeSchema,
  message: z.string().trim().min(1),
});

export type RoomErrorPayload = z.infer<typeof roomErrorPayloadSchema>;

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;

export const roomCodeSchema = z
  .string()
  .regex(
    new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`),
    "Room code must be 6 characters using the unambiguous alphabet",
  );

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export const playerNameSchema = z.string().trim().min(1).max(30);

export const createRoomRequestSchema = z.object({
  playerName: playerNameSchema,
});

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const joinRoomRequestSchema = z.object({
  playerName: playerNameSchema,
});

export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;

export const publicRoomSchema = z.object({
  code: roomCodeSchema,
  game: gameManifestSchema.nullable(),
});

export type PublicRoom = z.infer<typeof publicRoomSchema>;

const seatReservationFieldsSchema = z.object({
  name: z.string().min(1),
  sessionId: z.string().min(1),
  roomId: z.string().min(1),
  publicAddress: z.string().optional(),
  processId: z.string().optional(),
  reconnectionToken: z.string().optional(),
  devMode: z.boolean().optional(),
});

export const seatReservationSchema = z.custom<ISeatReservation>(
  (value) => seatReservationFieldsSchema.safeParse(value).success,
  { message: "Invalid seat reservation" },
);

export type SeatReservation = z.infer<typeof seatReservationSchema>;

export const createRoomResponseSchema = z.object({
  room: publicRoomSchema,
  reservation: seatReservationSchema,
});

export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;

export const joinRoomResponseSchema = createRoomResponseSchema;

export type JoinRoomResponse = z.infer<typeof joinRoomResponseSchema>;

export const roomOptionsSchema = z.object({
  roomCode: roomCodeSchema,
  creatorPlayerId: z.string().uuid(),
  playerId: z.string().uuid(),
  playerName: playerNameSchema,
  maxClients: z.number().int().min(1).max(32).optional(),
});

export type RoomOptions = z.infer<typeof roomOptionsSchema>;

export const seatOptionsSchema = z.object({
  playerId: z.string().uuid(),
  playerName: playerNameSchema,
});

export type SeatOptions = z.infer<typeof seatOptionsSchema>;

export const selectGameRequestSchema = z.object({
  gameId: gameIdSchema,
});

export type SelectGameRequest = z.infer<typeof selectGameRequestSchema>;

export const startGameRequestSchema = z.object({}).strict();

export type StartGameRequest = z.infer<typeof startGameRequestSchema>;

/**
 * Empty client acknowledgement sent after a lobby connection (including a
 * reconnection) has installed its message handlers. The server uses it to
 * resend an already-issued per-player game reservation without racing the
 * browser's reconnect promise.
 */
export const resumeTransitionRequestSchema = z.object({}).strict();

export type ResumeTransitionRequest = z.infer<typeof resumeTransitionRequestSchema>;

/**
 * Server-issued payload sent over the socket when a lobby hands its connected
 * players off to a registered game room. Each player receives their own seat
 * reservation for the new room.
 */
export const roomTransitionSchema = z
  .object({
    gameId: gameIdSchema,
    roomCode: roomCodeSchema,
    reservation: seatReservationSchema,
  })
  .strict();

export type RoomTransition = z.infer<typeof roomTransitionSchema>;
