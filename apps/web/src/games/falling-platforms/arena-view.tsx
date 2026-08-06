import { Box, Chip, Paper, Typography } from "@mui/material";
import {
  clamp,
  FALLING_PLATFORMS_CONSTANTS,
  FALLING_PLATFORMS_MESSAGE_TYPES,
  type FallingPlatformsPlayerState,
  type FallingPlatformsState,
  fallingPlatformHopRejectionSchema,
  hopEaseOut,
  lerp,
  parsePlatformId,
  platformCenterX,
  platformCenterY,
  platformId,
} from "@phone-party/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { gameFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";

const SWIPE_THRESHOLD = 24;
const TAP_FOLLOW_RADIUS = 64;
/**
 * Camera zoom relative to the full-arena fit. Doubles the rendered platform
 * size on every phone while the camera stays clamped inside the arena, so the
 * playfield remains usable at the 320px minimum width.
 */
const PLATFORM_ZOOM = 2;
const HINT_DURATION_MS = 3_200;
const ANNOUNCEMENT_DURATION_MS = 2_600;

type SwipeDirection = "up" | "down" | "left" | "right";

const SWIPE_DELTAS: Record<SwipeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

type PlayerAnimation = {
  localJump: { from: string; to: string; startedAt: number } | null;
};

export type JumpPosition = { x: number; y: number; height: number };

export type ArenaFit = { scale: number; offsetX: number; offsetY: number };

/**
 * Scales and centres the whole arena inside the available viewport. The scale
 * is bounded by the tighter viewport dimension so every platform stays on
 * screen at all times before the camera zoom is applied.
 */
export function fitArenaToViewport(
  viewportWidth: number,
  viewportHeight: number,
  arenaSize: number,
): ArenaFit {
  const scale = Math.min(viewportWidth / arenaSize, viewportHeight / arenaSize);
  return {
    scale,
    offsetX: (viewportWidth - arenaSize * scale) / 2,
    offsetY: (viewportHeight - arenaSize * scale) / 2,
  };
}

/**
 * Zooms the full-arena fit so platforms render twice as large and centres the
 * camera on the followed player's world position. When the zoomed arena is
 * larger than the viewport the camera is clamped so the view never leaves the
 * arena; when it is smaller the arena is centred.
 */
export function fitCameraToArena(
  viewportWidth: number,
  viewportHeight: number,
  arenaSize: number,
  cameraX: number,
  cameraY: number,
): ArenaFit {
  const fit = fitArenaToViewport(viewportWidth, viewportHeight, arenaSize);
  const scale = fit.scale * PLATFORM_ZOOM;
  const offsetX = viewportWidth / 2 - (cameraX + arenaSize / 2) * scale;
  const offsetY = viewportHeight / 2 - (cameraY + arenaSize / 2) * scale;
  const availableX = viewportWidth - arenaSize * scale;
  const availableY = viewportHeight - arenaSize * scale;
  return {
    scale,
    offsetX: availableX >= 0 ? availableX / 2 : clamp(offsetX, availableX, 0),
    offsetY: availableY >= 0 ? availableY / 2 : clamp(offsetY, availableY, 0),
  };
}

/**
 * Interpolates a hop between two platform ids for a given point in time.
 * Server jump timestamps and the local optimistic timeline both use
 * `Date.now()`, so the same clock drives local and remote animations.
 */
export function interpolateJumpPosition(
  fromId: string,
  toId: string,
  startedAt: number,
  durationMs: number,
  arenaSide: number,
  now: number,
  reducedMotion: boolean,
  fallback: { x: number; y: number },
): JumpPosition {
  const progress = clamp((now - startedAt) / Math.max(1, durationMs), 0, 1);
  const eased = hopEaseOut(progress);
  const from = parsePlatformId(fromId);
  const to = parsePlatformId(toId);
  if (!from || !to) {
    return { x: fallback.x, y: fallback.y, height: 0 };
  }
  return {
    x: lerp(
      platformCenterX(from.gridX, arenaSide),
      platformCenterX(to.gridX, arenaSide),
      reducedMotion ? 1 : eased,
    ),
    y: lerp(
      platformCenterY(from.gridY, arenaSide),
      platformCenterY(to.gridY, arenaSide),
      reducedMotion ? 1 : eased,
    ),
    height: reducedMotion
      ? 0
      : Math.sin(Math.PI * progress) * FALLING_PLATFORMS_CONSTANTS.JUMP_VISUAL_HEIGHT,
  };
}

function playerFallbackPosition(
  player: FallingPlatformsPlayerState,
  arenaSide: number,
): { x: number; y: number } {
  const parts = parsePlatformId(player.currentPlatformId);
  return parts
    ? { x: platformCenterX(parts.gridX, arenaSide), y: platformCenterY(parts.gridY, arenaSide) }
    : { x: 0, y: 0 };
}

function resolveDirection(dx: number, dy: number): SwipeDirection {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

function playerHue(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/**
 * Renders the authoritative Falling Platforms arena and players. Hops are
 * interpolated locally with requestAnimationFrame but the animation is only a
 * presentation of server state: the server owns every position, landing,
 * elimination, and winner. Swipes send intent and a rejected hop snaps back
 * to the server's authoritative platform. The camera follows the local player
 * (or a tapped survivor while spectating) at twice the fitted platform size.
 */
export function ArenaView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: FallingPlatformsState;
  selfSessionId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [followSessionId, setFollowSessionId] = useState<string | null>(null);
  const [bufferedDirection, setBufferedDirection] = useState<SwipeDirection | null>(null);
  const [invalidTarget, setInvalidTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [hintVisible, setHintVisible] = useState(false);

  const playerElementsRef = useRef(new Map<string, HTMLDivElement>());
  const playerBodiesRef = useRef(new Map<string, HTMLDivElement>());
  const animationsRef = useRef(new Map<string, PlayerAnimation>());
  const pointerStartsRef = useRef(new Map<number, { x: number; y: number; handled: boolean }>());
  const sequenceRef = useRef(0);
  const pendingHopRef = useRef<{ sequence: number; target: string } | null>(null);
  const bufferedDirectionRef = useRef<SwipeDirection | null>(null);
  const followRef = useRef<string | null>(null);
  const invalidTimerRef = useRef<number | null>(null);
  const announcementTimerRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const prevLocalRef = useRef<{
    alive: boolean;
    jumping: boolean;
    currentPlatformId: string;
  } | null>(null);

  followRef.current = followSessionId;
  bufferedDirectionRef.current = bufferedDirection;

  const arenaSide = state.arenaSide;
  const arenaSize = arenaSide * FALLING_PLATFORMS_CONSTANTS.TILE_PITCH;
  const roundKey = `${state.phase}:${state.roundNumber}`;
  const local = state.players.get(selfSessionId);
  const isSpectator = local === undefined || !local.participating || !local.alive;
  const followed = followSessionId === null ? null : (state.players.get(followSessionId) ?? null);
  const localSnapshot = local
    ? `${local.alive}|${local.jumping}|${local.currentPlatformId}`
    : "none";
  const playersSnapshot = [...state.players.entries()]
    .map(([sessionId, player]) => `${sessionId}:${player.participating}:${player.alive}`)
    .join("|");
  const platformStatesSnapshot = [...state.platforms.values()]
    .map((platform) => `${platform.id}:${platform.state}`)
    .join("|");
  const warningPlatformsRef = useRef(new Set<string>());

  // Measure the arena viewport so the grid scales and stays inside 320px.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const update = (): void => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Warn the local player only when the platform they are standing on starts
  // collapsing. Colyseus schema objects mutate in place, so the platform state
  // snapshot is the patch trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mutable Colyseus schema.
  useEffect(() => {
    const currentWarnings = new Set<string>();
    for (const platform of stateRef.current.platforms.values()) {
      if (platform.state === "warning") {
        currentWarnings.add(platform.id);
      }
    }
    const localPlayer = stateRef.current.players.get(selfSessionId);
    for (const platformId of currentWarnings) {
      if (
        !warningPlatformsRef.current.has(platformId) &&
        localPlayer?.currentPlatformId === platformId
      ) {
        gameFeedback("danger");
        break;
      }
    }
    warningPlatformsRef.current = currentWarnings;
  }, [platformStatesSnapshot, selfSessionId]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    const onChange = (event: MediaQueryListEvent): void => {
      reducedMotionRef.current = event.matches;
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Briefly explain the swipe control at the start of each round, then let
  // the gameplay visuals take over without a persistent footer.
  useEffect(() => {
    if (!roundKey.startsWith("playing:")) {
      setHintVisible(false);
      return;
    }
    setHintVisible(true);
    const timer = window.setTimeout(() => setHintVisible(false), HINT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [roundKey]);

  const clearMovement = useCallback((): void => {
    pendingHopRef.current = null;
    bufferedDirectionRef.current = null;
    setBufferedDirection(null);
  }, []);

  const clearAnnouncementTimer = useCallback((): void => {
    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current);
      announcementTimerRef.current = null;
    }
  }, []);

  const setPersistentAnnouncement = useCallback(
    (message: string): void => {
      clearAnnouncementTimer();
      setAnnouncement(message);
    },
    [clearAnnouncementTimer],
  );

  const showTemporaryAnnouncement = useCallback(
    (message: string): void => {
      clearAnnouncementTimer();
      setAnnouncement(message);
      announcementTimerRef.current = window.setTimeout(() => {
        announcementTimerRef.current = null;
        setAnnouncement("");
      }, ANNOUNCEMENT_DURATION_MS);
    },
    [clearAnnouncementTimer],
  );

  const isTargetOccupied = useCallback(
    (targetId: string): boolean => {
      const currentState = stateRef.current;
      for (const [sessionId, player] of currentState.players) {
        if (sessionId === selfSessionId || !player.participating || !player.alive) {
          continue;
        }
        if ((player.jumping ? player.targetPlatformId : player.currentPlatformId) === targetId) {
          return true;
        }
      }
      return false;
    },
    [selfSessionId],
  );

  const requestHop = useCallback(
    (targetId: string): void => {
      const currentState = stateRef.current;
      const currentLocal = currentState.players.get(selfSessionId);
      if (
        currentState.phase !== "playing" ||
        !currentLocal ||
        !currentLocal.participating ||
        !currentLocal.alive ||
        currentLocal.jumping
      ) {
        return;
      }
      bufferedDirectionRef.current = null;
      setBufferedDirection(null);
      const sequence = ++sequenceRef.current;
      pendingHopRef.current = { sequence, target: targetId };
      const animation = animationsRef.current.get(selfSessionId) ?? { localJump: null };
      animation.localJump = {
        from: currentLocal.currentPlatformId,
        to: targetId,
        startedAt: Date.now(),
      };
      animationsRef.current.set(selfSessionId, animation);
      connection.room.send(FALLING_PLATFORMS_MESSAGE_TYPES.hop, {
        type: "hop",
        sequence,
        targetPlatformId: targetId,
      });
      gameFeedback("move");
    },
    [connection, selfSessionId],
  );

  const resolveBufferedHop = useCallback((): void => {
    const direction = bufferedDirectionRef.current;
    if (!direction) {
      return;
    }
    bufferedDirectionRef.current = null;
    setBufferedDirection(null);
    const currentState = stateRef.current;
    const currentLocal = currentState.players.get(selfSessionId);
    if (!currentLocal?.alive) {
      return;
    }
    const source = parsePlatformId(currentLocal.currentPlatformId);
    if (!source) {
      return;
    }
    const delta = SWIPE_DELTAS[direction];
    const gridX = source.gridX + delta.dx;
    const gridY = source.gridY + delta.dy;
    if (
      gridX < 0 ||
      gridY < 0 ||
      gridX >= currentState.arenaSide ||
      gridY >= currentState.arenaSide
    ) {
      gameFeedback("invalid");
      setInvalidTarget(currentLocal.currentPlatformId);
      return;
    }
    const targetId = platformId(gridX, gridY);
    const target = currentState.platforms.get(targetId);
    if (target && target.state !== "gone" && !isTargetOccupied(targetId)) {
      requestHop(targetId);
    } else if (target) {
      gameFeedback("invalid");
      setInvalidTarget(targetId);
    }
  }, [isTargetOccupied, requestHop, selfSessionId]);

  // Reconcile local movement state whenever a server patch arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mutable Colyseus schema.
  useEffect(() => {
    const previous = prevLocalRef.current;
    const currentLocal = stateRef.current.players.get(selfSessionId);
    prevLocalRef.current = currentLocal
      ? {
          alive: currentLocal.alive,
          jumping: currentLocal.jumping,
          currentPlatformId: currentLocal.currentPlatformId,
        }
      : null;

    if (previous && currentLocal) {
      if (previous.alive && !currentLocal.alive) {
        clearMovement();
        gameFeedback("eliminated");
        setPersistentAnnouncement("You were eliminated.");
      } else if (
        currentLocal.alive &&
        !currentLocal.jumping &&
        (previous.jumping || previous.currentPlatformId !== currentLocal.currentPlatformId)
      ) {
        resolveBufferedHop();
      }
    }
  }, [
    localSnapshot,
    state,
    selfSessionId,
    clearMovement,
    resolveBufferedHop,
    setPersistentAnnouncement,
  ]);

  // Keep the camera on the local player, or on a survivor while spectating.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mutable Colyseus schema.
  useEffect(() => {
    const currentLocal = stateRef.current.players.get(selfSessionId);
    const survivors = [...stateRef.current.players.entries()]
      .filter(([, player]) => player.participating && player.alive)
      .sort((a, b) => a[1].joinedOrder - b[1].joinedOrder);
    const defaultTarget =
      currentLocal?.participating && currentLocal.alive
        ? selfSessionId
        : (survivors[0]?.[0] ?? null);
    setFollowSessionId((current) => {
      const stillValid =
        current !== null &&
        (stateRef.current.players.get(current)?.participating ?? false) &&
        (stateRef.current.players.get(current)?.alive ?? false);
      return stillValid ? current : defaultTarget;
    });
  }, [playersSnapshot, selfSessionId, state]);

  // Frame loop: interpolate hops from authoritative jump timestamps and keep
  // the zoomed camera centred on the followed player.
  useEffect(() => {
    const updatePositions = (now: number): void => {
      const currentState = stateRef.current;
      if (currentState.arenaSide <= 0) {
        return;
      }
      const side = currentState.arenaSide;
      const size = side * FALLING_PLATFORMS_CONSTANTS.TILE_PITCH;
      const reducedMotion = reducedMotionRef.current;
      const followedSessionId = followRef.current;
      let cameraX = 0;
      let cameraY = 0;

      for (const [sessionId, player] of currentState.players) {
        const element = playerElementsRef.current.get(sessionId);
        if (!element) {
          continue;
        }
        if (!player.participating) {
          element.style.opacity = "0";
          element.style.transform = "translate3d(-9999px, 0, 0)";
          continue;
        }
        if (!player.alive) {
          const fallback = playerFallbackPosition(player, side);
          element.style.opacity = "0.45";
          element.style.filter = "grayscale(0.9)";
          element.style.transform = `translate3d(${fallback.x + size / 2}px, ${
            fallback.y + size / 2 + 14
          }px, 0)`;
          const body = playerBodiesRef.current.get(sessionId);
          if (body) {
            body.style.transform = "translateY(0)";
          }
          element.dataset.alive = "false";
          element.dataset.platform = player.currentPlatformId;
          element.dataset.jumping = "false";
          if (sessionId === followedSessionId) {
            cameraX = fallback.x;
            cameraY = fallback.y;
          }
          continue;
        }

        element.style.filter = "";
        const animation = animationsRef.current.get(sessionId) ?? { localJump: null };
        let x: number;
        let y: number;
        let height = 0;

        if (player.jumping && player.fromPlatformId && player.targetPlatformId) {
          const localJump = animation.localJump;
          const useLocalTimeline =
            localJump !== null &&
            localJump.from === player.fromPlatformId &&
            localJump.to === player.targetPlatformId;
          const duration = useLocalTimeline
            ? FALLING_PLATFORMS_CONSTANTS.HOP_DURATION_MS
            : Math.max(1, player.jumpEndsAt - player.jumpStartedAt);
          const startedAt = useLocalTimeline ? localJump.startedAt : player.jumpStartedAt;
          const position = interpolateJumpPosition(
            player.fromPlatformId,
            player.targetPlatformId,
            startedAt,
            duration,
            side,
            now,
            reducedMotion,
            playerFallbackPosition(player, side),
          );
          x = position.x;
          y = position.y;
          height = position.height;
        } else if (animation.localJump !== null) {
          const localJump = animation.localJump;
          const position = interpolateJumpPosition(
            localJump.from,
            localJump.to,
            localJump.startedAt,
            FALLING_PLATFORMS_CONSTANTS.HOP_DURATION_MS,
            side,
            now,
            reducedMotion,
            playerFallbackPosition(player, side),
          );
          x = position.x;
          y = position.y;
          height = position.height;
          if (player.currentPlatformId === localJump.to) {
            animation.localJump = null;
          }
        } else {
          const fallback = playerFallbackPosition(player, side);
          x = fallback.x;
          y = fallback.y;
        }

        element.style.transform = `translate3d(${x + size / 2}px, ${y + size / 2}px, 0)`;
        const body = playerBodiesRef.current.get(sessionId);
        if (body) {
          body.style.transform = `translateY(${-height}px)`;
        }
        element.dataset.platform = player.currentPlatformId;
        element.dataset.jumping = String(player.jumping);
        element.dataset.alive = String(player.alive);
        if (sessionId === followedSessionId) {
          cameraX = x;
          cameraY = y;
        }
      }

      const arena = arenaRef.current;
      if (arena && viewport.width > 0 && size > 0) {
        const fit = fitCameraToArena(viewport.width, viewport.height, size, cameraX, cameraY);
        arena.style.transform = `translate(${fit.offsetX}px, ${fit.offsetY}px) scale(${fit.scale})`;
      }
    };

    let frame = 0;
    const loop = (): void => {
      updatePositions(Date.now());
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [viewport]);

  // A rejected optimistic hop snaps back to the authoritative platform.
  useEffect(() => {
    const off = connection.room.onMessage(
      FALLING_PLATFORMS_MESSAGE_TYPES.hopRejected,
      (payload: unknown) => {
        const parsed = fallingPlatformHopRejectionSchema.safeParse(payload);
        if (!parsed.success) {
          return;
        }
        const pending = pendingHopRef.current;
        if (!pending || pending.sequence !== parsed.data.sequence) {
          return;
        }
        pendingHopRef.current = null;
        setBufferedDirection(null);
        const animation = animationsRef.current.get(selfSessionId);
        if (animation) {
          animation.localJump = null;
        }
        if (parsed.data.reason !== "rate-limited") {
          gameFeedback("invalid");
          setInvalidTarget(pending.target);
        }
      },
    );
    return off;
  }, [connection.room, selfSessionId]);

  useEffect(() => {
    if (invalidTarget === null) {
      return;
    }
    if (invalidTimerRef.current !== null) {
      window.clearTimeout(invalidTimerRef.current);
    }
    invalidTimerRef.current = window.setTimeout(() => setInvalidTarget(null), 600);
    return () => {
      if (invalidTimerRef.current !== null) {
        window.clearTimeout(invalidTimerRef.current);
      }
    };
  }, [invalidTarget]);

  useEffect(() => {
    return () => {
      if (invalidTimerRef.current !== null) {
        window.clearTimeout(invalidTimerRef.current);
      }
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current);
      }
    };
  }, []);

  const handleSwipe = (direction: SwipeDirection): void => {
    const currentState = stateRef.current;
    if (currentState.phase !== "playing") {
      return;
    }
    const currentLocal = currentState.players.get(selfSessionId);
    if (!currentLocal?.participating || !currentLocal.alive) {
      return;
    }
    const source = parsePlatformId(currentLocal.currentPlatformId);
    if (!source) {
      return;
    }
    const delta = SWIPE_DELTAS[direction];
    const gridX = source.gridX + delta.dx;
    const gridY = source.gridY + delta.dy;
    if (
      gridX < 0 ||
      gridY < 0 ||
      gridX >= currentState.arenaSide ||
      gridY >= currentState.arenaSide
    ) {
      gameFeedback("invalid");
      setInvalidTarget(currentLocal.currentPlatformId);
      return;
    }
    if (currentLocal.jumping) {
      bufferedDirectionRef.current = direction;
      setBufferedDirection(direction);
      return;
    }
    const targetId = platformId(gridX, gridY);
    const target = currentState.platforms.get(targetId);
    if (!target?.state || target.state === "gone" || isTargetOccupied(targetId)) {
      gameFeedback("invalid");
      setInvalidTarget(targetId);
      return;
    }
    requestHop(targetId);
  };

  const handleTap = (clientX: number, clientY: number): void => {
    const currentState = stateRef.current;
    const currentLocal = currentState.players.get(selfSessionId);
    if (currentLocal?.participating && currentLocal.alive) {
      return;
    }
    for (const [sessionId, player] of currentState.players) {
      if (!player.participating || !player.alive) {
        continue;
      }
      const element = playerElementsRef.current.get(sessionId);
      if (!element) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (Math.hypot(clientX - centerX, clientY - centerY) <= TAP_FOLLOW_RADIUS) {
        setFollowSessionId(sessionId);
        showTemporaryAnnouncement(`Following ${player.name}`);
        return;
      }
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    primeGameFeedback();
    pointerStartsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      handled: false,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = pointerStartsRef.current.get(event.pointerId);
    if (!start || start.handled) {
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) {
      return;
    }
    start.handled = true;
    handleSwipe(resolveDirection(dx, dy));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = pointerStartsRef.current.get(event.pointerId);
    pointerStartsRef.current.delete(event.pointerId);
    if (!start || start.handled) {
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_THRESHOLD) {
      handleSwipe(resolveDirection(dx, dy));
      return;
    }
    handleTap(event.clientX, event.clientY);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    pointerStartsRef.current.delete(event.pointerId);
  };

  const statusText =
    local === undefined || !local.connected
      ? "Reconnecting…"
      : isSpectator
        ? followed
          ? `Spectating ${followed.name}. Tap a player to follow.`
          : "Spectating. Tap a player to follow."
        : bufferedDirection !== null
          ? "Hop buffered — it fires when you land."
          : hintVisible
            ? "Swipe to hop"
            : "";

  return (
    <Box
      component="main"
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100%",
        bgcolor: "#08121d",
      }}
    >
      <Paper
        square
        component="header"
        sx={{
          px: 2,
          py: 1,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
          bgcolor: "rgba(10, 17, 26, 0.86)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 4px 18px rgba(0, 0, 0, 0.35)",
          position: "relative",
          zIndex: 5,
        }}
      >
        <Chip
          label={`Round ${state.roundNumber}`}
          size="small"
          sx={{
            fontWeight: 700,
            bgcolor: "rgba(76, 194, 255, 0.12)",
            color: "#bdeaff",
            border: "1px solid rgba(76, 194, 255, 0.35)",
          }}
        />
        <Typography variant="body2" sx={{ fontWeight: 800, ml: "auto" }} data-testid="alive-count">
          {state.aliveCount} alive
        </Typography>
        {local !== undefined && !local.connected && (
          <Chip label="Reconnecting…" size="small" color="warning" sx={{ fontWeight: 700 }} />
        )}
      </Paper>

      <Box
        ref={containerRef}
        data-testid="falling-platforms-arena"
        data-phase={state.phase}
        data-round={state.roundNumber}
        data-arena-side={arenaSide}
        data-alive-count={state.aliveCount}
        data-local-platform={local?.currentPlatformId ?? ""}
        data-local-jumping={local?.jumping ?? false}
        data-spectating={isSpectator}
        sx={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          background:
            "radial-gradient(130% 110% at 50% -10%, #1d3c58 0%, #102537 48%, #081420 100%)",
          boxShadow: "inset 0 0 90px rgba(0, 0, 0, 0.55)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <Box
          ref={arenaRef}
          sx={{
            position: "absolute",
            width: arenaSize,
            height: arenaSize,
            left: 0,
            top: 0,
            transformOrigin: "0 0",
          }}
        >
          {[...state.platforms.values()].map((platform) => (
            <Box
              key={platform.id}
              data-testid={`platform-${platform.id}`}
              data-platform-id={platform.id}
              data-state={platform.state}
              sx={{
                position: "absolute",
                left:
                  platformCenterX(platform.gridX, arenaSide) +
                  arenaSize / 2 -
                  FALLING_PLATFORMS_CONSTANTS.TILE_SIZE / 2,
                top:
                  platformCenterY(platform.gridY, arenaSide) +
                  arenaSize / 2 -
                  FALLING_PLATFORMS_CONSTANTS.TILE_SIZE / 2,
                width: FALLING_PLATFORMS_CONSTANTS.TILE_SIZE,
                height: FALLING_PLATFORMS_CONSTANTS.TILE_SIZE,
                borderRadius: "18px",
                backgroundImage:
                  platform.state === "warning"
                    ? "linear-gradient(145deg, #ffd166 0%, #ff9f43 55%, #f0653a 100%)"
                    : "linear-gradient(145deg, #8fdcff 0%, #4aa8e8 55%, #2f7fc0 100%)",
                border: "1px solid rgba(255, 255, 255, 0.7)",
                boxShadow:
                  platform.state === "warning"
                    ? "0 10px 22px rgba(255, 118, 44, 0.4), inset 0 -10px 0 rgba(130, 48, 12, 0.35), inset 0 2px 0 rgba(255, 255, 255, 0.55)"
                    : "0 10px 22px rgba(0, 0, 0, 0.4), inset 0 -10px 0 rgba(10, 58, 94, 0.45), inset 0 2px 0 rgba(255, 255, 255, 0.55)",
                opacity: platform.state === "gone" ? 0 : 1,
                transform: platform.state === "gone" ? "scale(0.2) rotate(8deg)" : "scale(1)",
                display: "block",
                pointerEvents: "none",
                transition: "opacity 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease",
                animation:
                  platform.state === "warning"
                    ? "fp-warning-pulse 0.55s ease-in-out infinite"
                    : "none",
                "@keyframes fp-warning-pulse": {
                  "0%, 100%": {
                    transform: "scale(1)",
                    boxShadow:
                      "0 10px 22px rgba(255, 118, 44, 0.4), inset 0 -10px 0 rgba(130, 48, 12, 0.35), inset 0 2px 0 rgba(255, 255, 255, 0.55)",
                  },
                  "50%": {
                    transform: "scale(0.96)",
                    boxShadow:
                      "0 0 0 8px rgba(255, 120, 60, 0.3), 0 14px 26px rgba(255, 118, 44, 0.5), inset 0 -10px 0 rgba(130, 48, 12, 0.35), inset 0 2px 0 rgba(255, 255, 255, 0.55)",
                  },
                },
                "@media (prefers-reduced-motion: reduce)": {
                  animation: "none",
                },
              }}
            >
              {platform.state === "warning" && (
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 44,
                    fontWeight: 900,
                    color: "#6b1f08",
                    textShadow: "0 1px 0 rgba(255, 255, 255, 0.35)",
                  }}
                >
                  !
                </Box>
              )}
            </Box>
          ))}
          {[...state.players.entries()].map(([sessionId, player]) => (
            <PlayerToken
              key={sessionId}
              sessionId={sessionId}
              player={player}
              isLocal={sessionId === selfSessionId}
              registerElement={(element) => {
                if (element) {
                  playerElementsRef.current.set(sessionId, element);
                  playerBodiesRef.current.set(
                    sessionId,
                    element.querySelector<HTMLDivElement>("[data-player-body]") ?? element,
                  );
                } else {
                  playerElementsRef.current.delete(sessionId);
                  playerBodiesRef.current.delete(sessionId);
                }
              }}
            />
          ))}
        </Box>

        {invalidTarget !== null && (
          <Box
            key={invalidTarget}
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              boxShadow: "inset 0 0 0 3px #ff5d6c",
              borderRadius: 1,
              animation: "fp-invalid-pulse 0.6s ease-out",
              "@keyframes fp-invalid-pulse": {
                "0%": { opacity: 1 },
                "100%": { opacity: 0 },
              },
            }}
          />
        )}

        <Box
          role="status"
          data-testid="arena-status"
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "max(16px, env(safe-area-inset-bottom))",
            display: "flex",
            justifyContent: "center",
            px: 2,
            pointerEvents: "none",
            opacity: statusText !== "" || announcement !== "" ? 1 : 0,
            transition: "opacity 0.25s ease",
          }}
        >
          <Paper
            sx={{
              px: 2,
              py: 0.75,
              borderRadius: "999px",
              bgcolor: "rgba(8, 14, 22, 0.72)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              boxShadow: "0 8px 22px rgba(0, 0, 0, 0.4)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            {statusText !== "" && (
              <Typography variant="body2" align="center" sx={{ fontWeight: 700 }}>
                {statusText}
              </Typography>
            )}
            {announcement !== "" && (
              <Typography variant="body2" align="center" color="text.secondary">
                {announcement}
              </Typography>
            )}
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}

function PlayerToken({
  sessionId,
  player,
  isLocal,
  registerElement,
}: {
  sessionId: string;
  player: FallingPlatformsPlayerState;
  isLocal: boolean;
  registerElement: (element: HTMLDivElement | null) => void;
}) {
  const hue = playerHue(sessionId);
  return (
    <Box
      ref={registerElement}
      data-testid={`player-${player.name}`}
      data-player-session={sessionId}
      data-local={isLocal}
      sx={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: "none",
        willChange: "transform",
      }}
    >
      <Box
        data-player-body
        sx={{
          position: "absolute",
          left: -26,
          top: -26,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, hsl(${hue} 88% 74%), hsl(${hue} 72% 52%))`,
          border: isLocal ? "4px solid #ffffff" : "3px solid rgba(255, 255, 255, 0.9)",
          boxShadow: isLocal
            ? "0 0 0 6px rgba(255, 255, 255, 0.22), 0 10px 18px rgba(0, 0, 0, 0.5)"
            : "0 8px 14px rgba(0, 0, 0, 0.42)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontSize: 20,
          fontWeight: 800,
          textShadow: "0 2px 2px rgba(0, 0, 0, 0.6)",
        }}
      >
        {player.name.slice(0, 1).toUpperCase()}
      </Box>
      <Box
        component="span"
        sx={{
          position: "absolute",
          left: 0,
          top: 34,
          transform: "translateX(-50%)",
          fontSize: 15,
          fontWeight: 700,
          color: "#ffffff",
          bgcolor: "rgba(7, 13, 20, 0.68)",
          border: "1px solid rgba(255, 255, 255, 0.18)",
          borderRadius: "999px",
          px: 1,
          py: 0.25,
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          whiteSpace: "nowrap",
        }}
      >
        {player.name}
        {isLocal ? " (you)" : ""}
      </Box>
    </Box>
  );
}
