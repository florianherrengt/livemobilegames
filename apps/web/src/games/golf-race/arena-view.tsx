import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import {
  expandGolfHazard,
  GOLF_COURSE,
  GOLF_MAX_DRAG_PX,
  GOLF_MESSAGE_TYPES,
  type GolfRaceState,
  golfHazardGrowthForRound,
  golfShotRejectionSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { gameFeedback, hapticFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";

const VIEW_WIDTH = 560;
const VIEW_HEIGHT = 840;
const MIN_DRAG_PX = 16;

type Camera = {
  x: number;
  y: number;
  scale: number;
};

type AimVector = {
  x: number;
  y: number;
};

function hexToRgb(hex: string): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255})`;
}

function computeCamera(
  canvasWidth: number,
  canvasHeight: number,
  targetX: number,
  targetY: number,
): Camera {
  const scale = Math.min(canvasWidth / VIEW_WIDTH, canvasHeight / VIEW_HEIGHT);
  const halfViewWidth = canvasWidth / scale / 2;
  const halfViewHeight = canvasHeight / scale / 2;
  const x = Math.max(halfViewWidth, Math.min(targetX, GOLF_COURSE.world.width - halfViewWidth));
  const y = Math.max(halfViewHeight, Math.min(targetY, GOLF_COURSE.world.height - halfViewHeight));
  return { x, y, scale };
}

function drawFrame(
  canvas: HTMLCanvasElement,
  state: GolfRaceState,
  selfSessionId: string,
  camera: Camera,
  aim: AimVector,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const toScreen = (x: number, y: number): { x: number; y: number } => ({
    x: (x - camera.x) * camera.scale + rect.width / 2,
    y: (y - camera.y) * camera.scale + rect.height / 2,
  });

  ctx.fillStyle = "#050a14";
  ctx.fillRect(0, 0, rect.width, rect.height);

  const worldTopLeft = toScreen(0, 0);
  const worldBottomRight = toScreen(GOLF_COURSE.world.width, GOLF_COURSE.world.height);
  ctx.fillStyle = "#143a26";
  ctx.fillRect(
    worldTopLeft.x,
    worldTopLeft.y,
    worldBottomRight.x - worldTopLeft.x,
    worldBottomRight.y - worldTopLeft.y,
  );

  ctx.save();
  ctx.translate(0, 0);
  const hazardGrowth = golfHazardGrowthForRound(state.roundNumber);
  const hazards = GOLF_COURSE.hazards.map((hazard) => expandGolfHazard(hazard, hazardGrowth));
  for (const hazard of hazards) {
    const topLeft = toScreen(
      hazard.kind === "rect" ? hazard.x : hazard.x - hazard.radius,
      hazard.kind === "rect" ? hazard.y : hazard.y - hazard.radius,
    );
    const size =
      hazard.kind === "rect"
        ? { width: hazard.width * camera.scale, height: hazard.height * camera.scale }
        : { width: hazard.radius * 2 * camera.scale, height: hazard.radius * 2 * camera.scale };
    ctx.fillStyle = "#1f5f8b";
    ctx.beginPath();
    if (hazard.kind === "rect") {
      ctx.fillRect(topLeft.x, topLeft.y, size.width, size.height);
    } else {
      ctx.arc(
        topLeft.x + size.width / 2,
        topLeft.y + size.height / 2,
        size.width / 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  for (const respawn of GOLF_COURSE.respawnPositions) {
    const point = toScreen(respawn.x, respawn.y);
    const size = 14 * camera.scale;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
    ctx.setLineDash([]);
  }

  const finishStart = toScreen(GOLF_COURSE.finishLine.x1, GOLF_COURSE.finishLine.y1);
  const finishEnd = toScreen(GOLF_COURSE.finishLine.x2, GOLF_COURSE.finishLine.y2);
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = Math.max(4, 10 * camera.scale);
  ctx.beginPath();
  ctx.moveTo(finishStart.x, finishStart.y);
  ctx.lineTo(finishEnd.x, finishEnd.y);
  ctx.stroke();
  ctx.strokeStyle = "#0f1720";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(finishStart.x, finishStart.y);
  ctx.lineTo(finishEnd.x, finishEnd.y);
  ctx.stroke();

  for (const wall of GOLF_COURSE.walls) {
    const start = toScreen(wall.x1, wall.y1);
    const end = toScreen(wall.x2, wall.y2);
    ctx.strokeStyle = "#cfd8dc";
    ctx.lineWidth = Math.max(4, 8 * camera.scale);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (const obstacle of GOLF_COURSE.obstacles) {
    ctx.fillStyle = "#52606b";
    ctx.strokeStyle = "#0f1720";
    ctx.lineWidth = 2;
    if (obstacle.kind === "rect") {
      const topLeft = toScreen(obstacle.x, obstacle.y);
      ctx.fillRect(
        topLeft.x,
        topLeft.y,
        obstacle.width * camera.scale,
        obstacle.height * camera.scale,
      );
      ctx.strokeRect(
        topLeft.x,
        topLeft.y,
        obstacle.width * camera.scale,
        obstacle.height * camera.scale,
      );
    } else {
      const center = toScreen(obstacle.x, obstacle.y);
      ctx.beginPath();
      ctx.arc(center.x, center.y, obstacle.radius * camera.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();

  const orderedPlayers = [...state.players.values()]
    .filter((player) => player.connectionStatus !== "disconnected")
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
  for (const player of orderedPlayers) {
    const point = toScreen(player.positionX, player.positionY);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 18 * camera.scale, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgb(player.color || "#ffffff");
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (player.collisionImmune) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 24 * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (player.finished) {
      ctx.fillStyle = "#f5c518";
      ctx.beginPath();
      ctx.moveTo(point.x + 12 * camera.scale, point.y - 14 * camera.scale);
      ctx.lineTo(point.x + 26 * camera.scale, point.y - 8 * camera.scale);
      ctx.lineTo(point.x + 12 * camera.scale, point.y - 2 * camera.scale);
      ctx.closePath();
      ctx.fill();
    }
  }

  const local = state.players.get(selfSessionId);
  const localAiming =
    state.phase === "aiming" && state.currentTurnSessionId === selfSessionId && local !== undefined;
  if (localAiming) {
    const point = toScreen(local.positionX, local.positionY);
    const magnitude = Math.hypot(aim.x, aim.y);
    const length = 18 + (Math.min(magnitude, GOLF_MAX_DRAG_PX) / GOLF_MAX_DRAG_PX) * 70;
    const direction =
      magnitude === 0 ? { x: 0, y: -1 } : { x: -aim.x / magnitude, y: -aim.y / magnitude };
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + aim.x * 0.4, point.y + aim.y * 0.4);
    ctx.stroke();

    const arrowEnd = {
      x: point.x + direction.x * length * camera.scale,
      y: point.y + direction.y * length * camera.scale,
    };
    ctx.strokeStyle = "#f5c518";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(arrowEnd.x, arrowEnd.y);
    ctx.stroke();
    const angle = Math.atan2(direction.y, direction.x);
    ctx.fillStyle = "#f5c518";
    ctx.beginPath();
    ctx.moveTo(arrowEnd.x, arrowEnd.y);
    ctx.lineTo(
      arrowEnd.x - Math.cos(angle - 0.5) * 12 * camera.scale,
      arrowEnd.y - Math.sin(angle - 0.5) * 12 * camera.scale,
    );
    ctx.lineTo(
      arrowEnd.x - Math.cos(angle + 0.5) * 12 * camera.scale,
      arrowEnd.y - Math.sin(angle + 0.5) * 12 * camera.scale,
    );
    ctx.closePath();
    ctx.fill();
  }
}

export function ArenaView({
  connection,
  state,
  selfSessionId,
  roomError = null,
}: {
  connection: RoomConnection;
  state: GolfRaceState;
  selfSessionId: string;
  roomError?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cameraRef = useRef<Camera | null>(null);
  const cameraTargetRef = useRef(selfSessionId);
  const aimRef = useRef<AimVector>({ x: 0, y: 90 });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const sequenceRef = useRef(0);
  const shotErrorTimerRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dragging, setDragging] = useState(false);
  const [shotError, setShotError] = useState<string | null>(null);
  const [showHowTo, setShowHowTo] = useState(state.roundNumber === 1);
  const mountedRef = useRef(false);
  const previousTurnSessionRef = useRef("");
  const previousImmuneRef = useRef(new Map<string, boolean>());
  const previousSpeedsRef = useRef(new Map<string, number>());
  const selfFinishedRef = useRef(false);
  const turnKeyRef = useRef("");

  const local = state.players.get(selfSessionId);
  const isLocalTurn =
    state.phase === "aiming" &&
    state.currentTurnSessionId === selfSessionId &&
    local !== undefined &&
    !local.finished;
  const activePlayer = state.players.get(state.currentTurnSessionId);
  const secondsLeft =
    state.phase === "aiming" ? Math.max(0, Math.ceil((state.aimingEndsAt - now) / 1000)) : 0;
  useEffect(() => {
    if (state.roundNumber !== 1) {
      setShowHowTo(false);
      return;
    }
    setShowHowTo(true);
    const timer = window.setTimeout(() => setShowHowTo(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [state.roundNumber]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const localTurn = state.phase === "aiming" && state.currentTurnSessionId === selfSessionId;
    if (!localTurn) {
      dragStartRef.current = null;
      dragCurrentRef.current = null;
      setDragging(false);
      return;
    }
    const turnKey = `${state.roundNumber}:${state.currentTurnSessionId}`;
    if (turnKeyRef.current !== turnKey) {
      turnKeyRef.current = turnKey;
      aimRef.current = { x: 0, y: 90 };
    }
  }, [state.phase, state.currentTurnSessionId, state.roundNumber, selfSessionId]);

  useEffect(() => {
    const listener = (): void => {
      const current = stateRef.current;
      const localPlayer = current.players.get(selfSessionId);
      if (mountedRef.current) {
        if (
          current.phase === "aiming" &&
          current.currentTurnSessionId === selfSessionId &&
          previousTurnSessionRef.current !== selfSessionId
        ) {
          gameFeedback("select");
        }
        for (const [sessionId, player] of current.players) {
          const wasImmune = previousImmuneRef.current.get(sessionId) ?? false;
          if (player.collisionImmune && !wasImmune) {
            gameFeedback("danger");
          }
          previousImmuneRef.current.set(sessionId, player.collisionImmune);

          const speed = Math.hypot(player.velocityX, player.velocityY);
          const previousSpeed = previousSpeedsRef.current.get(sessionId) ?? 0;
          if (
            current.phase === "simulating" &&
            previousSpeed > 180 &&
            speed < previousSpeed * 0.55
          ) {
            gameFeedback("select");
          }
          previousSpeedsRef.current.set(sessionId, speed);
        }
        if (localPlayer?.finished && !selfFinishedRef.current) {
          gameFeedback(localPlayer.finishedRank === 1 ? "win" : "confirm");
        }
      }
      previousTurnSessionRef.current = current.currentTurnSessionId;
      selfFinishedRef.current = localPlayer?.finished ?? false;
      mountedRef.current = true;
    };
    connection.room.onStateChange(listener);
    return () => connection.room.onStateChange.remove(listener);
  }, [connection.room, selfSessionId]);

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
      if (cameraRef.current === null) {
        const target = stateRef.current.players.get(cameraTargetRef.current);
        cameraRef.current = computeCamera(
          rect.width,
          rect.height,
          target?.positionX ?? GOLF_COURSE.startingPositions[0]?.x ?? 0,
          target?.positionY ?? GOLF_COURSE.startingPositions[0]?.y ?? 0,
        );
      }
    };
    const draw = (): void => {
      const rect = container.getBoundingClientRect();
      const current = stateRef.current;
      if (current.phase === "aiming") {
        cameraTargetRef.current = current.currentTurnSessionId || cameraTargetRef.current;
        const target = current.players.get(cameraTargetRef.current);
        if (target) {
          cameraRef.current = computeCamera(
            rect.width,
            rect.height,
            target.positionX,
            target.positionY,
          );
        }
      } else {
        const target =
          current.players.get(cameraTargetRef.current) ?? [...current.players.values()][0];
        if (target && cameraRef.current) {
          const desired = computeCamera(
            rect.width,
            rect.height,
            target.positionX,
            target.positionY,
          );
          const reduced =
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const blend = reduced || current.phase === "countdown" ? 1 : 0.12;
          cameraRef.current = {
            x: cameraRef.current.x + (desired.x - cameraRef.current.x) * blend,
            y: cameraRef.current.y + (desired.y - cameraRef.current.y) * blend,
            scale: desired.scale,
          };
        }
      }
      if (cameraRef.current) {
        canvas.dataset.cameraX = cameraRef.current.x.toFixed(1);
        canvas.dataset.cameraY = cameraRef.current.y.toFixed(1);
        canvas.dataset.scale = cameraRef.current.scale.toFixed(4);
        drawFrame(canvas, current, selfSessionId, cameraRef.current, aimRef.current);
      }
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
    const off = connection.room.onMessage(GOLF_MESSAGE_TYPES.shotRejected, (payload) => {
      const parsed = golfShotRejectionSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      gameFeedback("invalid");
      setShotError(
        parsed.data.reason === "below-minimum-power"
          ? "Drag further before releasing."
          : parsed.data.reason === "not-your-turn" || parsed.data.reason === "not-aiming"
            ? "It is not your turn."
            : parsed.data.reason === "timer-expired"
              ? "Time ran out before your shot."
              : "Shot rejected.",
      );
      if (shotErrorTimerRef.current !== null) {
        window.clearTimeout(shotErrorTimerRef.current);
      }
      shotErrorTimerRef.current = window.setTimeout(() => setShotError(null), 1_200);
    });
    return () => {
      off();
      if (shotErrorTimerRef.current !== null) {
        window.clearTimeout(shotErrorTimerRef.current);
      }
    };
  }, [connection.room]);

  const releaseShot = (aim: AimVector): void => {
    const current = stateRef.current;
    const currentLocal = current.players.get(selfSessionId);
    if (
      current.phase !== "aiming" ||
      current.currentTurnSessionId !== selfSessionId ||
      !currentLocal ||
      currentLocal.finished
    ) {
      return;
    }
    sequenceRef.current += 1;
    gameFeedback("move");
    connection.room.send(GOLF_MESSAGE_TYPES.shot, {
      type: "shot",
      sequence: sequenceRef.current,
      roundNumber: current.roundNumber,
      aimX: aim.x,
      aimY: aim.y,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!isLocalTurn) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    void primeGameFeedback();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragCurrentRef.current = { x: event.clientX, y: event.clientY };
    aimRef.current = { x: 0, y: 0 };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragStartRef.current === null) {
      return;
    }
    dragCurrentRef.current = { x: event.clientX, y: event.clientY };
    const dx = dragCurrentRef.current.x - dragStartRef.current.x;
    const dy = dragCurrentRef.current.y - dragStartRef.current.y;
    const magnitude = Math.hypot(dx, dy);
    const clamped = Math.min(magnitude, GOLF_MAX_DRAG_PX);
    const factor = magnitude === 0 ? 0 : clamped / magnitude;
    aimRef.current = { x: dx * factor, y: dy * factor };
  };

  const handlePointerUp = (_event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragStartRef.current === null) {
      return;
    }
    const aim = { ...aimRef.current };
    dragStartRef.current = null;
    dragCurrentRef.current = null;
    setDragging(false);
    if (Math.hypot(aim.x, aim.y) < MIN_DRAG_PX) {
      return;
    }
    hapticFeedback("select");
    releaseShot(aim);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!isLocalTurn) {
      return;
    }
    const step = 24;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      aimRef.current = clampAim({ ...aimRef.current, y: aimRef.current.y - step });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      aimRef.current = clampAim({ ...aimRef.current, y: aimRef.current.y + step });
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      aimRef.current = clampAim({ ...aimRef.current, x: aimRef.current.x - step });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      aimRef.current = clampAim({ ...aimRef.current, x: aimRef.current.x + step });
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      hapticFeedback("select");
      releaseShot(aimRef.current);
    }
  };

  const spectating =
    state.phase !== "countdown" &&
    (state.phase !== "aiming" || state.currentTurnSessionId !== selfSessionId);
  const turnOrder = [...state.turnOrder];
  const localTurnIndex = turnOrder.indexOf(selfSessionId);
  const localTurnsUntilTurn =
    localTurnIndex >= state.turnIndex ? localTurnIndex - state.turnIndex : null;

  return (
    <Box
      component="main"
      sx={{ position: "relative", height: "100dvh", width: "100%", overflow: "hidden" }}
    >
      <Box
        ref={containerRef}
        role="application"
        aria-label="Golf course"
        tabIndex={0}
        data-testid="golf-race-arena"
        data-phase={state.phase}
        data-round={state.roundNumber}
        data-round-ends-at={state.roundEndsAt}
        data-current-turn={state.currentTurnSessionId}
        data-self-session={selfSessionId}
        data-local-connection={local?.connectionStatus ?? ""}
        data-spectating={String(spectating)}
        data-ball-positions={JSON.stringify(
          [...state.players.entries()].map(([sessionId, player]) => ({
            sessionId,
            name: player.name,
            x: player.positionX,
            y: player.positionY,
          })),
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        sx={{
          position: "absolute",
          inset: 0,
          touchAction: "none",
          outline: "none",
          "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main" },
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </Box>

      <Paper
        square
        component="header"
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 5,
          px: 1.5,
          py: 1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 1,
          bgcolor: "rgba(5, 10, 20, 0.78)",
          color: "#fff",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Round {state.roundNumber}/{state.totalRounds}
        </Typography>
        <Typography variant="body2" aria-live="polite" sx={{ fontWeight: 700 }}>
          {state.phase === "countdown"
            ? "Get ready…"
            : state.phase === "aiming"
              ? `${activePlayer?.name ?? "A player"}'s turn`
              : state.phase === "simulating"
                ? "Shot in motion…"
                : "Golf Race"}
        </Typography>
        {state.phase === "aiming" && (
          <Chip
            label={`${secondsLeft}s`}
            size="small"
            sx={{ fontVariantNumeric: "tabular-nums" }}
            aria-label={`${secondsLeft} seconds left to shoot`}
          />
        )}
      </Paper>

      {state.finishedCount > 0 && state.phase !== "finished" && (
        <Paper
          square
          sx={{
            position: "absolute",
            top: 48,
            left: 0,
            right: 0,
            zIndex: 5,
            px: 1.5,
            py: 0.5,
            bgcolor: "rgba(5, 10, 20, 0.7)",
            color: "#fff",
          }}
        >
          <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            Finished:{" "}
            {[...state.players.values()]
              .filter((player) => player.finished)
              .sort((a, b) => a.finishedRank - b.finishedRank)
              .map((player) => `#${player.finishedRank} ${player.name}`)
              .join(", ")}
          </Typography>
        </Paper>
      )}

      {state.phase === "countdown" && showHowTo && (
        <HowToPlay
          title="How to play Golf Race"
          points={[
            "Drag your ball backward like a slingshot, then release to shoot.",
            "Drag distance controls power; you can aim in any direction.",
            "The ball furthest behind plays first each round.",
            "Cross every gate, avoid hazards, and reach the finish line first.",
          ]}
        />
      )}

      {isLocalTurn && (
        <Paper
          square
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 5,
            px: 1.5,
            py: 1,
            bgcolor: "rgba(5, 10, 20, 0.78)",
            color: "#fff",
          }}
        >
          <Stack spacing={0.5}>
            <Typography variant="body2" aria-live="polite">
              {dragging
                ? `Aiming: ${Math.round(Math.hypot(aimRef.current.x, aimRef.current.y))} px power`
                : "Drag to aim, release to shoot. Keyboard: arrows aim, Space shoots."}
            </Typography>
            {shotError !== null && <Alert severity="warning">{shotError}</Alert>}
          </Stack>
        </Paper>
      )}

      {spectating && state.phase !== "countdown" && (
        <Chip
          label="Spectating"
          size="small"
          sx={{
            position: "absolute",
            top: 56,
            right: 12,
            zIndex: 5,
            bgcolor: "rgba(5, 10, 20, 0.78)",
            color: "#fff",
          }}
        />
      )}

      {spectating &&
        state.phase !== "countdown" &&
        localTurnsUntilTurn !== null &&
        localTurnsUntilTurn >= 0 && (
          <Chip
            label={`You play in ${localTurnsUntilTurn + 1}`}
            size="small"
            sx={{
              position: "absolute",
              top: 84,
              right: 12,
              zIndex: 5,
              bgcolor: "rgba(5, 10, 20, 0.78)",
              color: "#fff",
            }}
          />
        )}

      {roomError !== null && (
        <Alert
          severity="error"
          sx={{ position: "absolute", top: 56, left: 12, right: 12, zIndex: 6 }}
        >
          {roomError}
        </Alert>
      )}
    </Box>
  );
}

function clampAim(aim: AimVector): AimVector {
  const magnitude = Math.hypot(aim.x, aim.y);
  if (magnitude <= GOLF_MAX_DRAG_PX) {
    return aim;
  }
  const factor = GOLF_MAX_DRAG_PX / magnitude;
  return { x: aim.x * factor, y: aim.y * factor };
}
