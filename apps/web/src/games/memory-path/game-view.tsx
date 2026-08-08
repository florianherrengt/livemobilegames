import { Alert, Box, Button, Chip, List, ListItem, Paper, Stack, Typography } from "@mui/material";
import {
  type MemoryPathState,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { InvitePanel } from "../../components/invite-panel.js";
import type { RoomConnection } from "../../game-connection.js";
import { MemoryPathArenaView } from "./arena-view.js";

export function MemoryPathGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: MemoryPathState;
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

  if (state.phase === "lobby") {
    return (
      <LobbyView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  if (state.phase === "match-result") {
    return (
      <MatchResultView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  return (
    <MemoryPathArenaView
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
  state: MemoryPathState;
  selfSessionId: string;
  roomError: string | null;
}) {
  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Memory Path
        </Typography>
        <Typography color="text.secondary">
          Memorize the route, race from memory, and do not step off the hidden path.
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="memory-path-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="memory-path-players-heading">
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
          Waiting for everyone to join, then the match starts automatically.
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

function MatchResultView({
  connection,
  state,
  selfSessionId,
  roomError,
}: {
  connection: RoomConnection;
  state: MemoryPathState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const result = state.matchResult;
  const isHost = state.hostSessionId === selfSessionId;
  const winnerNames = result
    ? result.winnerSessionIds
        .map(
          (sessionId) =>
            state.players.get(sessionId)?.name ??
            result.leaderboard.find((entry) => entry.sessionId === sessionId)?.label,
        )
        .filter((name): name is string => name !== undefined)
    : [];
  const headline =
    winnerNames.length === 1 ? `${winnerNames[0]} wins the match!` : "The match is tied!";

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Memory Path
        </Typography>
        <Typography variant="h2" aria-live="polite">
          {headline}
        </Typography>
        {result?.suddenDeathUsed && (
          <Chip
            label="Sudden death was needed"
            size="small"
            color="warning"
            variant="outlined"
            sx={{ mt: 1 }}
          />
        )}
      </Box>

      <Paper component="section" aria-labelledby="memory-path-leaderboard-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="memory-path-leaderboard-heading">
          Final scoreboard
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="memory-path-leaderboard">
          {result?.leaderboard.map((entry) => (
            <ListItem key={entry.sessionId} disableGutters sx={{ gap: 1 }}>
              <Typography sx={{ minWidth: 32, fontWeight: 800 }}>#{entry.rank}</Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography sx={{ fontWeight: 800 }}>
                {entry.roundWins} win{entry.roundWins === 1 ? "" : "s"}
              </Typography>
            </ListItem>
          ))}
        </List>
      </Paper>

      <Paper
        component="section"
        aria-labelledby="memory-path-round-results-heading"
        sx={{ p: 2.25 }}
      >
        <Typography component="h2" variant="h2" id="memory-path-round-results-heading">
          Round results
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="memory-path-round-results">
          {result?.roundResults.map((round) => {
            const winnerName = round.winnerLabel || "Nobody";
            const detail =
              round.reason === "timeout"
                ? `${winnerName} — reached ${round.winnerProgress}%`
                : `${winnerName} — finish`;
            return (
              <ListItem key={round.roundNumber} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ minWidth: 84, fontWeight: 700 }}>
                  {round.suddenDeath ? "Sudden death" : `Round ${round.roundNumber}`}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {detail}
                </Typography>
              </ListItem>
            );
          })}
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
