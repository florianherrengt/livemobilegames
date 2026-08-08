import { Alert, Box, Chip, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import {
  MEMORY_PATH_CONSTANTS,
  MEMORY_PATH_MESSAGE_TYPES,
  type MemoryPathState,
  memoryPathMoveRejectionSchema,
} from "@phone-party/protocol";
import { useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { gameFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";
import { MovementStick } from "./movement-stick.js";

const CONFIG = MEMORY_PATH_CONSTANTS;

function drawFrame(
  canvas: HTMLCanvasElement,
  state: MemoryPathState,
  selfSessionId: string,
  now: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const scale = Math.min(rect.width / CONFIG.WORLD_WIDTH, rect.height / CONFIG.WORLD_HEIGHT);
  const offsetX = (rect.width - CONFIG.WORLD_WIDTH * scale) / 2;
  const offsetY = (rect.height - CONFIG.WORLD_HEIGHT * scale) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  drawBackground(ctx);
  drawLandmarks(ctx, state);
  drawStartAndFinish(ctx, state);
  if (state.pathVisible) {
    drawPath(ctx, state);
  }
  drawPlayers(ctx, state, selfSessionId, now);
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, CONFIG.WORLD_HEIGHT);
  gradient.addColorStop(0, "#0d141c");
  gradient.addColorStop(1, "#18232f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
}

function drawLandmarks(ctx: CanvasRenderingContext2D, state: MemoryPathState): void {
  for (const landmark of state.landmarks) {
    ctx.fillStyle = landmark.color;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 2;
    if (landmark.shape === "circle") {
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, landmark.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (landmark.shape === "square") {
      ctx.fillRect(
        landmark.x - landmark.size / 2,
        landmark.y - landmark.size / 2,
        landmark.size,
        landmark.size,
      );
      ctx.strokeRect(
        landmark.x - landmark.size / 2,
        landmark.y - landmark.size / 2,
        landmark.size,
        landmark.size,
      );
    } else {
      ctx.beginPath();
      ctx.moveTo(landmark.x, landmark.y - landmark.size);
      ctx.lineTo(landmark.x + landmark.size, landmark.y + landmark.size * 0.8);
      ctx.lineTo(landmark.x - landmark.size, landmark.y + landmark.size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawStartAndFinish(ctx: CanvasRenderingContext2D, state: MemoryPathState): void {
  ctx.save();
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "rgba(76, 194, 255, 0.16)";
  ctx.strokeStyle = "rgba(76, 194, 255, 0.9)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(state.startX, state.startY, state.startRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#bfeaff";
  ctx.fillText("START", state.startX, state.startY + state.startRadius + 16);

  ctx.fillStyle = "rgba(244, 162, 97, 0.18)";
  ctx.strokeStyle = "rgba(244, 162, 97, 0.95)";
  ctx.beginPath();
  ctx.arc(state.finishX, state.finishY, state.finishRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffe0c2";
  ctx.fillText("FINISH", state.finishX, state.finishY - state.finishRadius - 14);
  ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, state: MemoryPathState): void {
  const points = [...state.routePoints];
  if (points.length < 2) {
    return;
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0]?.x ?? 0, points[0]?.y ?? 0);
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (point) {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = state.pathWidth + 8;
  ctx.stroke();
  ctx.strokeStyle = "#2dd4a7";
  ctx.lineWidth = state.pathWidth;
  ctx.stroke();
  ctx.restore();
}

function drawPlayers(
  ctx: CanvasRenderingContext2D,
  state: MemoryPathState,
  selfSessionId: string,
  now: number,
): void {
  for (const [sessionId, player] of state.players) {
    const isSelf = sessionId === selfSessionId;
    if (!isSelf && !state.opponentsVisible) {
      continue;
    }
    let radius = CONFIG.PLAYER_DIAMETER / 2;
    let alpha = 1;
    if (player.falling && player.respawnEndsAt > 0) {
      const fallProgress = Math.min(
        1,
        Math.max(0, 1 - (player.respawnEndsAt - now) / CONFIG.RESPAWN_DELAY_MS),
      );
      radius *= 1 - fallProgress * 0.75;
      alpha = 1 - fallProgress * 0.7;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = player.color || "#ffffff";
    ctx.strokeStyle = isSelf ? "#ffffff" : "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = isSelf ? 4 : 2;
    ctx.beginPath();
    ctx.arc(player.positionX, player.positionY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (player.finished) {
      ctx.beginPath();
      ctx.arc(player.positionX, player.positionY, radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (isSelf) {
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(player.name, player.positionX, player.positionY + radius + 6);
    }
    ctx.restore();
  }
}

function canMove(state: MemoryPathState, selfSessionId: string): boolean {
  const local = state.players.get(selfSessionId);
  return (
    state.phase === "racing" &&
    local !== undefined &&
    local.connectionStatus === "connected" &&
    local.participating &&
    local.roundActive &&
    !local.falling &&
    !local.finished
  );
}

function roundResultHeadline(state: MemoryPathState): string {
  const result = state.roundResult;
  if (!result) {
    return "";
  }
  const winner = result.winnerLabel || "Nobody";
  if (result.reason === "timeout") {
    return `${winner} wins — reached ${result.winnerProgress}% of the path.`;
  }
  return `${winner} reached the finish first.`;
}

export function MemoryPathArenaView({
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sequenceRef = useRef(0);
  const keysRef = useRef(new Set<string>());
  const moveErrorTimerRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showHowTo, setShowHowTo] = useState(state.phase === "preview" && state.roundNumber === 1);

  const local = state.players.get(selfSessionId);
  const movingEnabled = !connection.reconnecting && canMove(state, selfSessionId);
  const isSpectator = local !== undefined && !local.participating && state.phase !== "lobby";
  const wasFallingRef = useRef(local?.falling ?? false);
  const wasRoundResultRef = useRef(false);
  const roundWinnersSnapshot = [...(state.roundResult?.winnerSessionIds ?? [])].join("|");

  const sendMove = (x: number, y: number): void => {
    const current = stateRef.current;
    if (connection.reconnecting || !canMove(current, selfSessionId)) {
      return;
    }
    sequenceRef.current += 1;
    connection.room.send(MEMORY_PATH_MESSAGE_TYPES.move, {
      type: "move",
      sequence: sequenceRef.current,
      roundNumber: current.roundNumber,
      x,
      y,
    });
  };
  const sendMoveRef = useRef(sendMove);
  sendMoveRef.current = sendMove;

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
    const draw = (): void => {
      drawFrame(canvas, stateRef.current, selfSessionId, Date.now());
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
    if (state.phase === "preview" && state.roundNumber === 1) {
      setShowHowTo(true);
      const timer = window.setTimeout(() => setShowHowTo(false), 2_500);
      return () => window.clearTimeout(timer);
    }
    setShowHowTo(false);
    return undefined;
  }, [state.phase, state.roundNumber]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      ) {
        return;
      }
      event.preventDefault();
      keysRef.current.add(event.key);
      applyKeys();
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      ) {
        return;
      }
      keysRef.current.delete(event.key);
      applyKeys();
    };
    const applyKeys = (): void => {
      const keys = keysRef.current;
      const x = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
      const y = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
      if (x === 0 && y === 0) {
        sendMoveRef.current(0, 0);
      } else {
        sendMoveRef.current(x, y);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const off = connection.room.onMessage(MEMORY_PATH_MESSAGE_TYPES.moveRejected, (payload) => {
      const parsed = memoryPathMoveRejectionSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      gameFeedback("invalid");
      setMoveError(parsed.data.reason === "rate-limited" ? "Moving too fast." : "Move rejected.");
      if (moveErrorTimerRef.current !== null) {
        window.clearTimeout(moveErrorTimerRef.current);
      }
      moveErrorTimerRef.current = window.setTimeout(() => setMoveError(null), 1_000);
    });
    return () => {
      off();
      if (moveErrorTimerRef.current !== null) {
        window.clearTimeout(moveErrorTimerRef.current);
      }
    };
  }, [connection.room]);

  useEffect(() => {
    // E2E-only driver hook: Playwright enables it with a sessionStorage flag
    // so the browser test can send real movement intents over the actual
    // Colyseus connection. Normal users never set the flag.
    if (
      typeof window !== "undefined" &&
      window.sessionStorage?.getItem("memory-path-e2e-driver") === "1"
    ) {
      const driverWindow = window as unknown as {
        __memoryPathRoom?: RoomConnection["room"];
      };
      driverWindow.__memoryPathRoom = connection.room;
      return () => {
        delete driverWindow.__memoryPathRoom;
      };
    }
    return undefined;
  }, [connection.room]);

  const currentFalling = local?.falling ?? false;
  useEffect(() => {
    if (!wasFallingRef.current && currentFalling) {
      gameFeedback("eliminated");
    }
    wasFallingRef.current = currentFalling;
  }, [currentFalling]);

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

  const previewRemaining = Math.max(0, Math.ceil((state.previewEndsAt - now) / 1000));
  const raceRemaining = Math.max(0, Math.ceil((state.raceEndsAt - now) / 1000));

  return (
    <Box
      component="main"
      sx={{ display: "flex", flexDirection: "column", height: "100dvh", width: "100%" }}
    >
      <Paper
        square
        component="header"
        sx={{
          p: 1,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {state.suddenDeath ? "Sudden death" : `Round ${state.roundNumber}/${state.totalRounds}`}
        </Typography>
        {state.phase === "racing" && (
          <Typography
            variant="body2"
            sx={{ fontWeight: 800, color: "primary.main" }}
            aria-live="polite"
            data-testid="memory-path-timer"
          >
            {raceRemaining}s
          </Typography>
        )}
        {state.phase === "preview" && (
          <Typography variant="body2" sx={{ fontWeight: 800 }} aria-live="polite">
            Memorize — {previewRemaining}s
          </Typography>
        )}
        {isSpectator && <Chip label="Spectating" size="small" variant="outlined" color="info" />}
        {local !== undefined &&
          (connection.reconnecting || local.connectionStatus !== "connected") && (
            <Chip label="Reconnecting…" size="small" variant="outlined" color="warning" />
          )}
        <Typography variant="body2" sx={{ ml: "auto", color: "text.secondary" }} aria-live="polite">
          {state.pathVisible && state.phase === "racing" ? "Path visible" : ""}
        </Typography>
      </Paper>

      <Paper
        square
        component="section"
        aria-label="Round progress"
        sx={{
          p: 1,
          display: "flex",
          gap: 1,
          overflowX: "auto",
          borderTop: 0,
          borderBottom: 0,
        }}
      >
        {[...state.players.entries()]
          .filter(([, player]) => player.participating || state.phase === "round-result")
          .sort(([, a], [, b]) => a.joinedOrder - b.joinedOrder)
          .map(([sessionId, player]) => {
            const isSelf = sessionId === selfSessionId;
            return (
              <Box
                key={sessionId}
                data-testid={`memory-path-progress-${sessionId}`}
                sx={{
                  minWidth: 74,
                  maxWidth: 110,
                  p: 0.5,
                  borderRadius: 2,
                  border: isSelf ? "2px solid" : "1px solid",
                  borderColor: isSelf ? "primary.main" : "divider",
                  bgcolor: "background.paper",
                }}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  <Box
                    aria-hidden
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: player.color || "#ffffff",
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="caption" noWrap sx={{ fontWeight: 700 }}>
                    {player.name}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={Math.round(player.progress * 100)}
                  sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
                  aria-label={`${player.name} progress ${Math.round(player.progress * 100)} percent`}
                />
              </Box>
            );
          })}
      </Paper>

      <Box
        ref={containerRef}
        data-testid="memory-path-arena"
        data-phase={state.phase}
        data-round={state.roundNumber}
        data-sudden-death={state.suddenDeath}
        data-path-visible={state.pathVisible}
        data-opponents-visible={state.opponentsVisible}
        data-can-move={movingEnabled}
        data-speed={state.movementSpeed}
        data-path-width={state.pathWidth}
        data-falling={local?.falling ?? false}
        data-winners={JSON.stringify([...(state.roundResult?.winnerSessionIds ?? [])])}
        data-route-points={JSON.stringify(
          [...state.routePoints].map((point) => [point.x, point.y]),
        )}
        data-local-x={local?.positionX ?? ""}
        data-local-y={local?.positionY ?? ""}
        sx={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Memory Path course with landmarks, the start and finish, and player characters"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        {showHowTo && state.phase === "preview" && (
          <HowToPlay
            title="How to play Memory Path"
            points={[
              "Memorize the route before it disappears.",
              "Drag the joystick or use the arrow keys to race from memory.",
              "Leave the hidden path and you return to the start.",
            ]}
          />
        )}

        {state.phase === "preparing" && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(0, 0, 0, 0.45)",
              zIndex: 10,
              pointerEvents: "none",
            }}
          >
            <Paper sx={{ p: 3, textAlign: "center", minWidth: 240 }}>
              <Typography component="h1" variant="h1">
                {state.suddenDeath ? "Sudden death" : `Round ${state.roundNumber}`}
              </Typography>
              <Typography component="h2" variant="h2" sx={{ mt: 1 }} aria-live="polite">
                Get ready…
              </Typography>
            </Paper>
          </Box>
        )}

        {state.phase === "round-result" && (
          <Box
            sx={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 10,
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <Paper sx={{ p: 2, textAlign: "center", maxWidth: 420, width: "100%" }}>
              <Typography component="h1" variant="h2" aria-live="polite">
                {state.suddenDeath ? "Sudden-death result" : `Round ${state.roundNumber} result`}
              </Typography>
              <Typography sx={{ mt: 0.5 }} aria-live="polite">
                {roundResultHeadline(state)}
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {[...state.players.entries()]
                  .sort(([, a], [, b]) => a.joinedOrder - b.joinedOrder)
                  .map(([sessionId, player]) => (
                    <Stack key={sessionId} direction="row" sx={{ justifyContent: "space-between" }}>
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

      <Paper square sx={{ p: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {roomError !== null && (
          <Alert severity="error" sx={{ width: "100%", mb: 1 }}>
            {roomError}
          </Alert>
        )}
        {local?.falling && (
          <Typography variant="body2" color="error" aria-live="polite" sx={{ mb: 0.5 }}>
            Back to the start…
          </Typography>
        )}
        {!movingEnabled && !local?.falling && !isSpectator && state.phase === "racing" && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }} aria-live="polite">
            {moveError ?? "Waiting for movement…"}
          </Typography>
        )}
        <MovementStick
          enabled={movingEnabled}
          onMove={(x, y) => {
            primeGameFeedback();
            sendMove(x, y);
          }}
          onRelease={() => sendMove(0, 0)}
        />
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 2 }}
          aria-live="polite"
          data-testid="memory-path-status"
        >
          {moveError ??
            (isSpectator
              ? "Spectating."
              : movingEnabled
                ? "Move with the joystick or arrow keys."
                : local?.falling
                  ? "Falling…"
                  : state.phase === "preview"
                    ? "Memorize the route. Movement starts when it disappears."
                    : state.phase === "preparing"
                      ? "Preparing the route…"
                      : "Movement is locked.")}
        </Typography>
      </Paper>
    </Box>
  );
}
