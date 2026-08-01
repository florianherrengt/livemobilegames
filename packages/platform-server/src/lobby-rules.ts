import type {
  ConnectionStatus,
  GameConfig,
  ProtocolError,
  RoomStatus,
} from "@falling-platforms/platform-shared";
import { protocolError } from "@falling-platforms/platform-shared";

export interface LobbyPlayerLike {
  sessionId: string;
  connectionStatus: ConnectionStatus;
  isReady: boolean;
  joinedOrder: number;
}

export function selectHost(players: readonly LobbyPlayerLike[]): string | null {
  const connected = players
    .filter((player) => player.connectionStatus === "connected")
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
  if (connected.length > 0) {
    return connected[0]?.sessionId ?? null;
  }
  const remaining = [...players].sort((a, b) => a.joinedOrder - b.joinedOrder);
  return remaining[0]?.sessionId ?? null;
}

export function startCommandError(
  config: GameConfig,
  status: RoomStatus,
  actorSessionId: string,
  hostSessionId: string,
  players: readonly LobbyPlayerLike[],
): ProtocolError | null {
  if (actorSessionId !== hostSessionId) {
    return protocolError("NOT_HOST", "Only the host can start the game");
  }
  if (status !== "lobby") {
    return protocolError("GAME_ALREADY_STARTED", "The game is not in the lobby");
  }
  const connected = players.filter((player) => player.connectionStatus === "connected");
  if (connected.length < config.minPlayers) {
    return protocolError(
      "NOT_ENOUGH_PLAYERS",
      `At least ${config.minPlayers} connected players are required`,
    );
  }
  if (config.requiresReady && players.some((player) => !player.isReady)) {
    return protocolError("PLAYERS_NOT_READY", "All players must be ready before starting");
  }
  return null;
}
