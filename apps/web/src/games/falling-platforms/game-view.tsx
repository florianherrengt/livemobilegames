import { Alert, Box, Button, Chip, List, ListItem, Paper, Stack, Typography } from "@mui/material";
import {
  type FallingPlatformsState,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { InvitePanel } from "../../components/invite-panel.js";
import type { RoomConnection } from "../../game-connection.js";
import { ArenaView } from "./arena-view.js";

export function FallingPlatformsGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: FallingPlatformsState;
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

  if (state.phase === "countdown") {
    return <CountdownView state={state} />;
  }
  if (state.phase === "playing") {
    return <ArenaView connection={connection} state={state} selfSessionId={selfSessionId} />;
  }
  if (state.phase === "results") {
    return (
      <Box sx={{ position: "relative", height: "100dvh", width: "100%" }}>
        <ArenaView connection={connection} state={state} selfSessionId={selfSessionId} />
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(0, 0, 0, 0.55)",
            zIndex: 10,
            p: 3,
          }}
        >
          <ResultsView state={state} />
        </Box>
      </Box>
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
  state: FallingPlatformsState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const isHost = state.hostSessionId === selfSessionId;
  const hasPlayed = state.roundNumber > 0;

  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Falling Platforms
        </Typography>
        <Typography color="text.secondary">
          Hop across platforms as the arena collapses under you. Last survivor wins.
        </Typography>
      </Box>

      <Paper
        component="section"
        aria-labelledby="falling-platforms-players-heading"
        sx={{ p: 2.25 }}
      >
        <Typography component="h2" variant="h2" id="falling-platforms-players-heading">
          Players ({state.players.size})
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.entries()].map(([sessionId, player]) => (
            <ListItem key={sessionId} disableGutters sx={{ gap: 1 }}>
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
              ? "The round is over. Press Play again when everyone is ready."
              : "Waiting for everyone to join, then the first round starts automatically."
            : hasPlayed
              ? "The round is over. Waiting for the host to play again."
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

function CountdownView({ state }: { state: FallingPlatformsState }) {
  return (
    <Box
      component="main"
      sx={{
        position: "relative",
        height: "100dvh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <Typography component="h1" variant="h1" align="center">
        Get ready…
      </Typography>
      <Typography component="h2" variant="h2" color="text.secondary" align="center" sx={{ mt: 1 }}>
        Round {state.roundNumber} starts automatically
      </Typography>
      <Typography color="text.secondary" align="center" sx={{ mt: 2 }} aria-live="polite">
        {state.players.size} players connected
      </Typography>
      <HowToPlay
        title="How to play Falling Platforms"
        points={[
          "Swipe in any direction to hop to an adjacent platform.",
          "Orange platforms are about to collapse — don't be standing on them.",
          "Last player standing wins.",
        ]}
      />
    </Box>
  );
}

function ResultsView({ state }: { state: FallingPlatformsState }) {
  const winner = state.winnerSessionId === "" ? null : state.players.get(state.winnerSessionId);
  const headline = state.draw ? "It's a draw" : winner ? `${winner.name} wins!` : "Round over";

  return (
    <Paper
      component="section"
      aria-labelledby="falling-platforms-results-heading"
      sx={{
        maxWidth: 420,
        width: "100%",
        p: 3,
        textAlign: "center",
      }}
    >
      <Typography
        component="h1"
        variant="h1"
        id="falling-platforms-results-heading"
        align="center"
        aria-live="polite"
      >
        {headline}
      </Typography>
      <Typography component="h2" variant="h2" color="text.secondary" align="center" sx={{ mt: 1 }}>
        Round {state.roundNumber} complete
      </Typography>
      <Typography color="text.secondary" align="center" sx={{ mt: 2 }}>
        Returning to the lobby…
      </Typography>
    </Paper>
  );
}
