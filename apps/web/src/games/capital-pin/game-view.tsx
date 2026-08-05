import { Alert, Box, Button, Chip, List, ListItem, Paper, Stack, Typography } from "@mui/material";
import {
  type CapitalPinState,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { InvitePanel } from "../../components/invite-panel.js";
import type { RoomConnection } from "../../game-connection.js";
import { ResultsView } from "./results-view.js";
import { RoundView } from "./round-view.js";

export function CapitalPinGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: CapitalPinState;
  selfSessionId: string;
}) {
  const [roomError, setRoomError] = useState<string | null>(null);
  const phaseRef = useRef(state.phase);

  // Clear stale room errors whenever the phase changes.
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

  if (state.phase === "round") {
    return (
      <RoundView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  if (state.phase === "round-results") {
    return <ResultsView state={state} selfSessionId={selfSessionId} />;
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
  state: CapitalPinState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const isHost = state.hostSessionId === selfSessionId;

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Capital Pin
        </Typography>
        <Typography color="text.secondary">
          Drop your pin where you think each capital city is. Closest guess wins the round.
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="capital-pin-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="capital-pin-players-heading">
          Players ({state.players.size})
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.values()].map((player) => (
            <ListItem key={player.playerId} disableGutters sx={{ gap: 1 }}>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{player.name}</Typography>
              {player.isHost && <Chip label="host" size="small" variant="outlined" />}
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
        <Typography color="text.secondary">
          {isHost
            ? "Waiting for everyone to join, then the first round starts automatically."
            : "Waiting for everyone to join…"}
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
  state: CapitalPinState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const isHost = state.hostSessionId === selfSessionId;
  const leaderboard = state.result?.leaderboard ?? [];

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Game over
        </Typography>
        <Typography component="h2" variant="h2" color="text.secondary">
          Final standings
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="capital-pin-leaderboard-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="capital-pin-leaderboard-heading" sx={{ mt: 0 }}>
          Leaderboard
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {leaderboard.map((entry) => (
            <ListItem
              key={entry.sessionId}
              disableGutters
              sx={{
                gap: 1.5,
                borderRadius: 1,
                outline: entry.sessionId === selfSessionId ? "2px solid" : "none",
                outlineColor: "primary.main",
                px: 1,
              }}
            >
              <Typography color="text.secondary" sx={{ minWidth: "2.2em" }}>
                #{entry.rank}
              </Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography color="text.secondary">{entry.primaryScore} wins</Typography>
            </ListItem>
          ))}
        </List>
      </Paper>

      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      <Button
        type="button"
        fullWidth
        disabled={!isHost}
        onClick={() => {
          connection.room.send(ROOM_MESSAGE_TYPES.playAgain, {});
        }}
      >
        {isHost ? "Play again" : "Waiting for the host…"}
      </Button>
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
