import { Alert, Box, Button, Chip, List, ListItem, Paper, Stack, Typography } from "@mui/material";
import {
  type GolfRaceState,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { InvitePanel } from "../../components/invite-panel.js";
import { gameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";
import { ArenaView } from "./arena-view.js";

export function GolfRaceGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: GolfRaceState;
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

  if (state.phase === "countdown" || state.phase === "aiming" || state.phase === "simulating") {
    return (
      <ArenaView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  if (state.phase === "round-result") {
    return (
      <RoundResultView
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
  state: GolfRaceState;
  selfSessionId: string;
  roomError: string | null;
}) {
  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Golf Race
        </Typography>
        <Typography color="text.secondary">
          Five rounds of golf shots through one shared course. Each round the hazards grow; the
          player with the most points after round 5 wins.
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="golf-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="golf-players-heading">
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
          Waiting for everyone to join, then the first round starts automatically.
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

function RoundResultView({
  connection,
  state,
  selfSessionId,
  roomError,
}: {
  connection: RoomConnection;
  state: GolfRaceState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const winnerNames = state.roundWinnerSessionIds
    .map((sessionId) => state.players.get(sessionId)?.name)
    .filter((name): name is string => name !== undefined);
  const nextRound = state.roundNumber < state.totalRounds ? state.roundNumber + 1 : null;

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Golf Race
        </Typography>
        <Typography component="h2" variant="h2" aria-live="polite">
          Round {state.roundNumber} result
        </Typography>
        <Typography color="text.secondary">
          {winnerNames.length > 0 ? `${winnerNames.join(", ")} won the round` : "Round complete"}
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="golf-round-standings-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="golf-round-standings-heading">
          Round {state.roundNumber} standings
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.values()]
            .sort((a, b) => a.finishedRank - b.finishedRank || a.joinedOrder - b.joinedOrder)
            .map((player) => (
              <ListItem key={player.joinedOrder} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ minWidth: 32, fontWeight: 800 }}>
                  #{player.finishedRank || "-"}
                </Typography>
                <Typography sx={{ flex: 1, fontWeight: 600 }}>
                  {player.name}
                  {player.joinedOrder === state.players.get(selfSessionId)?.joinedOrder
                    ? " (you)"
                    : ""}
                </Typography>
                <Typography color="text.secondary">{player.matchPoints} pts</Typography>
              </ListItem>
            ))}
        </List>
      </Paper>

      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      <Paper sx={{ p: 2.25 }}>
        <Typography color="text.secondary" aria-live="polite">
          {nextRound !== null
            ? `Round ${nextRound} starts automatically — hazards grow.`
            : "Final results are coming…"}
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
  state: GolfRaceState;
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
  const winnerSoundPlayedRef = useRef(false);

  useEffect(() => {
    if (winnerSoundPlayedRef.current) {
      return;
    }
    if (result?.winnerSessionIds.includes(selfSessionId)) {
      gameFeedback("win");
      winnerSoundPlayedRef.current = true;
    } else if (state.players.get(selfSessionId)?.finished) {
      gameFeedback("confirm");
      winnerSoundPlayedRef.current = true;
    }
  }, [result, selfSessionId, state.players]);

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Golf Race
        </Typography>
        <Typography component="h2" variant="h2" aria-live="polite">
          {headline}
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="golf-leaderboard-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="golf-leaderboard-heading">
          Final results
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="golf-race-leaderboard">
          {result?.leaderboard.map((entry) => (
            <ListItem
              key={entry.sessionId}
              disableGutters
              sx={{
                gap: 1,
                borderRadius: 1,
                outline: entry.sessionId === selfSessionId ? "2px solid" : "none",
                outlineColor: "primary.main",
                px: 1,
              }}
            >
              <Typography sx={{ minWidth: 32, fontWeight: 800 }}>#{entry.rank}</Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography sx={{ fontWeight: 700 }}>{entry.primaryScore} pts</Typography>
              {entry.rank === 1 && <Chip label="winner" size="small" color="primary" />}
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
