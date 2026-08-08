import { Alert, Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import {
  FLAPPY_RACE_CONSTANTS,
  FLAPPY_RACE_MESSAGE_TYPES,
  type FlappyRaceState,
  flapRejectionSchema,
  obstacleLeftX,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { gameFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";

const MAX_EXTRAPOLATION_MS = 80;

/**
 * Client-side extrapolation from the last authoritative snapshot. Uses the
 * server-reported velocity so the rendered bird tracks the authoritative
 * position instead of leading it; deaths therefore match what the player sees.
 */
export function extrapolateBirdY(y: number, vy: number, deltaMs: number): number {
  const dt = Math.max(0, deltaMs) / 1000;
  let next = y + vy * dt;
  const maxY = FLAPPY_RACE_CONSTANTS.WORLD_HEIGHT - FLAPPY_RACE_CONSTANTS.BIRD_HEIGHT;
  if (next < 0) {
    next = 0;
  } else if (next > maxY) {
    next = maxY;
  }
  return next;
}

function drawFrame(
  canvas: HTMLCanvasElement,
  state: FlappyRaceState,
  lastStateAt: number,
  time: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const config = FLAPPY_RACE_CONSTANTS;
  const scale = Math.min(rect.width / config.WORLD_WIDTH, rect.height / config.WORLD_HEIGHT);
  const offsetX = (rect.width - config.WORLD_WIDTH * scale) / 2;
  const offsetY = (rect.height - config.WORLD_HEIGHT * scale) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  drawBackground(ctx, rect.width, rect.height);

  const delta =
    state.phase === "running" ? Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, time - lastStateAt)) : 0;
  const elapsed = state.phase === "running" ? state.courseElapsedMs + delta : state.courseElapsedMs;
  const speed = state.courseSpeed || config.COURSE_SPEED;
  drawObstacles(ctx, state, speed, elapsed);
  drawBirds(ctx, state, delta);
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  void width;
  void height;
  const config = FLAPPY_RACE_CONSTANTS;
  const gradient = ctx.createLinearGradient(0, 0, 0, config.WORLD_HEIGHT);
  gradient.addColorStop(0, "#0c1520");
  gradient.addColorStop(1, "#1c3a52");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);
  ctx.fillStyle = "#22303d";
  ctx.fillRect(0, config.WORLD_HEIGHT - 6, config.WORLD_WIDTH, 6);
}

function drawObstacles(
  ctx: CanvasRenderingContext2D,
  state: FlappyRaceState,
  speed: number,
  elapsedMs: number,
): void {
  const config = FLAPPY_RACE_CONSTANTS;
  ctx.fillStyle = "#9db8c9";
  for (let index = 0; index < state.obstacleOpenings.length; index++) {
    const leftX = obstacleLeftX(config, index, speed, elapsedMs);
    if (leftX > config.WORLD_WIDTH + config.OBSTACLE_WIDTH + 40) {
      break;
    }
    if (leftX + config.OBSTACLE_WIDTH < 0) {
      continue;
    }
    const gapTop = state.obstacleOpenings[index];
    if (gapTop === undefined) {
      continue;
    }
    const gapBottom = gapTop + config.GAP_SIZE;
    ctx.fillRect(leftX, 0, config.OBSTACLE_WIDTH, gapTop);
    ctx.fillRect(leftX, gapBottom, config.OBSTACLE_WIDTH, config.WORLD_HEIGHT - gapBottom);
  }
}

function drawBirds(ctx: CanvasRenderingContext2D, state: FlappyRaceState, delta: number): void {
  const config = FLAPPY_RACE_CONSTANTS;
  for (const player of state.players.values()) {
    if (!player.roundActive || (state.phase !== "countdown" && state.phase !== "running")) {
      continue;
    }
    const y = extrapolateBirdY(player.birdY, player.birdVy, delta);
    const color = hexToRgb(player.color || "#ffffff");
    ctx.fillStyle = `rgb(${color.r} ${color.g} ${color.b})`;
    ctx.beginPath();
    ctx.arc(
      config.BIRD_X + config.BIRD_WIDTH / 2,
      y + config.BIRD_HEIGHT / 2,
      config.BIRD_WIDTH / 2.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = "#f4a259";
    ctx.beginPath();
    ctx.moveTo(config.BIRD_X + config.BIRD_WIDTH - 3, y + config.BIRD_HEIGHT / 2);
    ctx.lineTo(config.BIRD_X + config.BIRD_WIDTH + 8, y + config.BIRD_HEIGHT / 2 + 2);
    ctx.lineTo(config.BIRD_X + config.BIRD_WIDTH - 3, y + config.BIRD_HEIGHT / 2 + 6);
    ctx.closePath();
    ctx.fill();
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export function ArenaView({
  connection,
  state,
  selfSessionId,
  roomError = null,
}: {
  connection: RoomConnection;
  state: FlappyRaceState;
  selfSessionId: string;
  roomError?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastStateAtRef = useRef(performance.now());
  const stateKeyRef = useRef("");
  const stateKey = [
    state.phase,
    state.roundNumber,
    state.courseElapsedMs,
    [...state.players.values()]
      .map((player) => `${player.name}:${player.birdY}:${player.birdVy}:${player.roundActive}`)
      .join("|"),
  ].join("|");
  if (stateKeyRef.current !== stateKey) {
    stateKeyRef.current = stateKey;
    lastStateAtRef.current = performance.now();
  }
  const sequenceRef = useRef(0);
  const flapErrorTimerRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [flapError, setFlapError] = useState<string | null>(null);

  const local = state.players.get(selfSessionId);
  const wasRoundActiveRef = useRef(local?.roundActive ?? false);
  const wasRoundResultRef = useRef(false);
  const canFlap =
    (state.phase === "countdown" || state.phase === "running") &&
    local !== undefined &&
    local.roundActive &&
    !local.matchRemoved;
  const isSpectator =
    local === undefined ||
    local.matchRemoved ||
    !local.roundActive ||
    state.phase === "round-result";
  const currentRoundActive = local?.roundActive ?? false;
  const roundWinnersSnapshot = [...state.roundWinnerSessionIds].join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }
    let frame = 0;
    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    const draw = (time: number): void => {
      drawFrame(canvas, stateRef.current, lastStateAtRef.current, time);
      frame = window.requestAnimationFrame(draw);
    };
    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSize);
      observer.observe(container);
      frame = window.requestAnimationFrame(draw);
      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }
    window.addEventListener("resize", updateSize);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (wasRoundActiveRef.current && !currentRoundActive && state.phase === "running") {
      gameFeedback("eliminated");
    }
    wasRoundActiveRef.current = currentRoundActive;
  }, [currentRoundActive, state.phase]);

  useEffect(() => {
    const isRoundResult = state.phase === "round-result";
    if (
      isRoundResult &&
      !wasRoundResultRef.current &&
      roundWinnersSnapshot.split("|").includes(selfSessionId)
    ) {
      gameFeedback("win");
    }
    wasRoundResultRef.current = isRoundResult;
  }, [roundWinnersSnapshot, selfSessionId, state.phase]);

  useEffect(() => {
    const off = connection.room.onMessage(FLAPPY_RACE_MESSAGE_TYPES.flapRejected, (payload) => {
      const parsed = flapRejectionSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      gameFeedback("invalid");
      setFlapError(parsed.data.reason === "rate-limited" ? "Flapping too fast." : "Flap rejected.");
      if (flapErrorTimerRef.current !== null) {
        window.clearTimeout(flapErrorTimerRef.current);
      }
      flapErrorTimerRef.current = window.setTimeout(() => setFlapError(null), 1_000);
    });
    return () => {
      off();
      if (flapErrorTimerRef.current !== null) {
        window.clearTimeout(flapErrorTimerRef.current);
      }
    };
  }, [connection.room]);

  const handleFlap = (): void => {
    const current = stateRef.current;
    const currentLocal = current.players.get(selfSessionId);
    if (
      (current.phase !== "countdown" && current.phase !== "running") ||
      !currentLocal ||
      !currentLocal.roundActive ||
      currentLocal.matchRemoved
    ) {
      return;
    }
    sequenceRef.current += 1;
    gameFeedback("move");
    connection.room.send(FLAPPY_RACE_MESSAGE_TYPES.flap, {
      type: "flap",
      sequence: sequenceRef.current,
      roundNumber: current.roundNumber,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    primeGameFeedback();
    handleFlap();
  };

  const countdownRemaining = Math.max(1, Math.ceil((state.countdownEndsAt - now) / 1000));

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
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Round {state.roundNumber}/{state.totalRounds}
        </Typography>
        {isSpectator && <Chip label="Spectating" size="small" variant="outlined" color="info" />}
        {local !== undefined && local.connectionStatus !== "connected" && (
          <Chip label="Reconnecting…" size="small" variant="outlined" color="warning" />
        )}
        <Button
          type="button"
          size="small"
          variant="text"
          sx={{ ml: "auto" }}
          onClick={() => connection.leave()}
        >
          Leave
        </Button>
      </Paper>

      <Box
        ref={containerRef}
        data-testid="flappy-race-arena"
        data-phase={state.phase}
        data-round={state.roundNumber}
        data-self-session={selfSessionId}
        data-spectating={isSpectator}
        data-openings={JSON.stringify([...state.obstacleOpenings])}
        data-winners={JSON.stringify([...state.roundWinnerSessionIds])}
        data-local-y={local?.birdY ?? ""}
        data-local-active={local?.roundActive ?? false}
        sx={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        onPointerDown={handlePointerDown}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Flappy Race course with shared obstacles and every player's bird"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        {state.phase === "countdown" && (
          <HowToPlay
            title="How to play Flappy Race"
            points={[
              "Tap the course or press Flap to flap.",
              "Fly through the gaps — hitting an obstacle ends your round.",
              "The furthest bird wins; five rounds decide the match.",
            ]}
          />
        )}

        {state.phase === "countdown" && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(0, 0, 0, 0.45)",
              zIndex: 10,
              p: 3,
              pointerEvents: "none",
            }}
          >
            <Paper sx={{ p: 3, textAlign: "center", minWidth: 240 }}>
              <Typography component="h1" variant="h1">
                Round {state.roundNumber}
              </Typography>
              <Typography
                component="h2"
                variant="h2"
                aria-live="polite"
                sx={{ mt: 1, fontSize: "2.5rem", fontWeight: 800 }}
              >
                {countdownRemaining}
              </Typography>
              <Stack spacing={0.75} sx={{ mt: 2 }}>
                {[...state.players.values()]
                  .filter((player) => player.roundActive || player.eliminated)
                  .sort((a, b) => a.joinedOrder - b.joinedOrder)
                  .map((player) => (
                    <Stack
                      key={player.name}
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: "center" }}
                    >
                      <Box
                        component="span"
                        aria-hidden
                        sx={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          bgcolor: player.color || "#ffffff",
                        }}
                      />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {player.name}
                      </Typography>
                    </Stack>
                  ))}
              </Stack>
            </Paper>
          </Box>
        )}

        {state.phase === "round-result" && (
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
              pointerEvents: "none",
            }}
          >
            <Paper sx={{ p: 3, textAlign: "center", maxWidth: 420, width: "100%" }}>
              <Typography component="h1" variant="h1" aria-live="polite">
                Round {state.roundNumber} result
              </Typography>
              <Typography variant="h2" sx={{ mt: 1 }} aria-live="polite">
                {roundResultHeadline(state)}
              </Typography>
              <Stack spacing={0.75} sx={{ mt: 2 }}>
                {[...state.players.values()]
                  .sort((a, b) => a.joinedOrder - b.joinedOrder)
                  .map((player) => (
                    <Stack
                      key={player.name}
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: "space-between" }}
                    >
                      <Typography variant="body2">{player.name}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        {player.roundWins} win{player.roundWins === 1 ? "" : "s"}
                      </Typography>
                    </Stack>
                  ))}
              </Stack>
            </Paper>
          </Box>
        )}
      </Box>

      <Paper square sx={{ p: 1.25 }}>
        <Stack spacing={1}>
          {roomError !== null && <Alert severity="error">{roomError}</Alert>}
          <Button
            type="button"
            fullWidth
            disabled={!canFlap}
            onClick={handleFlap}
            data-testid="flappy-flap-button"
          >
            {canFlap ? "Flap" : isSpectator ? "Spectating" : "Flap"}
          </Button>
          <Typography
            variant="body2"
            align="center"
            aria-live="polite"
            data-testid="flappy-arena-status"
          >
            {flapError ?? (canFlap ? "Tap the course or press Flap." : "Spectating.")}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}

function roundResultHeadline(state: FlappyRaceState): string {
  const winners = state.roundWinnerSessionIds
    .map((sessionId) => state.players.get(sessionId)?.name)
    .filter((name): name is string => name !== undefined);
  if (winners.length === 0) {
    return "No winners this round";
  }
  return winners.length === 1
    ? `${winners[0]} wins the round`
    : `${winners.join(" & ")} share the round win`;
}
