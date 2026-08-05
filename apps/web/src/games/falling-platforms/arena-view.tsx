import { Box, Paper, Typography } from "@mui/material";
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

import type { RoomConnection } from "../../game-connection.js";

const SWIPE_THRESHOLD = 24;
const TAP_FOLLOW_RADIUS = 46;

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

function playerColor(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 72% 60%)`;
}

/**
 * Renders the authoritative Falling Platforms arena and players. Hops are
 * interpolated locally with requestAnimationFrame but the animation is only a
 * presentation of server state: the server owns every position, landing,
 * elimination, and winner. Swipes send intent and a rejected hop snaps back
 * to the server's authoritative platform.
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
  const [pendingHop, setPendingHop] = useState<{ sequence: number; target: string } | null>(null);
  const [invalidTarget, setInvalidTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const playerElementsRef = useRef(new Map<string, HTMLDivElement>());
  const playerBodiesRef = useRef(new Map<string, HTMLDivElement>());
  const animationsRef = useRef(new Map<string, PlayerAnimation>());
  const pointerStartsRef = useRef(new Map<number, { x: number; y: number; handled: boolean }>());
  const sequenceRef = useRef(0);
  const pendingHopRef = useRef<{ sequence: number; target: string } | null>(null);
  const bufferedDirectionRef = useRef<SwipeDirection | null>(null);
  const followRef = useRef<string | null>(null);
  const invalidTimerRef = useRef<number | null>(null);
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
  const local = state.players.get(selfSessionId);
  const isSpectator = local === undefined || !local.participating || !local.alive;
  const followed = followSessionId === null ? null : (state.players.get(followSessionId) ?? null);
  const localSnapshot = local
    ? `${local.alive}|${local.jumping}|${local.currentPlatformId}`
    : "none";
  const playersSnapshot = [...state.players.entries()]
    .map(([sessionId, player]) => `${sessionId}:${player.participating}:${player.alive}`)
    .join("|");

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

  const clearMovement = useCallback((): void => {
    pendingHopRef.current = null;
    setPendingHop(null);
    bufferedDirectionRef.current = null;
    setBufferedDirection(null);
  }, []);

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
      setPendingHop({ sequence, target: targetId });
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
      setInvalidTarget(currentLocal.currentPlatformId);
      return;
    }
    const targetId = platformId(gridX, gridY);
    const target = currentState.platforms.get(targetId);
    if (target && target.state !== "gone" && !isTargetOccupied(targetId)) {
      requestHop(targetId);
    } else if (target) {
      setInvalidTarget(targetId);
    }
  }, [isTargetOccupied, requestHop, selfSessionId]);

  // Reconcile local movement state whenever a server patch arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Colyseus schema objects mutate in place; snapshot strings are the patch trigger.
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
        setFollowSessionId(null);
        setAnnouncement("You were eliminated. Tap a player to follow them.");
      } else if (
        currentLocal.alive &&
        !currentLocal.jumping &&
        (previous.jumping || previous.currentPlatformId !== currentLocal.currentPlatformId)
      ) {
        resolveBufferedHop();
      }
    }

    const survivors = [...state.players.entries()]
      .filter(([, player]) => player.participating && player.alive)
      .sort((a, b) => a[1].joinedOrder - b[1].joinedOrder);
    const defaultTarget =
      currentLocal?.participating && currentLocal.alive
        ? selfSessionId
        : (survivors[0]?.[0] ?? null);
    setFollowSessionId((current) => {
      const stillAlive =
        current !== null &&
        (state.players.get(current)?.participating ?? false) &&
        (state.players.get(current)?.alive ?? false);
      return stillAlive ? current : defaultTarget;
    });
  }, [localSnapshot, playersSnapshot, state, selfSessionId, clearMovement, resolveBufferedHop]);

  // Frame loop: interpolate hops from authoritative jump timestamps and move
  // the camera toward the followed player.
  useEffect(() => {
    const updatePositions = (now: number): void => {
      const currentState = stateRef.current;
      if (currentState.arenaSide <= 0) {
        return;
      }
      const side = currentState.arenaSide;
      const size = side * FALLING_PLATFORMS_CONSTANTS.TILE_PITCH;
      let cameraX = 0;
      let cameraY = 0;
      const followedSessionId = followRef.current;
      const followedPlayer =
        followedSessionId === null ? null : currentState.players.get(followedSessionId);
      if (followedPlayer) {
        const parts = parsePlatformId(followedPlayer.currentPlatformId);
        if (parts) {
          cameraX = platformCenterX(parts.gridX, side);
          cameraY = platformCenterY(parts.gridY, side);
        }
      }
      const reducedMotion = reducedMotionRef.current;

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
          element.style.opacity = "0.35";
          element.style.transform = "translate3d(0, 0, 0)";
          element.dataset.alive = "false";
          element.dataset.platform = player.currentPlatformId;
          element.dataset.jumping = "false";
          continue;
        }

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
      }

      const arena = arenaRef.current;
      if (arena && viewport.width > 0 && size > 0) {
        const scale = Math.min(viewport.width / size, viewport.height / size);
        const offsetX = viewport.width / 2 - (cameraX + size / 2) * scale;
        const offsetY = viewport.height / 2 - (cameraY + size / 2) * scale;
        arena.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
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
        setPendingHop(null);
        setBufferedDirection(null);
        const animation = animationsRef.current.get(selfSessionId);
        if (animation) {
          animation.localJump = null;
        }
        if (parsed.data.reason !== "rate-limited") {
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
        setAnnouncement(`Following ${player.name}`);
        return;
      }
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
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
          justifyContent: "space-between",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Round {state.roundNumber}
        </Typography>
        <Typography variant="body2" aria-live="polite" data-testid="alive-count">
          Alive: {state.aliveCount}
        </Typography>
        {local !== undefined && !local.connected && (
          <Typography variant="body2" color="warning.main">
            Reconnecting…
          </Typography>
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
                borderRadius: "10px",
                bgcolor: platform.state === "warning" ? "#ffb020" : "#cfe3f2",
                border: "1px solid rgba(255, 255, 255, 0.55)",
                opacity: platform.state === "gone" ? 0 : 1,
                display: platform.state === "gone" ? "none" : "block",
                pointerEvents: "none",
                transition: "opacity 0.25s ease",
              }}
            />
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
      </Box>

      <Paper square sx={{ p: 1.25 }}>
        <Typography variant="body2" aria-live="polite" data-testid="arena-status" align="center">
          {local === undefined || !local.connected
            ? "Reconnecting…"
            : isSpectator
              ? followed
                ? `Spectating ${followed.name}. Tap a player to follow.`
                : "Spectating. Tap a player to follow."
              : bufferedDirection !== null
                ? "Hop buffered — it fires when you land."
                : pendingHop !== null
                  ? "Hop sent…"
                  : "Swipe to hop."}
        </Typography>
        {announcement !== "" && (
          <Typography variant="body2" color="text.secondary" aria-live="polite" align="center">
            {announcement}
          </Typography>
        )}
      </Paper>
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
  return (
    <Box
      ref={registerElement}
      data-testid={`player-${player.name}`}
      data-player-session={sessionId}
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
          left: -13,
          top: -13,
          width: 26,
          height: 26,
          borderRadius: "50%",
          bgcolor: playerColor(sessionId),
          outline: isLocal ? "2px solid #ffffff" : "none",
          outlineOffset: "2px",
        }}
      />
      <Box
        component="span"
        sx={{
          position: "absolute",
          left: 0,
          top: 14,
          transform: "translateX(-50%)",
          fontSize: 11,
          fontWeight: 600,
          textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
          whiteSpace: "nowrap",
        }}
      >
        {player.name}
        {isLocal ? " (you)" : ""}
      </Box>
    </Box>
  );
}
