import { Alert, Paper, Stack, Typography } from "@mui/material";
import type { LobbyRoomState } from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { apiErrorMessage } from "../api.js";
import type { RoomConnection } from "../game-connection.js";
import { useGamesQuery } from "../queries/games.js";
import { GameSelectForm } from "./game-select-form.js";

/**
 * Host-only game selection for the platform lobby, connected to the game
 * catalogue query and the lobby room. Non-hosts see the selected game (or a
 * waiting message); selection itself is an intent message validated by the
 * authoritative lobby room.
 */
export function GameSelect({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: LobbyRoomState;
  selfSessionId: string;
}) {
  const gamesQuery = useGamesQuery();
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const errorListenerRef = useRef<((code: number, message?: string) => void) | null>(null);
  const isHost = state.hostSessionId === selfSessionId;

  useEffect(() => {
    return () => {
      if (errorListenerRef.current !== null) {
        connection.room.onError.remove(errorListenerRef.current);
      }
    };
  }, [connection.room]);

  if (gamesQuery.isPending) {
    return (
      <Paper component="section" aria-labelledby="game-select-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="game-select-heading">
          Game
        </Typography>
        <Typography color="text.secondary">Loading games…</Typography>
      </Paper>
    );
  }
  if (gamesQuery.isError) {
    return (
      <Paper component="section" aria-labelledby="game-select-heading" sx={{ p: 2.25 }}>
        <Stack spacing={1.5}>
          <Typography component="h2" variant="h2" id="game-select-heading">
            Game
          </Typography>
          <Alert severity="error">
            {apiErrorMessage(gamesQuery.error, "Could not load the game catalogue")}
          </Alert>
        </Stack>
      </Paper>
    );
  }

  const selectGame = (gameId: string): void => {
    setSelectionError(null);
    if (errorListenerRef.current !== null) {
      connection.room.onError.remove(errorListenerRef.current);
    }
    const listener = (_code: number, message?: string): void => {
      setSelectionError(String(message));
    };
    errorListenerRef.current = listener;
    connection.room.onError.once(listener);
    connection.room.send("select_game", { gameId });
  };

  return (
    <>
      <GameSelectForm
        games={gamesQuery.data.games}
        selectedGameId={state.gameId}
        isHost={isHost}
        onSelect={selectGame}
      />
      {selectionError !== null && <Alert severity="error">{selectionError}</Alert>}
    </>
  );
}
