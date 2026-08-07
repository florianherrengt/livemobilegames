import { Alert, Box, Button, Chip, List, ListItem, Paper, Stack, Typography } from "@mui/material";
import {
  type CoinRushState,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { InvitePanel } from "../../components/invite-panel.js";
import type { RoomConnection } from "../../game-connection.js";
import { ArenaView } from "./arena-view.js";

export function CoinRushGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: CoinRushState;
  selfSessionId: string;
}) {
  const [roomError, setRoomError] = useState<string | null>(null);
  const phaseRef = useRef(state.phase);

  if (phaseRef.current !== state.phase) {
    phaseRef.current = state.phase;
    setRoomError(null);
  }

  useEffect(() => {
    const off = connection.room.onMessage(ROOM_MESSAGE_TYPES.error, (payload) => {
      const parsed = roomErrorPayloadSchema.safeParse(payload);
      if (parsed.success) {
        setRoomError(parsed.data.message);
      }
    });
    return off;
  }, [connection.room]);

  if (state.phase === "countdown" || state.phase === "playing" || state.phase === "round-result") {
    return (
      <ArenaView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  if (state.phase === "finished") {
    return (
      <FinishedView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  return (
    <LobbyView
      connection={connection}
      state={state}
      selfSessionId={selfSessionId}
      roomError={roomError}
    />
  );
}

function LobbyView({
  connection,
  state,
  selfSessionId,
  roomError,
}: {
  connection: RoomConnection;
  state: CoinRushState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const isHost = state.hostSessionId === selfSessionId;
  const hasPlayed = state.roundNumber > 0;

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Coin Rush
        </Typography>
        <Typography color="text.secondary">
          Swipe across shared roads, grab coins, and push rivals. First to ten points wins each
          round; three rounds decide the match.
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="coin-rush-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="coin-rush-players-heading">
          Players ({state.players.size})
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.entries()]
            .sort(([, a], [, b]) => a.joinedOrder - b.joinedOrder)
            .map(([sessionId, player]) => (
              <ListItem key={sessionId} disableGutters sx={{ gap: 1 }}>
                <Box
                  aria-hidden
                  sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: player.color }}
                />
                <Typography sx={{ flex: 1, fontWeight: 600 }}>
                  {player.name}
                  {sessionId === selfSessionId ? " (you)" : ""}
                </Typography>
                {!player.connected && (
                  <Chip label="reconnecting" size="small" color="warning" variant="outlined" />
                )}
              </ListItem>
            ))}
        </List>
      </Paper>

      <InvitePanel code={state.roomCode} />

      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      <Paper sx={{ p: 2.25 }}>
        <Typography color="text.secondary" aria-live="polite">
          {isHost
            ? hasPlayed
              ? "The match is over. Press Play again when everyone is ready."
              : "Waiting for everyone to join, then the first round starts automatically."
            : hasPlayed
              ? "The match is over. Waiting for the host to play again."
              : "Waiting for everyone to join…"}
        </Typography>
      </Paper>

      {isHost && hasPlayed && (
        <Button
          type="button"
          fullWidth
          onClick={() => connection.room.send(ROOM_MESSAGE_TYPES.playAgain, {})}
        >
          Play again
        </Button>
      )}

      <Button
        type="button"
        variant="outlined"
        color="error"
        fullWidth
        onClick={() => connection.leave()}
      >
        Leave room
      </Button>
    </Stack>
  );
}

function FinishedView({
  connection,
  state,
  selfSessionId,
  roomError,
}: {
  connection: RoomConnection;
  state: CoinRushState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const result = state.result;
  const isHost = state.hostSessionId === selfSessionId;
  const winnerNames = result
    ? [...result.winnerSessionIds]
        .map((sessionId) => state.players.get(sessionId)?.name)
        .filter((name): name is string => name !== undefined)
    : [];
  const headline = winnerNames.length === 1 ? `${winnerNames[0]} wins!` : "It's a tie!";

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Coin Rush
        </Typography>
        <Typography variant="h2" aria-live="polite">
          {headline}
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="coin-rush-leaderboard-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="coin-rush-leaderboard-heading">
          Final scoreboard
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="coin-rush-leaderboard">
          {result?.leaderboard.map((entry) => (
            <ListItem key={entry.sessionId} disableGutters sx={{ gap: 1 }}>
              <Typography sx={{ minWidth: 32, fontWeight: 800 }}>#{entry.rank}</Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                {entry.roundWins} win{entry.roundWins === 1 ? "" : "s"} · {entry.totalCoins} coins ·{" "}
                {entry.deaths} death{entry.deaths === 1 ? "" : "s"}
              </Typography>
            </ListItem>
          ))}
        </List>
      </Paper>

      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      {isHost ? (
        <Button
          type="button"
          fullWidth
          onClick={() => connection.room.send(ROOM_MESSAGE_TYPES.playAgain, {})}
        >
          Play again
        </Button>
      ) : (
        <Paper sx={{ p: 2.25 }}>
          <Typography color="text.secondary" aria-live="polite">
            Waiting for the host to play again…
          </Typography>
        </Paper>
      )}

      <Button
        type="button"
        variant="outlined"
        color="error"
        fullWidth
        onClick={() => connection.leave()}
      >
        Leave room
      </Button>
    </Stack>
  );
}
