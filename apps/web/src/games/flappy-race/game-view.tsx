import { Alert, Box, Button, Chip, List, ListItem, Paper, Stack, Typography } from "@mui/material";
import {
  type FlappyRaceState,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { InvitePanel } from "../../components/invite-panel.js";
import type { RoomConnection } from "../../game-connection.js";
import { ArenaView } from "./arena-view.js";

export function FlappyRaceGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: FlappyRaceState;
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

  if (state.phase === "countdown" || state.phase === "running" || state.phase === "round-result") {
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
  state: FlappyRaceState;
  selfSessionId: string;
  roomError: string | null;
}) {
  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Flappy Race
        </Typography>
        <Typography color="text.secondary">
          Tap to flap through shared obstacle courses. Furthest bird wins each round; five rounds
          decide the match.
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="flappy-race-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="flappy-race-players-heading">
          Players ({state.players.size})
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.entries()]
            .sort(([, a], [, b]) => a.joinedOrder - b.joinedOrder)
            .map(([sessionId, player]) => (
              <ListItem key={sessionId} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ flex: 1, fontWeight: 600 }}>
                  {player.name}
                  {sessionId === selfSessionId ? " (you)" : ""}
                </Typography>
                {player.connectionStatus !== "connected" && (
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
          Waiting for everyone to join, then the next match starts automatically.
        </Typography>
      </Paper>

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
  state: FlappyRaceState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const result = state.result;
  const isHost = state.hostSessionId === selfSessionId;
  const winnerNames = result
    ? result.winnerSessionIds
        .map((sessionId) => state.players.get(sessionId)?.name)
        .filter((name): name is string => name !== undefined)
    : [];
  const headline = winnerNames.length === 1 ? `${winnerNames[0]} wins!` : "It's a tie!";

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Flappy Race
        </Typography>
        <Typography variant="h2" aria-live="polite">
          {headline}
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="flappy-race-leaderboard-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="flappy-race-leaderboard-heading">
          Final scoreboard
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="flappy-race-leaderboard">
          {result?.leaderboard.map((entry) => (
            <ListItem key={entry.sessionId} disableGutters sx={{ gap: 1 }}>
              <Typography sx={{ minWidth: 32, fontWeight: 800 }}>#{entry.rank}</Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography sx={{ fontWeight: 800 }}>
                {entry.primaryScore} win{entry.primaryScore === 1 ? "" : "s"}
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
