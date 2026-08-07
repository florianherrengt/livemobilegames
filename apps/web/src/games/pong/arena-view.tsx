import { Alert, Box, Button, Chip, Paper, Typography } from "@mui/material";
import {
  PONG_CONSTANTS,
  PONG_EDGE_ROTATION,
  PONG_MESSAGE_TYPES,
  type PongPlayerState,
  type PongState,
  pongRejectionSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { gameFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";

const MAX_EXTRAPOLATION_MS = 80;

type Edge = "top" | "right" | "bottom" | "left";

function drawFrame(
  canvas: HTMLCanvasElement,
  state: PongState,
  selfSessionId: string,
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

  const local = state.players.get(selfSessionId);
  const rotation = local ? PONG_EDGE_ROTATION[local.worldEdge] : 0;
  const side = Math.min(rect.width, rect.height);
  const scale = side / PONG_CONSTANTS.WORLD_SIZE;
  ctx.save();
  ctx.translate(rect.width / 2, rect.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.translate(-PONG_CONSTANTS.WORLD_SIZE / 2, -PONG_CONSTANTS.WORLD_SIZE / 2);

  ctx.fillStyle = "#0e141b";
  ctx.fillRect(0, 0, PONG_CONSTANTS.WORLD_SIZE, PONG_CONSTANTS.WORLD_SIZE);
  const flashActive =
    state.lastGoalAt > 0 && performance.timeOrigin + time - state.lastGoalAt < 800;
  drawWallsAndOpenings(
    ctx,
    state,
    selfSessionId,
    flashActive ? state.lastGoalDefenderSessionId : "",
  );
  drawPaddles(ctx, state, selfSessionId);
  const delta =
    state.phase === "running" ? Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, time - lastStateAt)) : 0;
  drawBalls(ctx, state, delta);
  ctx.restore();
}

function drawWallsAndOpenings(
  ctx: CanvasRenderingContext2D,
  state: PongState,
  selfSessionId: string,
  flashDefenderSessionId: string,
): void {
  const edges: Edge[] = ["top", "right", "bottom", "left"];
  for (const edge of edges) {
    const players = [...state.players.entries()].filter(([, player]) => player.worldEdge === edge);
    if (players.length === 0) {
      drawWallSegment(ctx, edge, 0, PONG_CONSTANTS.WORLD_SIZE);
      continue;
    }
    const openings = [...players]
      .map(([sessionId, player]) => ({
        start: player.openingStart,
        end: player.openingEnd,
        player,
        sessionId,
      }))
      .sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const opening of openings) {
      if (opening.start > cursor) {
        drawWallSegment(ctx, edge, cursor, opening.start);
      }
      drawOpening(
        ctx,
        edge,
        opening.start,
        opening.end,
        opening.player,
        opening.sessionId === selfSessionId,
        opening.sessionId === flashDefenderSessionId,
      );
      cursor = opening.end;
    }
    if (cursor < PONG_CONSTANTS.WORLD_SIZE) {
      drawWallSegment(ctx, edge, cursor, PONG_CONSTANTS.WORLD_SIZE);
    }
  }

  const size = PONG_CONSTANTS.WORLD_SIZE;
  const bumper = PONG_CONSTANTS.CORNER_BUMPER_SIZE;
  ctx.fillStyle = "#4b5b68";
  ctx.fillRect(0, 0, bumper, bumper);
  ctx.fillRect(size - bumper, 0, bumper, bumper);
  ctx.fillRect(0, size - bumper, bumper, bumper);
  ctx.fillRect(size - bumper, size - bumper, bumper, bumper);
}

function drawWallSegment(
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  start: number,
  end: number,
): void {
  const size = PONG_CONSTANTS.WORLD_SIZE;
  ctx.fillStyle = "#3b4854";
  ctx.strokeStyle = "#3b4854";
  ctx.lineWidth = 7;
  ctx.beginPath();
  switch (edge) {
    case "top":
      ctx.moveTo(start, 0);
      ctx.lineTo(end, 0);
      break;
    case "right":
      ctx.moveTo(size, start);
      ctx.lineTo(size, end);
      break;
    case "bottom":
      ctx.moveTo(start, size);
      ctx.lineTo(end, size);
      break;
    case "left":
      ctx.moveTo(0, start);
      ctx.lineTo(0, end);
      break;
  }
  ctx.stroke();
}

function drawOpening(
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  start: number,
  end: number,
  player: PongPlayerState,
  isLocal: boolean,
  isFlashing: boolean,
): void {
  const size = PONG_CONSTANTS.WORLD_SIZE;
  const color = player.color || "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = isLocal || isFlashing ? 18 : 12;
  ctx.globalAlpha = isLocal || isFlashing ? 0.7 : 0.3;
  ctx.beginPath();
  switch (edge) {
    case "top":
      ctx.moveTo(start, 0);
      ctx.lineTo(end, 0);
      break;
    case "right":
      ctx.moveTo(size, start);
      ctx.lineTo(size, end);
      break;
    case "bottom":
      ctx.moveTo(start, size);
      ctx.lineTo(end, size);
      break;
    case "left":
      ctx.moveTo(0, start);
      ctx.lineTo(0, end);
      break;
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  if (isFlashing) {
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#ffffff";
  }
  ctx.beginPath();
  switch (edge) {
    case "top":
      ctx.moveTo(start, 4);
      ctx.lineTo(end, 4);
      break;
    case "right":
      ctx.moveTo(size - 4, start);
      ctx.lineTo(size - 4, end);
      break;
    case "bottom":
      ctx.moveTo(start, size - 4);
      ctx.lineTo(end, size - 4);
      break;
    case "left":
      ctx.moveTo(4, start);
      ctx.lineTo(4, end);
      break;
  }
  ctx.stroke();
}

function drawPaddles(ctx: CanvasRenderingContext2D, state: PongState, selfSessionId: string): void {
  for (const [sessionId, player] of state.players.entries()) {
    const rect = paddleRectForPlayer(player);
    ctx.fillStyle = player.color || "#ffffff";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (sessionId === selfSessionId) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
}

function drawBalls(ctx: CanvasRenderingContext2D, state: PongState, delta: number): void {
  for (const ball of state.balls.values()) {
    const x = ball.spawnState === "moving" ? ball.x + (ball.vx * delta) / 1000 : ball.x;
    const y = ball.spawnState === "moving" ? ball.y + (ball.vy * delta) / 1000 : ball.y;
    const color = ball.ownerSessionId
      ? (state.players.get(ball.ownerSessionId)?.color ?? "#f2f2f2")
      : "#f2f2f2";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, PONG_CONSTANTS.BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    if (ball.spawnState === "warning") {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(x, y, PONG_CONSTANTS.BALL_RADIUS + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function paddleRectForPlayer(player: PongPlayerState) {
  const size = PONG_CONSTANTS.WORLD_SIZE;
  const thickness = PONG_CONSTANTS.PADDLE_THICKNESS;
  switch (player.worldEdge) {
    case "top":
      return {
        x: player.paddleCenter - player.paddleLength / 2,
        y: 0,
        width: player.paddleLength,
        height: thickness,
      };
    case "bottom":
      return {
        x: player.paddleCenter - player.paddleLength / 2,
        y: size - thickness,
        width: player.paddleLength,
        height: thickness,
      };
    case "left":
      return {
        x: 0,
        y: player.paddleCenter - player.paddleLength / 2,
        width: thickness,
        height: player.paddleLength,
      };
    case "right":
      return {
        x: size - thickness,
        y: player.paddleCenter - player.paddleLength / 2,
        width: thickness,
        height: player.paddleLength,
      };
  }
}

export function ArenaView({
  connection,
  state,
  selfSessionId,
  roomError = null,
}: {
  connection: RoomConnection;
  state: PongState;
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
    state.matchElapsedMs,
    [...state.players.values()]
      .map((player) => `${player.name}:${player.paddleCenter}:${player.score}`)
      .join("|"),
    [...state.balls.values()]
      .map((ball) => `${ball.id}:${ball.x}:${ball.y}:${ball.vx}:${ball.vy}:${ball.ownerSessionId}`)
      .join("|"),
  ].join("|");
  if (stateKeyRef.current !== stateKey) {
    stateKeyRef.current = stateKey;
    lastStateAtRef.current = performance.now();
  }

  const [now, setNow] = useState(() => Date.now());
  const [direction, setDirection] = useState<"left" | "right" | "none">("none");
  const directionRef = useRef<"left" | "right" | "none">("none");
  const activePointerIdRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const paddleErrorRef = useRef<number | null>(null);
  const [paddleError, setPaddleError] = useState<string | null>(null);
  const previousScoresRef = useRef("");
  const previousResultRef = useRef("");

  const local = state.players.get(selfSessionId);
  const canControl =
    (state.phase === "countdown" || state.phase === "running") &&
    local !== undefined &&
    local.connectionStatus === "connected";
  const players = [...state.players.values()].sort((a, b) => a.joinedOrder - b.joinedOrder);
  const maxScore = players.reduce((highest, player) => Math.max(highest, player.score), 0);
  const scoresSignature = players.map((player) => `${player.name}:${player.score}`).join("|");
  const resultSignature = `${state.phase}:${[...(state.result?.winnerSessionIds ?? [])].join("|")}`;

  useEffect(() => {
    if (previousScoresRef.current !== "" && scoresSignature !== previousScoresRef.current) {
      gameFeedback("confirm");
    }
    previousScoresRef.current = scoresSignature;
  }, [scoresSignature]);

  useEffect(() => {
    if (
      state.phase === "finished" &&
      resultSignature !== previousResultRef.current &&
      [...(state.result?.winnerSessionIds ?? [])].includes(selfSessionId)
    ) {
      gameFeedback("win");
    }
    previousResultRef.current = resultSignature;
  }, [resultSignature, selfSessionId, state.phase, state.result?.winnerSessionIds]);

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
      drawFrame(canvas, stateRef.current, selfSessionId, lastStateAtRef.current, time);
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
  }, [selfSessionId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const off = connection.room.onMessage(PONG_MESSAGE_TYPES.paddleRejected, (payload) => {
      const parsed = pongRejectionSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      gameFeedback("invalid");
      setPaddleError(
        parsed.data.reason === "rate-limited"
          ? "Moving too fast."
          : parsed.data.reason === "stale-sequence"
            ? "Out-of-date input ignored."
            : "Paddle input rejected.",
      );
      if (paddleErrorRef.current !== null) {
        window.clearTimeout(paddleErrorRef.current);
      }
      paddleErrorRef.current = window.setTimeout(() => setPaddleError(null), 1_000);
    });
    return () => {
      off();
      if (paddleErrorRef.current !== null) {
        window.clearTimeout(paddleErrorRef.current);
      }
    };
  }, [connection.room]);

  const sendMove = (value: number): void => {
    if (!canControl) {
      return;
    }
    sequenceRef.current += 1;
    connection.room.send(PONG_MESSAGE_TYPES.paddleMove, {
      type: "paddle_move",
      sequence: sequenceRef.current,
      target: value,
    });
  };

  const sendStop = (): void => {
    if (!canControl) {
      return;
    }
    sequenceRef.current += 1;
    connection.room.send(PONG_MESSAGE_TYPES.paddleStop, {
      type: "paddle_stop",
      sequence: sequenceRef.current,
    });
  };

  const directionForClientX = (clientX: number, rect: DOMRect): "left" | "right" | "none" => {
    if (rect.width <= 0) {
      return directionRef.current;
    }
    const offset = (clientX - rect.left) / rect.width - 0.5;
    // Small deadzone around the invisible centre line prevents jitter.
    if (offset < -0.03) {
      return "left";
    }
    if (offset > 0.03) {
      return "right";
    }
    return "none";
  };

  const applyDirection = (next: "left" | "right" | "none"): void => {
    if (next === directionRef.current) {
      return;
    }
    directionRef.current = next;
    setDirection(next);
    if (next === "left") {
      sendMove(0);
    } else if (next === "right") {
      sendMove(1);
    } else {
      sendStop();
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!canControl) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, [role='button']")) {
      return;
    }
    if (activePointerIdRef.current !== null) {
      return;
    }
    primeGameFeedback();
    gameFeedback("select");
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events cannot be captured; direction state still works.
    }
    activePointerIdRef.current = event.pointerId;
    applyDirection(directionForClientX(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }
    applyDirection(directionForClientX(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }
    activePointerIdRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Capture may already be released or unsupported.
    }
    directionRef.current = "none";
    setDirection("none");
    sendStop();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!canControl) {
      return;
    }
    if (
      event.key === "ArrowLeft" ||
      event.key === "Home" ||
      event.key === "a" ||
      event.key === "A"
    ) {
      applyDirection("left");
    } else if (
      event.key === "ArrowRight" ||
      event.key === "End" ||
      event.key === "d" ||
      event.key === "D"
    ) {
      applyDirection("right");
    } else {
      return;
    }
    event.preventDefault();
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "a" ||
      event.key === "d" ||
      event.key === "A" ||
      event.key === "D"
    ) {
      directionRef.current = "none";
      setDirection("none");
      sendStop();
    }
  };

  const countdownRemainingMs = state.countdownEndsAt - now;
  const countdownLabel =
    countdownRemainingMs <= 450
      ? "GO!"
      : String(Math.max(1, Math.ceil(countdownRemainingMs / 1000)));
  const movingBalls = [...state.balls.values()].filter((ball) => ball.spawnState === "moving");
  const ballsData = movingBalls.map((ball) => ({
    id: ball.id,
    x: ball.x,
    y: ball.y,
    owner: ball.ownerSessionId,
  }));
  const scoresData = players.map((player) => ({ name: player.name, score: player.score }));
  const winnersData = [...(state.result?.winnerSessionIds ?? [])];

  return (
    <Box
      component="main"
      role="slider"
      aria-label="Paddle target"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={direction === "left" ? 0 : direction === "right" ? 100 : 50}
      aria-valuetext={
        direction === "left" ? "Moving left" : direction === "right" ? "Moving right" : "Neutral"
      }
      aria-disabled={!canControl}
      tabIndex={canControl ? 0 : -1}
      data-testid="pong-arena"
      data-phase={state.phase}
      data-local-edge={local?.worldEdge ?? ""}
      data-paddle-center={local?.paddleCenter ?? ""}
      data-paddle-min={local?.paddleMin ?? ""}
      data-paddle-max={local?.paddleMax ?? ""}
      data-direction={direction}
      data-balls={JSON.stringify(ballsData)}
      data-scores={JSON.stringify(scoresData)}
      data-winners={JSON.stringify(winnersData)}
      data-ball-count={state.balls.size}
      data-player-count={state.players.size}
      data-desired-ball-count={state.desiredBallCount}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100%",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        outline: "none",
      }}
    >
      <Paper
        square
        component="header"
        sx={{
          p: 1,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700, mr: 0.5 }}>
          First to {PONG_CONSTANTS.TARGET_SCORE}
        </Typography>
        <Box
          aria-live="polite"
          data-testid="pong-scores"
          sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, flex: 1 }}
        >
          {[...state.players.entries()]
            .sort(([, a], [, b]) => a.joinedOrder - b.joinedOrder)
            .map(([sessionId, player]) => (
              <Paper
                key={sessionId}
                variant="outlined"
                sx={{
                  px: 1,
                  py: 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  borderColor: player === local ? player.color : undefined,
                }}
              >
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    bgcolor: player.color || "#ffffff",
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {player.name}
                  {player === local ? " (you)" : ""}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  {player.score}
                </Typography>
                {player.score > 0 && player.score === maxScore && (
                  <Chip label="Lead" size="small" variant="outlined" sx={{ height: 20 }} />
                )}
                {state.lastGoalScorerSessionId === sessionId && now - state.lastGoalAt < 1_200 && (
                  <Chip label="+1" size="small" color="success" sx={{ height: 20 }} />
                )}
                {player.connectionStatus !== "connected" && (
                  <Chip label="Reconnecting…" size="small" variant="outlined" color="warning" />
                )}
              </Paper>
            ))}
        </Box>
        <ButtonLeave connection={connection} />
        <Box sx={{ width: "100%" }}>
          {roomError !== null && <Alert severity="error">{roomError}</Alert>}
          {paddleError !== null && (
            <Alert severity="warning" aria-live="polite">
              {paddleError}
            </Alert>
          )}
          <Typography
            variant="body2"
            align="center"
            aria-live="polite"
            data-testid="pong-control-status"
          >
            {paddleError ??
              (canControl
                ? direction === "none"
                  ? "Touch anywhere — left of centre moves left, right of centre moves right."
                  : "Release to stop moving."
                : state.phase === "finished"
                  ? "Match finished."
                  : "Reconnecting…")}
          </Typography>
        </Box>
      </Paper>

      <Box
        ref={containerRef}
        sx={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Four-Sided Pong arena with every player's paddle and ball"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        {state.phase === "countdown" && (
          <HowToPlay
            title="How to play Four-Sided Pong"
            points={[
              "Touch anywhere on the screen to steer your paddle.",
              "Left of the invisible centre moves left; right of it moves right.",
              "Return the balls and colour them yours.",
              "You score when a ball you last touched enters another player's goal.",
              "First to 10 wins.",
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
              bgcolor: "rgba(0, 0, 0, 0.4)",
              zIndex: 10,
              p: 3,
              pointerEvents: "none",
            }}
          >
            <Paper sx={{ p: 3, textAlign: "center", minWidth: 220 }}>
              <Typography component="h1" variant="h1">
                Get ready
              </Typography>
              <Typography
                component="h2"
                variant="h2"
                aria-live="polite"
                sx={{ mt: 1, fontSize: "2.5rem", fontWeight: 800 }}
              >
                {countdownLabel}
              </Typography>
              <Typography color="text.secondary">
                You defend the {local?.worldEdge} edge.
              </Typography>
            </Paper>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function ButtonLeave({ connection }: { connection: RoomConnection }) {
  return (
    <Button
      type="button"
      size="small"
      variant="text"
      sx={{ ml: "auto" }}
      onClick={() => connection.leave()}
    >
      Leave
    </Button>
  );
}
