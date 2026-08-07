import type { Client, Room } from "@colyseus/sdk";
import {
  CapitalPinState,
  CoinRushState,
  FallingPlatformsState,
  FlappyRaceState,
  GolfRaceState,
  type ISeatReservation,
  KartRacingState,
  LiveDrawingGuessingState,
  LobbyRoomState,
  MemoryPathState,
  PongState,
  ROOM_MESSAGE_TYPES,
  roomTransitionSchema,
} from "@phone-party/protocol";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createColyseusClient } from "./multiplayer.js";

export type RoomState =
  | LobbyRoomState
  | CapitalPinState
  | CoinRushState
  | FallingPlatformsState
  | FlappyRaceState
  | GolfRaceState
  | KartRacingState
  | LiveDrawingGuessingState
  | MemoryPathState
  | PongState;
type RoomStateSchema = new () => RoomState;

/**
 * Trusted per-game state schema map. A room transition is consumed with the
 * schema of the game named by the server; unknown game ids are rejected.
 */
const gameStateSchemas: Record<string, RoomStateSchema> = {
  "capital-pin": CapitalPinState,
  "coin-rush": CoinRushState,
  "falling-platforms": FallingPlatformsState,
  "flappy-race": FlappyRaceState,
  golf: GolfRaceState,
  "kart-racing": KartRacingState,
  "live-drawing-guessing": LiveDrawingGuessingState,
  "memory-path": MemoryPathState,
  pong: PongState,
};

/**
 * Room types that a browser can join directly through the HTTP reservation
 * flow. The platform lobby is the default; the Live Drawing room unlocks
 * mid-match so late joiners can spectate.
 */
const roomTypeStateSchemas: Record<string, RoomStateSchema> = {
  __platform_lobby: LobbyRoomState,
  "live-drawing-guessing-room": LiveDrawingGuessingState,
  "memory-path-room": MemoryPathState,
};

export type RoomConnection = {
  readonly code: string;
  readonly room: Room<unknown, RoomState>;
  readonly client: Client;
  readonly reconnecting: boolean;
  leave: () => void;
};

const RoomConnectionContext = createContext<{
  connection: RoomConnection | null;
  connect: (code: string, reservation: ISeatReservation) => Promise<void>;
} | null>(null);

/**
 * Owns the single live Colyseus room on the page. When the platform lobby
 * hands players off to a game room, it consumes the server-issued seat
 * reservation, leaves the lobby and replaces the room reference without
 * creating a second live connection.
 */
export function RoomConnectionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const [stateVersion, setStateVersion] = useState(0);
  const roomRef = useRef<Room<unknown, RoomState> | null>(null);
  const clientRef = useRef<Client | null>(null);
  const stateSchemaRef = useRef<RoomStateSchema>(LobbyRoomState);
  const intentionalLeaveRef = useRef(false);
  const disposedRef = useRef(false);

  const leave = useCallback(() => {
    intentionalLeaveRef.current = true;
    roomRef.current?.leave();
    roomRef.current = null;
    clientRef.current = null;
    setConnection(null);
    intentionalLeaveRef.current = false;
  }, []);

  const attachRoom = useCallback(
    (room: Room<unknown, RoomState>, client: Client, code: string) => {
      room.onStateChange(() => setStateVersion((version) => version + 1));
      room.onMessage("*", (messageType, payload) => {
        if (messageType !== ROOM_MESSAGE_TYPES.transition) {
          return;
        }
        void transitionToGameRoom(payload).catch(() => {
          // A failed handoff leaves the stale connection honest: clear it so
          // the UI shows a recoverable disconnected state.
          roomRef.current = null;
          setConnection(null);
        });
      });
      room.onLeave.once(async () => {
        // A stale leave callback from a replaced room must never touch the
        // current connection: an intentional leave or a faster rejoin clears
        // roomRef before the old room's leave confirmation arrives.
        if (roomRef.current !== room) {
          return;
        }
        if (intentionalLeaveRef.current || disposedRef.current) {
          return;
        }
        const token = room.reconnectionToken;
        if (token === undefined) {
          roomRef.current = null;
          setConnection(null);
          return;
        }
        setConnection((current) => (current === null ? null : { ...current, reconnecting: true }));
        try {
          const reconnected = await client.reconnect(token, stateSchemaRef.current);
          const nextRoom = reconnected as Room<unknown, RoomState>;
          roomRef.current = nextRoom;
          setConnection({
            code,
            room: nextRoom,
            client,
            reconnecting: false,
            leave,
          });
          attachRoom(nextRoom, client, code);
        } catch {
          if (roomRef.current !== room) {
            return;
          }
          roomRef.current = null;
          setConnection(null);
        }
      });

      const transitionToGameRoom = async (payload: unknown): Promise<void> => {
        const parsed = roomTransitionSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("Malformed room transition payload");
        }
        const StateClass = gameStateSchemas[parsed.data.gameId];
        if (StateClass === undefined) {
          throw new Error("Unsupported game transition");
        }
        let nextRoom: Room<unknown, RoomState> | null = null;
        try {
          nextRoom = (await client.consumeSeatReservation(
            parsed.data.reservation,
            StateClass,
          )) as unknown as Room<unknown, RoomState>;
          if (disposedRef.current) {
            await nextRoom.leave();
            return;
          }
          // Suppress the lobby's leave handler so it does not try to reconnect.
          intentionalLeaveRef.current = true;
          try {
            await roomRef.current?.leave();
          } finally {
            intentionalLeaveRef.current = false;
          }
          roomRef.current = nextRoom;
          stateSchemaRef.current = StateClass;
          setConnection({
            code: parsed.data.roomCode,
            room: nextRoom,
            client,
            reconnecting: false,
            leave,
          });
          attachRoom(nextRoom, client, parsed.data.roomCode);
        } catch (error) {
          // A failed handoff must not leak the freshly connected game room.
          if (nextRoom !== null) {
            void nextRoom.leave();
          }
          throw error;
        }
      };
    },
    [leave],
  );

  const connect = useCallback(
    async (code: string, reservation: ISeatReservation) => {
      intentionalLeaveRef.current = true;
      try {
        roomRef.current?.leave();
      } finally {
        intentionalLeaveRef.current = false;
      }
      roomRef.current = null;
      clientRef.current = null;
      const client = createColyseusClient();
      const StateClass = roomTypeStateSchemas[reservation.name];
      if (StateClass === undefined) {
        throw new Error("Unsupported room reservation");
      }
      const room = (await client.consumeSeatReservation(
        reservation,
        StateClass,
      )) as unknown as Room<unknown, RoomState>;
      // If the provider unmounted while the reservation was being consumed,
      // do not leak the newly connected room.
      if (disposedRef.current) {
        await room.leave();
        return;
      }
      roomRef.current = room;
      clientRef.current = client;
      stateSchemaRef.current = StateClass;
      setConnection({
        code,
        room,
        client,
        reconnecting: false,
        leave,
      });
      attachRoom(room, client, code);
    },
    [attachRoom, leave],
  );

  useEffect(() => {
    // StrictMode mounts, cleans up, and remounts in development. Reset the
    // disposed flag on every real mount so a simulated unmount cannot leak
    // into a later connect() call.
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      intentionalLeaveRef.current = true;
      roomRef.current?.leave();
    };
  }, []);

  const value = useMemo(
    () => ({ connection, connect, stateVersion }),
    [connection, connect, stateVersion],
  );

  return <RoomConnectionContext.Provider value={value}>{children}</RoomConnectionContext.Provider>;
}

export function useRoomConnection() {
  const value = useContext(RoomConnectionContext);
  if (value === null) {
    return {
      connection: null,
      connect: async () => {
        throw new Error("RoomConnectionProvider is missing");
      },
    };
  }
  return value;
}
