import { Alert, Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import {
  KART_RACING_CONSTANTS,
  KART_RACING_MESSAGE_TYPES,
  KART_RACING_TRACK,
  type KartRacingPlayerState,
  type KartRacingState,
  kartCommandRejectionSchema,
  nearestRoadPoint,
  pointAlongCenterline,
  trackTangent,
} from "@phone-party/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { gameFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";
import {
  type CameraState,
  cameraRotation,
  cameraScale,
  createCameraState,
  smoothCamera,
} from "./camera.js";
import { steeringFromOffset, swipeOutcome } from "./gesture.js";

const MAX_EXTRAPOLATION_MS = 80;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function extrapolatePosition(
  player: KartRacingPlayerState,
  deltaMs: number,
): { x: number; y: number } {
  const dt = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, deltaMs)) / 1000;
  return {
    x: player.kartX + Math.cos(player.kartHeading) * player.kartSpeed * dt,
    y: player.kartY + Math.sin(player.kartHeading) * player.kartSpeed * dt,
  };
}

function nearestCenterlineIndex(x: number, y: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < KART_RACING_TRACK.centerline.length; index++) {
    const point = KART_RACING_TRACK.centerline[index] ?? { x: 0, y: 0 };
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function lookaheadTarget(x: number, y: number): { x: number; y: number } {
  const nearest = nearestRoadPoint(KART_RACING_TRACK, { x, y });
  return pointAlongCenterline(KART_RACING_TRACK, nearestCenterlineIndex(nearest.x, nearest.y), 150);
}

function drawFrame(
  canvas: HTMLCanvasElement,
  state: KartRacingState,
  selfSessionId: string,
  camera: CameraState,
  time: number,
  lastStateAt: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const scale = cameraScale(rect.width, rect.height);
  const ahead = 56;
  ctx.save();
  ctx.translate(rect.width / 2, rect.height / 2 - ahead * scale);
  ctx.scale(scale, scale);
  ctx.rotate(cameraRotation(camera.heading));
  ctx.translate(-camera.x, -camera.y);

  drawWorld(ctx, state, selfSessionId, time, lastStateAt);
  ctx.restore();
}

function drawWorld(
  ctx: CanvasRenderingContext2D,
  state: KartRacingState,
  selfSessionId: string,
  time: number,
  lastStateAt: number,
): void {
  const track = KART_RACING_TRACK;
  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(-200, -200, 2100, 1700);

  // Fall zones (infield and bridge edges).
  ctx.fillStyle = "#101c33";
  for (const zone of track.fallZones) {
    ctx.beginPath();
    const first = zone.points[0];
    if (first === undefined) {
      continue;
    }
    ctx.moveTo(first.x, first.y);
    for (let index = 1; index < zone.points.length; index++) {
      const point = zone.points[index];
      if (point !== undefined) {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#2d4a7a";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Road ribbon.
  ctx.strokeStyle = "#2b313c";
  ctx.lineWidth = track.roadHalfWidth * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const firstPoint = track.centerline[0];
  if (firstPoint !== undefined) {
    ctx.moveTo(firstPoint.x, firstPoint.y);
  }
  for (let index = 1; index < track.centerline.length; index++) {
    const point = track.centerline[index];
    if (point !== undefined) {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.closePath();
  ctx.stroke();

  // Slow terrain.
  ctx.fillStyle = "rgba(214, 172, 79, 0.8)";
  for (const zone of track.slowZones) {
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
  }

  // Outer walls.
  ctx.strokeStyle = "#7d8590";
  ctx.lineWidth = KART_RACING_CONSTANTS.KART_RADIUS * 0.5 + 6;
  ctx.lineCap = "round";
  for (const wall of track.walls) {
    ctx.beginPath();
    ctx.moveTo(wall.from.x, wall.from.y);
    ctx.lineTo(wall.to.x, wall.to.y);
    ctx.stroke();
  }

  // Static obstacles.
  for (const obstacle of track.obstacles) {
    ctx.fillStyle = "#b5453d";
    ctx.beginPath();
    ctx.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f2d0a7";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#f2d0a7";
    ctx.beginPath();
    ctx.arc(obstacle.x, obstacle.y, obstacle.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // Checkpoint lines.
  ctx.strokeStyle = "rgba(120, 210, 255, 0.55)";
  ctx.lineWidth = 3;
  for (const checkpointIndex of track.checkpointIndexes) {
    const tangent = trackTangent(track, checkpointIndex);
    const point = track.centerline[checkpointIndex] ?? { x: 0, y: 0 };
    const px = -tangent.y;
    const py = tangent.x;
    ctx.beginPath();
    ctx.moveTo(point.x + px * track.roadHalfWidth, point.y + py * track.roadHalfWidth);
    ctx.lineTo(point.x - px * track.roadHalfWidth, point.y - py * track.roadHalfWidth);
    ctx.stroke();
  }

  // Finish line (checkered).
  const finishTangent = trackTangent(track, track.finishIndex);
  const finishPoint = track.centerline[track.finishIndex] ?? { x: 0, y: 0 };
  const fpx = -finishTangent.y;
  const fpy = finishTangent.x;
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#f8fafc";
  ctx.beginPath();
  ctx.moveTo(finishPoint.x + fpx * track.roadHalfWidth, finishPoint.y + fpy * track.roadHalfWidth);
  ctx.lineTo(finishPoint.x - fpx * track.roadHalfWidth, finishPoint.y - fpy * track.roadHalfWidth);
  ctx.stroke();
  ctx.strokeStyle = "#111827";
  ctx.setLineDash([16, 16]);
  ctx.stroke();
  ctx.setLineDash([]);

  const localPlayer = state.players.get(selfSessionId);
  const localCollected = new Set(localPlayer?.collectedCrateIds ?? []);
  const delta = state.phase === "racing" ? Math.max(0, time - lastStateAt) : 0;

  // Ammo crates (per-player availability).
  for (const crate of state.crates) {
    if (localCollected.has(crate.id)) {
      continue;
    }
    const pulse = 0.7 + 0.3 * Math.sin(time / 180);
    ctx.save();
    ctx.translate(crate.x, crate.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = `rgba(240, 173, 78, ${pulse})`;
    ctx.fillRect(-16, -16, 32, 32);
    ctx.strokeStyle = "#5c3a12";
    ctx.lineWidth = 3;
    ctx.strokeRect(-16, -16, 32, 32);
    ctx.restore();
    ctx.fillStyle = "#fff7e8";
    ctx.beginPath();
    ctx.arc(crate.x, crate.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Projectiles.
  for (const projectile of state.projectiles) {
    const alpha = Math.min(1, projectile.remainingMs / 200);
    ctx.fillStyle = `rgba(255, 226, 112, ${alpha})`;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 250, 220, 0.9)";
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Karts.
  for (const player of state.players.values()) {
    if (player.removed || !player.raceActive) {
      continue;
    }
    if (player.respawnRemainingMs > 0) {
      continue;
    }
    const position = extrapolatePosition(player, delta);
    drawKart(ctx, player, position.x, position.y, delta);
  }
}

function drawKart(
  ctx: CanvasRenderingContext2D,
  player: KartRacingPlayerState,
  x: number,
  y: number,
  delta: number,
): void {
  const color = player.color || "#ffffff";
  const rgb = hexToRgb(color);
  const alpha = player.finished ? 0.55 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(player.kartHeading);
  ctx.globalAlpha = alpha;

  ctx.fillStyle = `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 3;
  roundRect(ctx, -21, -14, 42, 28, 7);
  ctx.fill();
  ctx.stroke();

  // Front and windshield.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  roundRect(ctx, 8, -9, 10, 18, 3);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.moveTo(21, -5);
  ctx.lineTo(27, 0);
  ctx.lineTo(21, 5);
  ctx.closePath();
  ctx.fill();

  // Rear wheels.
  ctx.fillStyle = "#151a23";
  ctx.fillRect(-20, -17, 12, 6);
  ctx.fillRect(-20, 11, 12, 6);
  ctx.fillRect(8, -17, 10, 6);
  ctx.fillRect(8, 11, 10, 6);
  ctx.restore();

  // Immunity outline.
  if (player.immunityRemainingMs > 0) {
    const blink = 0.45 + 0.45 * Math.sin((performance.now() / 80) % (Math.PI * 2));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.kartHeading);
    ctx.strokeStyle = `rgba(255, 255, 255, ${blink})`;
    ctx.lineWidth = 3;
    roundRect(ctx, -25, -18, 50, 36, 9);
    ctx.stroke();
    ctx.restore();
  }

  // Hit-stop rings.
  if (player.hitStopRemainingMs > 0) {
    ctx.strokeStyle = "rgba(255, 120, 80, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 30 + 6 * Math.sin(performance.now() / 60), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Labels (drawn in world space so the camera keeps them readable).
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 3;
  ctx.strokeText(player.name, x, y - 32);
  ctx.fillText(player.name, x, y - 32);
  if (player.finished) {
    ctx.fillStyle = "#facc15";
    ctx.font = "800 15px system-ui, sans-serif";
    ctx.strokeText("FINISHED", x, y + 44);
    ctx.fillText("FINISHED", x, y + 44);
  }
  if (player.wrongWay) {
    ctx.fillStyle = "#f87171";
    ctx.font = "800 15px system-ui, sans-serif";
    ctx.strokeText("WRONG WAY", x, y - 50);
    ctx.fillText("WRONG WAY", x, y - 50);
  }
  void delta;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function ArenaView({
  connection,
  state,
  selfSessionId,
  roomError = null,
}: {
  connection: RoomConnection;
  state: KartRacingState;
  selfSessionId: string;
  roomError?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cameraRef = useRef<CameraState>(createCameraState(600, 1050, 0));
  const lastStateAtRef = useRef(performance.now());
  const stateKeyRef = useRef("");
  const local = state.players.get(selfSessionId);
  const stateKey = [
    state.phase,
    state.raceNumber,
    local?.kartX,
    local?.kartY,
    local?.kartHeading,
    local?.kartSpeed,
    local?.ammoLoaded,
    local?.hitStopRemainingMs,
    local?.respawnRemainingMs,
    state.crates.length,
    state.projectiles.length,
  ].join("|");
  if (stateKeyRef.current !== stateKey) {
    stateKeyRef.current = stateKey;
    lastStateAtRef.current = performance.now();
  }

  const sequenceRef = useRef(0);
  const shootSequenceRef = useRef(0);
  const gestureRef = useRef({
    pointerId: null as number | null,
    originX: 0,
    originY: 0,
    downAt: 0,
    lastSteering: 0,
    lastSentAt: 0,
    swipeConsumed: false,
  });
  const heldSteeringRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [commandError, setCommandError] = useState<string | null>(null);
  const commandErrorTimerRef = useRef<number | null>(null);
  const wasHitStoppedRef = useRef(false);
  const wasFallingRef = useRef(false);
  const wasAmmoLoadedRef = useRef(false);
  const wasFinishedRef = useRef(false);
  const previousSpeedRef = useRef(local?.kartSpeed ?? 0);

  const sendSteering = useCallback(
    (steering: number, force = false): void => {
      const current = stateRef.current;
      const player = current.players.get(selfSessionId);
      if (
        (current.phase !== "countdown" && current.phase !== "racing") ||
        player === undefined ||
        player.removed
      ) {
        return;
      }
      const clamped = Math.max(-1, Math.min(1, steering));
      const gesture = gestureRef.current;
      const sentAt = Date.now();
      if (
        !force &&
        Math.abs(clamped - gesture.lastSteering) < 0.04 &&
        sentAt - gesture.lastSentAt < 50
      ) {
        return;
      }
      sequenceRef.current += 1;
      gesture.lastSteering = clamped;
      gesture.lastSentAt = sentAt;
      connection.room.send(KART_RACING_MESSAGE_TYPES.steer, {
        type: "steer",
        sequence: sequenceRef.current,
        raceNumber: current.raceNumber,
        steering: clamped,
      });
    },
    [connection.room, selfSessionId],
  );

  const setHeldSteering = useCallback(
    (value: number): void => {
      heldSteeringRef.current = value;
      sendSteering(value);
    },
    [sendSteering],
  );

  const sendShoot = useCallback((): void => {
    const current = stateRef.current;
    const player = current.players.get(selfSessionId);
    if (
      current.phase !== "racing" ||
      player === undefined ||
      player.removed ||
      !player.active ||
      player.finished
    ) {
      return;
    }
    shootSequenceRef.current += 1;
    connection.room.send(KART_RACING_MESSAGE_TYPES.shoot, {
      type: "shoot",
      sequence: shootSequenceRef.current,
      raceNumber: current.raceNumber,
    });
  }, [connection.room, selfSessionId]);

  const showCommandError = useCallback((message: string): void => {
    setCommandError(message);
    if (commandErrorTimerRef.current !== null) {
      window.clearTimeout(commandErrorTimerRef.current);
    }
    commandErrorTimerRef.current = window.setTimeout(() => setCommandError(null), 1_200);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }
    let frame = 0;
    let previous = performance.now();
    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    const draw = (time: number): void => {
      const dt = Math.min(0.05, Math.max(0, (time - previous) / 1000));
      previous = time;
      const current = stateRef.current;
      const player = current.players.get(selfSessionId);
      if (player !== undefined) {
        const extrapolated = extrapolatePosition(player, time - lastStateAtRef.current);
        cameraRef.current = smoothCamera(
          cameraRef.current,
          createCameraState(extrapolated.x, extrapolated.y, player.kartHeading),
          dt,
        );
      }
      drawFrame(canvas, current, selfSessionId, cameraRef.current, time, lastStateAtRef.current);
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
    if (window.sessionStorage.getItem("kart-racing-e2e-driver") !== "1") {
      return;
    }
    // Playwright opts into this minimal hook before navigation. It exposes the
    // same steering/shooting intents the touch controls send and is cleaned up
    // on unmount; ordinary production sessions never receive it.
    const drive = {
      steer: (value: number) => sendSteering(value, true),
      shoot: () => sendShoot(),
    };
    const target = window as unknown as { __kartRacingDrive?: typeof drive };
    target.__kartRacingDrive = drive;
    return () => {
      delete target.__kartRacingDrive;
    };
  }, [sendSteering, sendShoot]);

  useEffect(() => {
    // The server may clear transient state (for example a fall or hit-stop)
    // without knowing the finger is still held. Re-assert nonzero steering so
    // a held gesture survives respawns and hits.
    const interval = window.setInterval(() => {
      const currentSteering =
        gestureRef.current.pointerId !== null
          ? gestureRef.current.lastSteering
          : heldSteeringRef.current;
      if (currentSteering !== 0) {
        sendSteering(currentSteering, true);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [sendSteering]);

  useEffect(() => {
    const off = connection.room.onMessage(KART_RACING_MESSAGE_TYPES.commandRejected, (payload) => {
      const parsed = kartCommandRejectionSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      gameFeedback("invalid");
      const reason = parsed.data.reason;
      showCommandError(
        reason === "no-ammo"
          ? "No ammo — collect a crate."
          : reason === "rate-limited"
            ? "Too fast."
            : reason === "disabled"
              ? "Can't shoot right now."
              : "Command rejected.",
      );
    });
    return () => {
      off();
      if (commandErrorTimerRef.current !== null) {
        window.clearTimeout(commandErrorTimerRef.current);
      }
    };
  }, [connection.room, showCommandError]);

  useEffect(() => {
    const player = state.players.get(selfSessionId);
    if (!player) {
      return;
    }
    const hitStopped = player.hitStopRemainingMs > 0;
    const falling = player.respawnRemainingMs > 0;
    const ammoLoaded = player.ammoLoaded;
    const finished = player.finished;
    if (hitStopped && !wasHitStoppedRef.current) {
      gameFeedback("eliminated");
    }
    if (falling && !wasFallingRef.current) {
      gameFeedback("danger");
    }
    if (!falling && wasFallingRef.current && player.respawnRemainingMs === 0) {
      gameFeedback("select");
    }
    if (ammoLoaded && !wasAmmoLoadedRef.current) {
      gameFeedback("select");
    }
    if (finished && !wasFinishedRef.current) {
      gameFeedback("win");
    }
    const speedDrop = previousSpeedRef.current - player.kartSpeed;
    if (speedDrop > 80 && !hitStopped && !falling) {
      gameFeedback("invalid");
    }
    wasHitStoppedRef.current = hitStopped;
    wasFallingRef.current = falling;
    wasAmmoLoadedRef.current = ammoLoaded;
    wasFinishedRef.current = finished;
    previousSpeedRef.current = player.kartSpeed;
  }, [selfSessionId, state]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }
      if (event.code === "ArrowLeft") {
        setHeldSteering(-1);
      } else if (event.code === "ArrowRight") {
        setHeldSteering(1);
      } else if (event.code === "Space" || event.code === "KeyS") {
        const player = stateRef.current.players.get(selfSessionId);
        if (player?.ammoLoaded) {
          sendShoot();
        } else {
          gameFeedback("invalid");
          showCommandError("No ammo — collect a crate.");
        }
      }
    };
    const keyup = (event: KeyboardEvent): void => {
      if (event.code === "ArrowLeft" && heldSteeringRef.current === -1) {
        setHeldSteering(0);
      } else if (event.code === "ArrowRight" && heldSteeringRef.current === 1) {
        setHeldSteering(0);
      }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, [selfSessionId, setHeldSteering, sendShoot, showCommandError]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    primeGameFeedback();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const gesture = gestureRef.current;
    gesture.pointerId = event.pointerId;
    gesture.originX = event.clientX - rect.left;
    gesture.originY = event.clientY - rect.top;
    gesture.downAt = performance.now();
    gesture.lastSteering = 0;
    gesture.swipeConsumed = false;
    sendSteering(0);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) {
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - gesture.originX;
    const dy = y - gesture.originY;
    sendSteering(steeringFromOffset(dx));
    if (
      !gesture.swipeConsumed &&
      swipeOutcome(dx, -dy, performance.now() - gesture.downAt) === "shoot"
    ) {
      gesture.swipeConsumed = true;
      const player = stateRef.current.players.get(selfSessionId);
      if (player?.ammoLoaded) {
        sendShoot();
        gameFeedback("move");
      } else {
        gameFeedback("invalid");
        showCommandError("No ammo — collect a crate.");
      }
      gesture.originX = x;
      gesture.originY = y;
      gesture.downAt = performance.now();
      sendSteering(steeringFromOffset(0));
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) {
      return;
    }
    gesture.pointerId = null;
    gesture.swipeConsumed = false;
    sendSteering(0);
  };

  const countdownRemaining = Math.max(0, Math.ceil((state.countdownEndsAt - now) / 1000));
  const showGo = state.phase === "racing" && now - state.raceStartedAt < 700;
  const localPlayer = state.players.get(selfSessionId);
  const isSpectator = localPlayer === undefined || localPlayer.removed;
  const previousPhaseRef = useRef(state.phase);
  const lastLapRef = useRef(localPlayer?.lap ?? 0);
  const lookahead = localPlayer
    ? lookaheadTarget(localPlayer.kartX, localPlayer.kartY)
    : { x: 0, y: 0 };

  useEffect(() => {
    if (previousPhaseRef.current === "countdown" && state.phase === "racing") {
      gameFeedback("confirm");
    }
    previousPhaseRef.current = state.phase;
  }, [state.phase]);

  useEffect(() => {
    const lap = localPlayer?.lap ?? 0;
    if (lap > lastLapRef.current && lap > 1) {
      gameFeedback("confirm");
    }
    lastLapRef.current = lap;
  }, [localPlayer?.lap]);

  useEffect(() => {
    if (state.phase === "countdown" && countdownRemaining > 0 && countdownRemaining < 3) {
      gameFeedback("select");
    }
  }, [countdownRemaining, state.phase]);

  return (
    <Box
      component="main"
      sx={{ display: "flex", flexDirection: "column", height: "100dvh", width: "100%" }}
    >
      <Paper
        square
        component="header"
        sx={{
          p: 1.25,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Race {state.raceNumber}/{state.totalRaces}
        </Typography>
        {isSpectator && <Chip label="Spectating" size="small" variant="outlined" color="info" />}
        {localPlayer !== undefined && localPlayer.connectionStatus !== "connected" && (
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
        data-testid="kart-racing-arena"
        data-phase={state.phase}
        data-race={state.raceNumber}
        data-local-x={localPlayer?.kartX ?? ""}
        data-local-y={localPlayer?.kartY ?? ""}
        data-local-heading={localPlayer?.kartHeading ?? ""}
        data-local-speed={localPlayer?.kartSpeed ?? ""}
        data-local-lap={localPlayer?.lap ?? 0}
        data-local-checkpoint={localPlayer?.checkpointsPassed ?? 0}
        data-self-session={selfSessionId}
        data-local-connection={localPlayer?.connectionStatus ?? ""}
        data-local-position={localPlayer?.racePosition ?? 0}
        data-local-ammo={localPlayer?.ammoLoaded ?? false}
        data-local-finished={localPlayer?.finished ?? false}
        data-local-active={localPlayer?.active ?? false}
        data-local-respawn={localPlayer?.respawnRemainingMs ?? 0}
        data-projectile-count={state.projectiles.length}
        data-race-ends-at={state.raceFinishTimeoutEndsAt}
        data-lookahead-x={lookahead.x}
        data-lookahead-y={lookahead.y}
        role="application"
        aria-label="Kart Racing course. Drag left or right to steer and swipe up to shoot."
        sx={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Top-down view of the kart race track"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        <Paper
          sx={{
            position: "absolute",
            top: 10,
            left: 10,
            px: 1.25,
            py: 0.5,
            zIndex: 5,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 800 }} aria-live="polite">
            {localPlayer?.racePosition ?? "-"}/{state.players.size}
          </Typography>
        </Paper>
        <Paper
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            px: 1.25,
            py: 0.5,
            zIndex: 5,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            Lap {localPlayer?.lap ?? 0}/{state.lapsPerRace}
          </Typography>
        </Paper>
        <Paper
          sx={{
            position: "absolute",
            bottom: 10,
            right: 10,
            px: 1.25,
            py: 0.5,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
          }}
          aria-label={localPlayer?.ammoLoaded ? "Ammo loaded" : "No ammo"}
        >
          <Box
            aria-hidden
            sx={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              bgcolor: localPlayer?.ammoLoaded ? "#facc15" : "rgba(255,255,255,0.2)",
              border: "1px solid rgba(255,255,255,0.6)",
            }}
          />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {localPlayer?.ammoLoaded ? "Loaded" : "Empty"}
          </Typography>
        </Paper>

        {state.phase === "countdown" && state.raceNumber === 1 && (
          <HowToPlay
            title="How to play Kart Racing"
            points={[
              "Drag left and right to steer.",
              "Swipe up to shoot.",
              "Collect crates for ammo.",
            ]}
          />
        )}

        {(state.phase === "countdown" || showGo) && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(0, 0, 0, 0.35)",
              zIndex: 10,
              p: 3,
              pointerEvents: "none",
            }}
          >
            <Typography
              component="h2"
              variant="h2"
              aria-live="polite"
              sx={{ fontSize: "4rem", fontWeight: 900, color: "#facc15" }}
            >
              {showGo ? "GO!" : countdownRemaining}
            </Typography>
          </Box>
        )}

        {state.phase === "racing" && (
          <Box sx={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", p: 1 }}>
            {(localPlayer?.hitStopRemainingMs ?? 0) > 0 && (
              <Paper
                sx={{ mx: "auto", px: 1.5, py: 0.5, textAlign: "center", width: "fit-content" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 800 }} aria-live="polite">
                  Hit! Stopped
                </Typography>
              </Paper>
            )}
            {(localPlayer?.respawnRemainingMs ?? 0) > 0 && (
              <Paper
                sx={{ mx: "auto", px: 1.5, py: 0.5, textAlign: "center", width: "fit-content" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 800 }} aria-live="polite">
                  Respawning…
                </Typography>
              </Paper>
            )}
            {localPlayer?.finished && (
              <Paper
                sx={{ mx: "auto", px: 1.5, py: 0.5, textAlign: "center", width: "fit-content" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 800 }} aria-live="polite">
                  Finished!
                </Typography>
              </Paper>
            )}
            {localPlayer?.wrongWay && (
              <Paper
                sx={{ mx: "auto", px: 1.5, py: 0.5, textAlign: "center", width: "fit-content" }}
              >
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 800, color: "#f87171" }}
                  aria-live="polite"
                >
                  Wrong way!
                </Typography>
              </Paper>
            )}
          </Box>
        )}
      </Box>

      <Paper square sx={{ p: 1.25 }}>
        <Stack spacing={1}>
          {roomError !== null && <Alert severity="error">{roomError}</Alert>}
          <Stack direction="row" spacing={1}>
            <Button
              type="button"
              fullWidth
              onPointerDown={(event) => {
                event.preventDefault();
                primeGameFeedback();
                setHeldSteering(-1);
              }}
              onPointerUp={() => setHeldSteering(0)}
              onPointerLeave={() => setHeldSteering(0)}
              onPointerCancel={() => setHeldSteering(0)}
              data-testid="kart-steer-left"
            >
              Steer left
            </Button>
            <Button
              type="button"
              fullWidth
              onPointerDown={(event) => {
                event.preventDefault();
                primeGameFeedback();
                setHeldSteering(1);
              }}
              onPointerUp={() => setHeldSteering(0)}
              onPointerLeave={() => setHeldSteering(0)}
              onPointerCancel={() => setHeldSteering(0)}
              data-testid="kart-steer-right"
            >
              Steer right
            </Button>
          </Stack>
          <Button
            type="button"
            fullWidth
            disabled={!localPlayer?.active || localPlayer?.finished || isSpectator}
            onClick={() => {
              primeGameFeedback();
              if (localPlayer?.ammoLoaded) {
                sendShoot();
              } else {
                gameFeedback("invalid");
                showCommandError("No ammo — collect a crate.");
              }
            }}
            data-testid="kart-shoot-button"
          >
            Shoot
          </Button>
          <Typography
            variant="body2"
            align="center"
            aria-live="polite"
            data-testid="kart-arena-status"
          >
            {commandError ?? (isSpectator ? "Spectating." : "Drag to steer, swipe up to shoot.")}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
