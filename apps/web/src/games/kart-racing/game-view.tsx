import { Alert, Box, Button, Chip, List, ListItem, Paper, Stack, Typography } from "@mui/material";
import {
  type KartRacingState,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { InvitePanel } from "../../components/invite-panel.js";
import { gameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";
import { ArenaView } from "./arena-view.js";

export function KartRacingGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: KartRacingState;
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

  if (state.phase === "countdown" || state.phase === "racing") {
    return (
      <ArenaView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  if (state.phase === "race-result") {
    return <RaceResultView state={state} selfSessionId={selfSessionId} />;
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

function RaceResultView({
  state,
  selfSessionId,
}: {
  state: KartRacingState;
  selfSessionId: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);
  const isFinal = state.raceNumber >= state.totalRaces;
  const nextRaceIn = Math.max(0, Math.ceil((state.resultsEndsAt - now) / 1000));
  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Race {state.raceNumber} result
        </Typography>
        <Typography color="text.secondary">{state.trackName}</Typography>
      </Box>
      <Paper component="section" aria-labelledby="kart-racing-race-result-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="kart-racing-race-result-heading">
          Finishing order
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="kart-racing-race-result">
          {[...state.raceResult].map((entry) => {
            const player = state.players.get(entry.sessionId);
            return (
              <ListItem key={entry.sessionId} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ minWidth: 28, fontWeight: 800 }}>#{entry.position}</Typography>
                <Typography sx={{ flex: 1, fontWeight: 600 }}>
                  {entry.label}
                  {entry.sessionId === selfSessionId ? " (you)" : ""}
                </Typography>
                {entry.timedOut && <Chip label="timed out" size="small" variant="outlined" />}
                <Typography variant="body2" color="text.secondary">
                  +{entry.points} pts
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {player?.matchPoints ?? 0} total
                </Typography>
              </ListItem>
            );
          })}
        </List>
      </Paper>
      <Paper sx={{ p: 2.25 }}>
        <Typography color="text.secondary" aria-live="polite" data-testid="kart-race-result-status">
          {isFinal ? "Final match results coming up…" : `Next race in ${nextRaceIn}s`}
        </Typography>
      </Paper>
    </Stack>
  );
}

function LobbyView({
  connection,
  state,
  selfSessionId,
  roomError,
}: {
  connection: RoomConnection;
  state: KartRacingState;
  selfSessionId: string;
  roomError: string | null;
}) {
  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Kart Racing
        </Typography>
        <Typography color="text.secondary">
          Top-down arcade kart races. Steer with one finger, swipe up to shoot, and be first over
          the line in three races.
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="kart-racing-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="kart-racing-players-heading">
          Players ({state.players.size})
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.entries()]
            .sort(([, a], [, b]) => a.joinedOrder - b.joinedOrder)
            .map(([sessionId, player]) => (
              <ListItem key={sessionId} disableGutters sx={{ gap: 1 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    bgcolor: player.color || "#ffffff",
                  }}
                />
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
  state: KartRacingState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const result = state.result;
  useEffect(() => {
    if (result !== null) {
      gameFeedback("win");
    }
  }, [result]);
  const isHost = state.hostSessionId === selfSessionId;
  const winnerNames = result
    ? result.winnerSessionIds
        .map((sessionId) => state.players.get(sessionId)?.name)
        .filter((name): name is string => name !== undefined)
    : [];
  const headline =
    winnerNames.length === 0
      ? "No winner"
      : winnerNames.length === 1
        ? `${winnerNames[0]} wins the match!`
        : `${winnerNames.join(" & ")} share the match win!`;

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Kart Racing
        </Typography>
        <Typography variant="h2" aria-live="polite">
          {headline}
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="kart-racing-final-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="kart-racing-final-heading">
          Final match results
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="kart-racing-leaderboard">
          {result?.leaderboard.map((entry) => (
            <ListItem key={entry.sessionId} disableGutters sx={{ gap: 1 }}>
              <Typography sx={{ minWidth: 32, fontWeight: 800 }}>#{entry.rank}</Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography sx={{ fontWeight: 800 }}>{entry.matchPoints} pts</Typography>
              <Typography variant="body2" color="text.secondary">
                {entry.raceWins} win{entry.raceWins === 1 ? "" : "s"}
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
