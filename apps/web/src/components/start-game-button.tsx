import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import type { LobbyRoomState } from "@phone-party/protocol";
import { ROOM_MESSAGE_TYPES, roomErrorPayloadSchema } from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import type { RoomConnection } from "../game-connection.js";

/**
 * Host-only start control for the platform lobby. It sends the transition
 * intent; the lobby room validates host, selected game and player count and
 * hands every connected client a game-room reservation.
 */
export function StartGameButton({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: LobbyRoomState;
  selfSessionId: string;
}) {
  const isHost = state.hostSessionId === selfSessionId;
  const hasGame = state.gameId !== "";
  const canStart = isHost && hasGame && state.players.size >= 2;
  const [startError, setStartError] = useState<string | null>(null);
  const gameRef = useRef(state.gameId);

  if (gameRef.current !== state.gameId) {
    gameRef.current = state.gameId;
    setStartError(null);
  }

  useEffect(() => {
    const off = connection.room.onMessage(ROOM_MESSAGE_TYPES.error, (payload) => {
      const parsed = roomErrorPayloadSchema.safeParse(payload);
      if (parsed.success) {
        setStartError(parsed.data.message);
      }
    });
    return () => off?.();
  }, [connection.room]);

  return (
    <Paper sx={{ p: 2.25 }}>
      <Stack spacing={1.5}>
        {startError !== null && <Alert severity="error">{startError}</Alert>}
        <Button
          type="button"
          fullWidth
          disabled={!canStart}
          onClick={() => connection.room.send(ROOM_MESSAGE_TYPES.startGame, {})}
        >
          {isHost
            ? canStart
              ? "Start game"
              : hasGame
                ? "Waiting for more players…"
                : "Choose a game first"
            : "Waiting for the host…"}
        </Button>
        <Typography color="text.secondary">
          {hasGame
            ? "Starting moves everyone into the game room."
            : "The host chooses a game from the catalogue, then starts."}
        </Typography>
      </Stack>
    </Paper>
  );
}
