import {
  type CreateRoomResponse,
  type JoinRoomResponse,
  normalizeRoomCode,
  type RoomOptions,
  type SeatOptions,
} from "@phone-party/protocol";
import { matchMaker } from "colyseus";

import { AppError } from "../errors.js";
import type { Logger } from "../logging.js";
import { attachDirectoryCleanup } from "./directory-cleanup.js";
import { LOBBY_ROOM_TYPE } from "./lobby-room.js";
import { isValidRoomCode } from "./room-code.js";
import type { RoomDirectory } from "./room-directory.js";

export type RoomServiceDeps = {
  readonly directory: RoomDirectory;
  readonly isShuttingDown: () => boolean;
  readonly lobbyMaxClients: number;
  readonly logger: Logger;
};

export type CreateRoomInput = {
  readonly playerId: string;
  readonly playerName: string;
};

export type JoinRoomInput = {
  readonly roomCode: string;
  readonly playerId: string;
  readonly playerName: string;
};

export class RoomService {
  constructor(private readonly deps: RoomServiceDeps) {}

  async createRoom(input: CreateRoomInput): Promise<CreateRoomResponse> {
    if (this.deps.isShuttingDown()) {
      throw new AppError("SERVER_SHUTTING_DOWN", 503, "The server is shutting down");
    }

    const code = this.deps.directory.reserveCode();
    let roomId: string | undefined;

    try {
      const options: RoomOptions = {
        roomCode: code,
        creatorPlayerId: input.playerId,
        playerId: input.playerId,
        playerName: input.playerName,
        maxClients: this.deps.lobbyMaxClients,
      };
      const reservation = await matchMaker.create(LOBBY_ROOM_TYPE, options);
      roomId = reservation.roomId;

      this.deps.directory.setEntry(code, { roomId: reservation.roomId, gameId: null });
      this.attachDisposeCleanup(reservation.roomId, code);

      return {
        room: { code, game: null },
        // Colyseus owns the reservation wire format. The protocol schema is only
        // used to validate it; the assertion is the boundary between Colyseus
        // types and the shared HTTP response type.
        reservation: reservation as CreateRoomResponse["reservation"],
      };
    } catch (error) {
      this.deps.directory.deleteByCode(code);
      if (roomId !== undefined) {
        const room = matchMaker.getLocalRoomById(roomId);
        if (room !== undefined) {
          await room.disconnect();
        }
      }
      this.deps.logger.error({ err: error, roomCode: code }, "room creation failed");
      throw this.mapCreateError(error);
    }
  }

  async joinRoom(input: JoinRoomInput): Promise<JoinRoomResponse> {
    const code = normalizeRoomCode(input.roomCode);
    if (!isValidRoomCode(code)) {
      throw new AppError("INVALID_REQUEST", 400, "Invalid room code");
    }

    const entry = this.deps.directory.getByCode(code);
    if (entry === undefined) {
      throw new AppError("ROOM_NOT_FOUND", 404, "Room not found");
    }

    try {
      const options: SeatOptions = {
        playerId: input.playerId,
        playerName: input.playerName,
      };
      const reservation = await matchMaker.joinById(entry.roomId, options);
      return {
        room: { code, game: null },
        reservation: reservation as JoinRoomResponse["reservation"],
      };
    } catch (error) {
      if (isFullRoomError(error)) {
        throw new AppError("ROOM_FULL", 409, "Room is full");
      }
      if (isLockedRoomError(error)) {
        // A lobby auto-locks at capacity; a locked game room refuses new
        // players entirely. The directory entry distinguishes the two.
        if (entry.gameId === null) {
          throw new AppError("ROOM_FULL", 409, "Room is full");
        }
        throw new AppError(
          "ROOM_NOT_JOINABLE",
          409,
          "This room cannot accept new players right now",
        );
      }
      if (isNotJoinableError(error)) {
        // The room still exists but cannot accept a new seat (for example a
        // game room that has already started). Keep the mapping so the code
        // continues to address the active room.
        throw new AppError(
          "ROOM_NOT_JOINABLE",
          409,
          "This room cannot accept new players right now",
        );
      }
      // In a single process, any other joinById failure means the room is gone
      // or unreachable; drop the stale mapping so the code can be reused.
      this.deps.directory.deleteByCode(code);
      throw new AppError("ROOM_EXPIRED", 404, "Room no longer exists");
    }
  }

  private attachDisposeCleanup(roomId: string, code: string): void {
    const room = matchMaker.getLocalRoomById(roomId);
    if (room === undefined) {
      return;
    }
    attachDirectoryCleanup(room, this.deps.directory, code);
  }

  private mapCreateError(error: unknown): AppError {
    if (isFullRoomError(error)) {
      return new AppError("ROOM_FULL", 409, "Room is full");
    }
    return new AppError("INTERNAL_ERROR", 500, "Could not create the room");
  }
}

function isFullRoomError(error: unknown): boolean {
  // Colyseus does not export SeatReservationError from its public index.
  // A full room surfaces as "already full"; a locked game room surfaces as
  // "is locked" and maps to ROOM_NOT_JOINABLE instead.
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("already full")
  );
}

function isLockedRoomError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("is locked")
  );
}

function isNotJoinableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("not joinable")
  );
}
