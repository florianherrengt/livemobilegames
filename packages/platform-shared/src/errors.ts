export const PROTOCOL_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_NOT_JOINABLE",
  "PLAYER_NOT_IN_ROOM",
  "NOT_HOST",
  "PLAYERS_NOT_READY",
  "NOT_ENOUGH_PLAYERS",
  "GAME_ALREADY_STARTED",
  "GAME_NOT_RUNNING",
  "UNKNOWN_GAME",
  "INVALID_GAME_COMMAND",
  "RATE_LIMITED",
  "REQUEST_TIMEOUT",
  "INTERNAL_ERROR",
] as const;

export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export const PROTOCOL_OPERATIONS = [
  "room.create",
  "room.join",
  "room.set-ready",
  "room.start",
  "room.play-again",
  "game.command",
  "time-sync",
  "room.internal",
] as const;

export type PlatformOperation = (typeof PROTOCOL_OPERATIONS)[number];

export interface PlatformErrorPayload {
  operation: PlatformOperation;
  requestId?: string | undefined;
  error: ProtocolError;
}

export type CommandResult = { ok: true; data?: unknown } | { ok: false; error: ProtocolError };

export type CommandResultPayload =
  | { requestId: string; operation: PlatformOperation; ok: true; data?: unknown }
  | {
      requestId: string;
      operation: PlatformOperation;
      ok: false;
      error: ProtocolError;
    };

export function protocolError(
  code: ProtocolErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ProtocolError {
  return details === undefined ? { code, message } : { code, message, details };
}
