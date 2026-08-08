import { Alert, Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { type CapitalPinState, GAME_MESSAGE_TYPES } from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { hapticFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";
import { geoPinSounds } from "./audio/GeoPinSounds.js";
import { MapMarker } from "./map/map-marker.js";
import { GameMap, type LngLat } from "./map/map-view.js";

export function RoundView({
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
  const [guess, setGuess] = useState<LngLat | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showHowTo, setShowHowTo] = useState(state.roundNumber === 1);
  const roundRef = useRef(state.roundNumber);

  // Reset the local guess whenever a new round begins.
  if (roundRef.current !== state.roundNumber) {
    roundRef.current = state.roundNumber;
    setGuess(null);
  }

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (state.roundNumber !== 1) {
      setShowHowTo(false);
      return;
    }
    setShowHowTo(true);
    const timer = window.setTimeout(() => setShowHowTo(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [state.roundNumber]);

  const self = state.players.get(selfSessionId);
  const submitted = self?.submitted ?? false;
  const connected = !connection.reconnecting && self?.connectionStatus === "connected";
  const secondsLeft = Math.max(0, Math.ceil((state.roundEndsAt - now) / 1000));

  const handleMapClick = (lngLat: LngLat): void => {
    void geoPinSounds.initialise();
    const sameSpot = guess?.lng === lngLat.lng && guess?.lat === lngLat.lat;
    if (sameSpot) {
      return;
    }
    if (guess) {
      geoPinSounds.pinMove();
      hapticFeedback("move");
    } else {
      geoPinSounds.pinDrop();
      hapticFeedback("select");
    }
    setGuess(lngLat);
  };

  const submit = (): void => {
    if (!guess) {
      return;
    }
    void geoPinSounds.initialise();
    geoPinSounds.guessConfirmed();
    hapticFeedback("confirm");
    connection.room.send(GAME_MESSAGE_TYPES.submit, {
      type: "submit",
      roundNumber: state.roundNumber,
      latitude: guess.lat,
      longitude: guess.lng,
    });
  };

  return (
    <Box
      component="main"
      sx={{ display: "flex", flexDirection: "column", height: "100dvh", width: "100%" }}
    >
      <Paper
        square
        component="header"
        sx={{
          p: 1.5,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="body2">
          Round {state.roundNumber} / {state.totalRounds}
        </Typography>
        <Typography variant="body2" aria-live="polite" sx={{ fontWeight: 700 }}>
          {state.currentCapitalName}
        </Typography>
        {!connected && <Chip label="Reconnecting…" size="small" color="warning" />}
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {secondsLeft}s
        </Typography>
      </Paper>

      <Box
        sx={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <GameMap onMapClick={handleMapClick} interactive={connected && !submitted}>
          {guess !== null && (
            <MapMarker longitude={guess.lng} latitude={guess.lat} colour="#4363d8" />
          )}
          <SubmittedChips
            players={[...state.players.entries()].map(([sessionId, player]) => ({
              sessionId,
              name: player.name,
              submitted: player.submitted,
            }))}
          />
        </GameMap>
        {showHowTo && (
          <HowToPlay
            title="How to play Capital Pin"
            points={[
              "Tap the map to drop your pin; tap a new spot to move it.",
              "Zoom with pinch or the map controls to place it precisely.",
              "Lock your answer before time runs out.",
              "Closest guess to the capital wins the round.",
            ]}
          />
        )}
      </Box>

      <Paper square sx={{ p: 1.5 }}>
        <Stack spacing={1}>
          {roomError !== null && <Alert severity="error">{roomError}</Alert>}
          <Button fullWidth disabled={!connected || submitted || guess === null} onClick={submit}>
            {submitted ? "Answer locked" : "Lock answer"}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

/** Lightweight indicator that a player has locked (no reveal of their guess). */
function SubmittedChips({
  players,
}: {
  players: Array<{ sessionId: string; name: string; submitted: boolean }>;
}) {
  const submitted = players.filter((player) => player.submitted);
  return (
    <Box
      sx={{
        position: "absolute",
        top: 12,
        left: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 0.75,
        pointerEvents: "none",
        maxWidth: "60%",
        zIndex: 2,
      }}
    >
      {submitted.map((player) => (
        <Box
          key={player.sessionId}
          sx={{
            bgcolor: "rgba(0, 0, 0, 0.6)",
            color: "#fff",
            fontSize: 12,
            px: 1,
            py: 0.25,
            borderRadius: 999,
          }}
        >
          ✓ {player.name}
        </Box>
      ))}
    </Box>
  );
}
