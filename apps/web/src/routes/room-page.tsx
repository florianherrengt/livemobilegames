import { Box, Button, Container, Paper, Stack, Typography } from "@mui/material";
import {
  type CapitalPinState,
  type FallingPlatformsState,
  normalizeRoomCode,
  roomCodeSchema,
} from "@phone-party/protocol";
import { lazy, Suspense } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { GameSelect } from "../components/game-select.js";
import { InvitePanel } from "../components/invite-panel.js";
import { JoinRoomByLink } from "../components/join-room-by-link.js";
import { PlayerList } from "../components/player-list.js";
import { StartGameButton } from "../components/start-game-button.js";
import type { RoomState } from "../game-connection.js";
import { useRoomConnection } from "../game-connection.js";

const CapitalPinGameView = lazy(() =>
  import("../games/capital-pin/game-view.js").then((module) => ({
    default: module.CapitalPinGameView,
  })),
);

const FallingPlatformsGameView = lazy(() =>
  import("../games/falling-platforms/game-view.js").then((module) => ({
    default: module.FallingPlatformsGameView,
  })),
);

export function RoomPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { connection } = useRoomConnection();
  const normalizedCode = normalizeRoomCode(code ?? "");
  const hasValidCode = roomCodeSchema.safeParse(normalizedCode).success;

  if (connection === null) {
    return (
      <Container component="main" maxWidth="sm" sx={{ py: { xs: 2.5, sm: 4 } }}>
        <Stack spacing={2}>
          <Box component="header">
            <Typography component="h1" variant="h1">
              Room {code ?? ""}
            </Typography>
          </Box>
          {hasValidCode ? (
            <JoinRoomByLink code={normalizedCode} />
          ) : (
            <Paper sx={{ p: 2.25 }}>
              <Stack spacing={2}>
                <Typography>There is no active room connection for this device.</Typography>
                <Button component={Link} to="/">
                  Return home
                </Button>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Container>
    );
  }

  const roomState: RoomState = connection.room.state;
  const selfSessionId = connection.room.sessionId;

  if (connection.reconnecting) {
    return (
      <Container component="main" maxWidth="sm" sx={{ py: { xs: 2.5, sm: 4 } }}>
        <Paper component="section" aria-labelledby="reconnecting-heading" sx={{ p: 2.25 }}>
          <Stack spacing={1}>
            <Typography component="h2" variant="h2" id="reconnecting-heading">
              Reconnecting…
            </Typography>
            <Typography color="text.secondary">
              Your connection to the room was lost. Trying to reconnect.
            </Typography>
          </Stack>
        </Paper>
      </Container>
    );
  }

  if (isCapitalPinState(roomState)) {
    return (
      <Box sx={{ position: "relative", height: "100dvh" }}>
        <Suspense
          fallback={
            <Paper sx={{ p: 2.25, m: 2 }}>
              <Typography>Loading game…</Typography>
            </Paper>
          }
        >
          <CapitalPinGameView
            connection={connection}
            state={roomState}
            selfSessionId={selfSessionId}
          />
        </Suspense>
      </Box>
    );
  }

  if (isFallingPlatformsState(roomState)) {
    return (
      <Box sx={{ position: "relative", height: "100dvh" }}>
        <Suspense
          fallback={
            <Paper sx={{ p: 2.25, m: 2 }}>
              <Typography>Loading game…</Typography>
            </Paper>
          }
        >
          <FallingPlatformsGameView
            connection={connection}
            state={roomState}
            selfSessionId={selfSessionId}
          />
        </Suspense>
      </Box>
    );
  }

  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 2.5, sm: 4 } }}>
      <Stack spacing={2}>
        <Box component="header">
          <Typography component="h1" variant="h1">
            Room {normalizedCode}
          </Typography>
        </Box>
        <Paper component="section" aria-labelledby="room-status-heading" sx={{ p: 2.25 }}>
          <Stack spacing={1}>
            <Typography component="h2" variant="h2" id="room-status-heading">
              Room ready
            </Typography>
            <Typography color="text.secondary">
              The host chooses a game, then everyone moves into it together.
            </Typography>
          </Stack>
        </Paper>
        <GameSelect connection={connection} state={roomState} selfSessionId={selfSessionId} />
        <InvitePanel code={connection.code} />
        <PlayerList players={roomState.players} selfSessionId={selfSessionId} />
        <StartGameButton connection={connection} state={roomState} selfSessionId={selfSessionId} />
        <Button
          type="button"
          variant="outlined"
          onClick={() => {
            connection.leave();
            navigate("/");
          }}
          fullWidth
        >
          Leave room
        </Button>
      </Stack>
    </Container>
  );
}

function isCapitalPinState(state: RoomState): state is CapitalPinState {
  return "phase" in state && "currentCapitalName" in state;
}

function isFallingPlatformsState(state: RoomState): state is FallingPlatformsState {
  return "phase" in state && "platforms" in state;
}
