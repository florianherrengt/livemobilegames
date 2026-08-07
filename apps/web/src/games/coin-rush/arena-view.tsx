import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import {
  COIN_RUSH_CONSTANTS,
  COIN_RUSH_MESSAGE_TYPES,
  type CoinRushDirection,
  type CoinRushPlayerState,
  type CoinRushState,
  coinRushLerp,
  coinRushMoveRejectionSchema,
  vehicleLeftEdge,
} from "@phone-party/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { gameFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";

const SWIPE_THRESHOLD = 24;
const BOARD_COLS = COIN_RUSH_CONSTANTS.COL_COUNT;
const BOARD_ROWS = COIN_RUSH_CONSTANTS.ROW_COUNT;

type SwipeDirection = CoinRushDirection;

/** Row 0 is the bottom of the board; row numbers increase toward the top. */
export function rowToTop(row: number): number {
  return ((BOARD_ROWS - 1 - row) * 100) / BOARD_ROWS;
}

/** Left offset of a grid cell centre, in percent of board width. */
export function cellCenterLeft(col: number): number {
  return ((col + 0.5) * 100) / BOARD_COLS;
}

/** Top offset of a grid cell centre, in percent of board height. */
export function cellCenterTop(row: number): number {
  return rowToTop(row - 0.5);
}

function resolveDirection(dx: number, dy: number): SwipeDirection {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

function playerPosition(
  player: CoinRushPlayerState,
  now: number,
  reducedMotion: boolean,
): { x: number; y: number; height: number } {
  if (player.moving && player.moveEndsAt > player.moveStartedAt) {
    const progress = Math.min(
      1,
      Math.max(0, (now - player.moveStartedAt) / (player.moveEndsAt - player.moveStartedAt)),
    );
    const eased = reducedMotion ? 1 : progress;
    return {
      x: coinRushLerp(player.fromX, player.toX, eased),
      y: coinRushLerp(player.fromY, player.toY, eased),
      height: reducedMotion ? 0 : Math.sin(Math.PI * progress) * (player.push ? 34 : 26),
    };
  }
  if (player.bouncing && player.bounceEndsAt > player.bounceStartedAt) {
    const progress = Math.min(
      1,
      Math.max(0, (now - player.bounceStartedAt) / (player.bounceEndsAt - player.bounceStartedAt)),
    );
    const bounceProgress = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    const eased = reducedMotion ? 0 : bounceProgress;
    return {
      x: coinRushLerp(player.fromX, player.toX, eased),
      y: coinRushLerp(player.fromY, player.toY, eased),
      height: reducedMotion ? 0 : Math.sin(Math.PI * progress) * 22,
    };
  }
  return { x: player.x, y: player.y, height: 0 };
}

export function ArenaView({
  connection,
  state,
  selfSessionId,
  roomError = null,
}: {
  connection: RoomConnection;
  state: CoinRushState;
  selfSessionId: string;
  roomError?: string | null;
}) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const sequenceRef = useRef(0);
  const bufferedDirectionRef = useRef<SwipeDirection | null>(null);
  const pointerStartsRef = useRef(new Map<number, { x: number; y: number; handled: boolean }>());
  const statusTimerRef = useRef<number | null>(null);
  const scorePopTimerRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<string | null>(null);
  const [scorePop, setScorePop] = useState<{ text: string; id: number } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const local = state.players.get(selfSessionId);
  const isSpectator =
    local === undefined || !local.alive || local.respawning || state.phase === "round-result";
  const countdownRemaining = Math.max(1, Math.ceil((state.countdownEndsAt - now) / 1000));
  const canSendBuffered =
    state.phase === "playing" && local?.alive && !local.moving && !local.bouncing;

  useEffect(() => {
    let frame = 0;
    const loop = (): void => {
      setNow(Date.now());
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const sendMove = useCallback(
    (direction: SwipeDirection): void => {
      const current = stateRef.current;
      const currentLocal = current.players.get(selfSessionId);
      if (
        current.phase !== "playing" ||
        !currentLocal ||
        !currentLocal.alive ||
        currentLocal.respawning
      ) {
        return;
      }
      if (currentLocal.moving || currentLocal.bouncing) {
        bufferedDirectionRef.current = direction;
        return;
      }
      sequenceRef.current += 1;
      gameFeedback("move");
      connection.room.send(COIN_RUSH_MESSAGE_TYPES.move, {
        type: "move",
        sequence: sequenceRef.current,
        direction,
      });
    },
    [connection.room, selfSessionId],
  );

  const handleSwipe = useCallback(
    (direction: SwipeDirection): void => {
      sendMove(direction);
    },
    [sendMove],
  );

  // Fire one optional buffered direction as soon as the server clears the
  // current movement, so swipe spam cannot queue more than one extra move.
  useEffect(() => {
    if (canSendBuffered && bufferedDirectionRef.current !== null) {
      const direction = bufferedDirectionRef.current;
      bufferedDirectionRef.current = null;
      sendMove(direction);
    }
  }, [canSendBuffered, sendMove]);

  const previousScoreRef = useRef(local?.score ?? 0);
  useEffect(() => {
    const currentScore = local?.score ?? 0;
    if (currentScore > previousScoreRef.current) {
      gameFeedback("confirm");
      setScorePop({ text: `+${currentScore - previousScoreRef.current}`, id: Date.now() });
      if (scorePopTimerRef.current !== null) {
        window.clearTimeout(scorePopTimerRef.current);
      }
      scorePopTimerRef.current = window.setTimeout(() => setScorePop(null), 900);
    }
    previousScoreRef.current = currentScore;
  }, [local?.score]);

  useEffect(() => {
    return () => {
      if (scorePopTimerRef.current !== null) {
        window.clearTimeout(scorePopTimerRef.current);
      }
    };
  }, []);

  const wasAliveRef = useRef(local?.alive ?? false);
  useEffect(() => {
    if (wasAliveRef.current && !local?.alive) {
      gameFeedback("eliminated");
    }
    wasAliveRef.current = local?.alive ?? false;
  }, [local?.alive]);

  const wasRoundResultRef = useRef(false);
  useEffect(() => {
    const isRoundResult = state.phase === "round-result";
    if (
      isRoundResult &&
      !wasRoundResultRef.current &&
      [...state.roundWinnerSessionIds].includes(selfSessionId)
    ) {
      gameFeedback("win");
    }
    wasRoundResultRef.current = isRoundResult;
  }, [selfSessionId, state.phase, state.roundWinnerSessionIds]);

  useEffect(() => {
    const off = connection.room.onMessage(
      COIN_RUSH_MESSAGE_TYPES.moveRejected,
      (payload: unknown) => {
        const parsed = coinRushMoveRejectionSchema.safeParse(payload);
        if (!parsed.success) {
          return;
        }
        bufferedDirectionRef.current = null;
        if (parsed.data.reason !== "rate-limited") {
          gameFeedback("invalid");
        }
        const message =
          parsed.data.reason === "out-of-bounds"
            ? "You can't leave the board."
            : parsed.data.reason === "already-moving"
              ? "One move at a time."
              : parsed.data.reason === "not-eligible"
                ? "Sudden death is for tied players only."
                : parsed.data.reason === "respawning"
                  ? "Wait for respawn."
                  : "Move rejected.";
        setStatus(message);
        if (statusTimerRef.current !== null) {
          window.clearTimeout(statusTimerRef.current);
        }
        statusTimerRef.current = window.setTimeout(() => setStatus(null), 1_000);
      },
    );
    return () => {
      off();
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, [connection.room]);

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
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    pointerStartsRef.current.delete(event.pointerId);
  };

  const statusText =
    local !== undefined && !local.connected
      ? "Reconnecting…"
      : local?.respawning
        ? "Respawning…"
        : (status ?? (state.phase === "playing" ? "Swipe to jump" : ""));

  const elapsed = state.elapsedMs;

  return (
    <Box
      component="main"
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100%",
        bgcolor: "#0a1118",
      }}
    >
      <Paper
        square
        component="header"
        sx={{
          px: 1.5,
          py: 1,
          bgcolor: "rgba(10, 17, 26, 0.86)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip
            label={`Round ${state.roundNumber}/${state.totalRounds}`}
            size="small"
            sx={{ fontWeight: 700 }}
          />
          {state.suddenDeath && (
            <Chip label="Sudden death" size="small" color="warning" sx={{ fontWeight: 700 }} />
          )}
          {isSpectator && <Chip label="Waiting" size="small" variant="outlined" color="info" />}
          {local !== undefined && !local.connected && (
            <Chip label="Reconnecting…" size="small" variant="outlined" color="warning" />
          )}
          <Typography
            variant="body2"
            sx={{ ml: "auto", fontWeight: 700 }}
            data-testid="coin-rush-local-score"
          >
            {local ? `${local.name}: ${local.score}` : ""}
          </Typography>
          <Chip
            component="button"
            label="Leave"
            size="small"
            variant="outlined"
            onClick={() => connection.leave()}
            sx={{ cursor: "pointer" }}
          />
        </Stack>
        <Stack
          data-testid="coin-rush-scoreboard"
          direction="row"
          spacing={0.75}
          sx={{ overflowX: "auto", py: 0.5, mt: 0.5 }}
        >
          {[...state.players.values()]
            .sort((a, b) => a.joinedOrder - b.joinedOrder)
            .map((player) => (
              <Typography
                key={player.name}
                variant="caption"
                sx={{
                  whiteSpace: "nowrap",
                  bgcolor: "rgba(255,255,255,0.08)",
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 999,
                  fontWeight: 700,
                }}
              >
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: player.color || "#ffffff",
                    mr: 0.5,
                  }}
                />
                {player.name} {player.score} · {player.roundWins}w
              </Typography>
            ))}
        </Stack>
      </Paper>

      <Box
        data-testid="coin-rush-arena"
        data-phase={state.phase}
        data-round={state.roundNumber}
        data-x={local?.x ?? ""}
        data-y={local?.y ?? ""}
        data-alive={local?.alive ?? false}
        data-score={local?.score ?? 0}
        data-elapsed={state.elapsedMs}
        data-sudden-death={state.suddenDeath}
        data-winners={JSON.stringify([...state.roundWinnerSessionIds])}
        data-coins={JSON.stringify(
          [...state.coins.values()].map((coin) => ({
            value: coin.value,
            col: coin.col,
            row: coin.row,
          })),
        )}
        data-rows={JSON.stringify(
          state.rows.map((row) => ({
            row: row.row,
            terrain: row.terrain,
            direction: row.direction,
            speed: row.speed,
            vehicleLength: row.vehicleLength,
            spacing: row.spacing,
            offset: row.offset,
          })),
        )}
        aria-label="Coin Rush board. Swipe in a direction to move one tile."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        sx={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          outline: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 1,
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "min(100%, calc((100dvh - 160px) * 9 / 17))",
            aspectRatio: "9 / 17",
            maxHeight: "100%",
            overflow: "hidden",
            borderRadius: 2,
            border: "1px solid rgba(255, 255, 255, 0.16)",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
            background:
              "radial-gradient(120% 100% at 50% 0%, #24402a 0%, #17281d 60%, #101b14 100%)",
          }}
        >
          {state.rows.map((row) => (
            <Box
              key={row.row}
              data-row={row.row}
              data-terrain={row.terrain}
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${rowToTop(row.row)}%`,
                height: `${100 / BOARD_ROWS}%`,
                background:
                  row.terrain === "road"
                    ? "linear-gradient(180deg, #3a4a55 0%, #2b3942 50%, #22303a 100%)"
                    : "linear-gradient(180deg, #5b8a45 0%, #4d7a3f 55%, #3f6a36 100%)",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                boxShadow:
                  row.terrain === "road"
                    ? "inset 0 2px 6px rgba(0,0,0,0.35)"
                    : "inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
            >
              {row.terrain === "road" ? (
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "46%",
                    height: "8%",
                    background:
                      "repeating-linear-gradient(90deg, rgba(255,255,255,0.22) 0 16px, transparent 16px 34px)",
                  }}
                />
              ) : (
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    background:
                      "repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 3px, transparent 3px 7px)",
                  }}
                />
              )}
            </Box>
          ))}

          <Box
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              pointerEvents: "none",
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.12) 1px, transparent 1px)",
              backgroundSize: `${100 / BOARD_COLS}% ${100 / BOARD_ROWS}%`,
            }}
          />

          {state.rows
            .filter((row) => row.terrain === "road")
            .map((row) => {
              const left = vehicleLeftEdge(row, elapsed);
              const copies: number[] = [];
              const maxCopy = Math.ceil((BOARD_COLS + row.vehicleLength) / row.spacing) + 1;
              for (let copy = -1; copy <= maxCopy; copy++) {
                const x = left + copy * row.spacing;
                if (x < -row.vehicleLength || x > BOARD_COLS) {
                  continue;
                }
                copies.push(x);
              }
              return copies.map((x) => (
                <Box
                  key={`${row.row}-${x.toFixed(2)}`}
                  data-vehicle={`${row.row}:${x.toFixed(2)}`}
                  sx={{
                    position: "absolute",
                    top: `${rowToTop(row.row) + 6}%`,
                    height: `${100 / BOARD_ROWS - 12}%`,
                    left: `${(x * 100) / BOARD_COLS}%`,
                    width: `${(row.vehicleLength * 100) / BOARD_COLS}%`,
                    zIndex: 2,
                    borderRadius: "12%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-around",
                    px: "6%",
                    background:
                      row.direction > 0
                        ? "linear-gradient(90deg, #f4a261, #e76f51)"
                        : "linear-gradient(90deg, #5aa9e6, #2f6fb0)",
                    border: "1px solid rgba(255, 255, 255, 0.55)",
                    boxShadow:
                      "0 5px 12px rgba(0, 0, 0, 0.45), inset 0 2px 0 rgba(255,255,255,0.35)",
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: "16%",
                      height: "55%",
                      borderRadius: "18%",
                      bgcolor: "rgba(220, 245, 255, 0.75)",
                      border: "1px solid rgba(255,255,255,0.5)",
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      width: "16%",
                      height: "55%",
                      borderRadius: "18%",
                      bgcolor: "rgba(220, 245, 255, 0.65)",
                      border: "1px solid rgba(255,255,255,0.5)",
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      position: "absolute",
                      [row.direction > 0 ? "right" : "left"]: "-2%",
                      top: "38%",
                      width: "8%",
                      height: "22%",
                      borderRadius: "50%",
                      bgcolor: "#ffe08a",
                      boxShadow: "0 0 8px 2px rgba(255, 224, 138, 0.8)",
                    }}
                  />
                </Box>
              ));
            })}

          {[...state.coins.values()].map((coin) => {
            const visible = now >= coin.visibleAt;
            return (
              <Box
                key={coin.value}
                data-coin={`${coin.value}:${coin.col}:${coin.row}`}
                sx={{
                  position: "absolute",
                  left: `${(coin.col * 100) / BOARD_COLS}%`,
                  top: `${rowToTop(coin.row)}%`,
                  width: `${100 / BOARD_COLS}%`,
                  height: `${100 / BOARD_ROWS}%`,
                  zIndex: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: visible ? 1 : 0,
                  transform: visible ? "scale(1)" : "scale(0.2)",
                  transition: "opacity 0.2s ease, transform 0.25s ease",
                  pointerEvents: "none",
                }}
              >
                <Box
                  sx={{
                    width: "72%",
                    aspectRatio: "1",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontWeight: 900,
                    fontSize: "min(4.5vw, 22px)",
                    background:
                      coin.value === 5
                        ? "radial-gradient(circle at 35% 30%, #ffd166, #e76f51)"
                        : coin.value === 3
                          ? "radial-gradient(circle at 35% 30%, #c8f7c5, #2a9d8f)"
                          : "radial-gradient(circle at 35% 30%, #ffe8b0, #d4a017)",
                    border: "2px solid rgba(255, 255, 255, 0.9)",
                    boxShadow:
                      coin.value === 5
                        ? "0 0 14px 3px rgba(255, 170, 60, 0.75)"
                        : coin.value === 3
                          ? "0 0 12px 2px rgba(80, 220, 180, 0.65)"
                          : "0 0 10px 2px rgba(255, 210, 80, 0.55)",
                    animation: "coin-rush-coin-glow 1.4s ease-in-out infinite",
                    textShadow: "0 2px 2px rgba(0, 0, 0, 0.6)",
                    "@keyframes coin-rush-coin-glow": {
                      "0%, 100%": { transform: "scale(1)" },
                      "50%": { transform: "scale(1.08)" },
                    },
                  }}
                >
                  {coin.value}
                </Box>
              </Box>
            );
          })}

          {[...state.players.entries()].map(([sessionId, player]) => {
            const deathProgress = now - player.diedAt;
            if (
              !player.alive &&
              player.deathType !== "" &&
              deathProgress < COIN_RUSH_CONSTANTS.DEATH_ANIMATION_MS
            ) {
              const fall = player.deathType === "fall";
              const fallProgress = reducedMotion
                ? 1
                : Math.min(1, Math.max(0, deathProgress / COIN_RUSH_CONSTANTS.DEATH_ANIMATION_MS));
              const position = fall
                ? {
                    x: coinRushLerp(player.fromX, player.toX, fallProgress),
                    y: coinRushLerp(player.fromY, player.toY, fallProgress),
                    height: 0,
                  }
                : player.moving
                  ? playerPosition(player, now, reducedMotion)
                  : { x: player.x, y: player.y, height: 0 };
              return (
                <Box
                  key={sessionId}
                  data-death={player.deathType}
                  data-player={player.name}
                  sx={{
                    position: "absolute",
                    left: `${cellCenterLeft(position.x)}%`,
                    top: `${cellCenterTop(position.y)}%`,
                    transform: fall
                      ? "translate(-50%, -50%) rotate(24deg)"
                      : "translate(-50%, -50%) scaleY(0.45)",
                    opacity: Math.max(
                      0,
                      1 - deathProgress / COIN_RUSH_CONSTANTS.DEATH_ANIMATION_MS,
                    ),
                    zIndex: 5,
                    pointerEvents: "none",
                  }}
                >
                  <Box
                    sx={{
                      width: "min(8vw, 40px)",
                      aspectRatio: "1",
                      borderRadius: "50%",
                      bgcolor: player.color || "#777777",
                      border: "2px solid rgba(255,255,255,0.7)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontWeight: 900,
                    }}
                  >
                    {player.name.slice(0, 1).toUpperCase()}
                  </Box>
                </Box>
              );
            }
            if (!player.alive) {
              return (
                <Box
                  key={sessionId}
                  sx={{
                    position: "absolute",
                    left: `${cellCenterLeft(player.x)}%`,
                    top: `${cellCenterTop(player.y)}%`,
                    transform: "translate(-50%, -50%)",
                    zIndex: 3,
                  }}
                >
                  <Paper
                    sx={{ px: 0.5, py: 0.15, borderRadius: 999 }}
                    data-testid={`respawn-${player.name}`}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 800, whiteSpace: "nowrap" }}>
                      {Math.max(0, Math.ceil((player.respawnEndsAt - now) / 1000))}s
                    </Typography>
                  </Paper>
                </Box>
              );
            }
            if (!player.alive) {
              return null;
            }
            const position = playerPosition(player, now, reducedMotion);
            const isLocal = sessionId === selfSessionId;
            return (
              <Box
                key={sessionId}
                data-player={player.name}
                data-session={sessionId}
                data-local={isLocal}
                data-moving={player.moving}
                data-bouncing={player.bouncing}
                sx={{
                  position: "absolute",
                  left: `${cellCenterLeft(position.x)}%`,
                  top: `${cellCenterTop(position.y)}%`,
                  transform: `translate(-50%, -50%) translateY(${-position.height}px)`,
                  zIndex: 4,
                  pointerEvents: "none",
                  willChange: "transform, left, top",
                }}
              >
                <Box
                  sx={{
                    width: "min(8vw, 40px)",
                    aspectRatio: "1",
                    borderRadius: "50%",
                    background: `radial-gradient(circle at 35% 28%, ${player.color || "#ffffff"} 0%, ${player.color || "#ffffff"} 55%, rgba(0,0,0,0.22) 140%)`,
                    border: isLocal ? "3px solid #ffffff" : "2px solid rgba(255,255,255,0.85)",
                    boxShadow: isLocal
                      ? "0 0 0 5px rgba(255,255,255,0.28), 0 7px 14px rgba(0,0,0,0.55)"
                      : "0 6px 12px rgba(0,0,0,0.5)",
                    position: "relative",
                    transform:
                      player.push && player.moving
                        ? "scaleX(1.14) rotate(-8deg)"
                        : player.moving
                          ? "scale(1.06)"
                          : "scale(1)",
                    transition: "transform 0.08s ease-out",
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      position: "absolute",
                      top: "26%",
                      left: "24%",
                      width: "16%",
                      height: "22%",
                      borderRadius: "50%",
                      bgcolor: "rgba(20, 24, 30, 0.9)",
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      position: "absolute",
                      top: "26%",
                      right: "24%",
                      width: "16%",
                      height: "22%",
                      borderRadius: "50%",
                      bgcolor: "rgba(20, 24, 30, 0.9)",
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      position: "absolute",
                      bottom: "20%",
                      left: "30%",
                      width: "40%",
                      height: "16%",
                      borderRadius: "50%",
                      borderBottom: "2px solid rgba(20, 24, 30, 0.85)",
                    }}
                  />
                  {isLocal && (
                    <Box
                      aria-hidden
                      sx={{
                        position: "absolute",
                        top: "-34%",
                        left: "50%",
                        width: 0,
                        height: 0,
                        borderLeft: "7px solid transparent",
                        borderRight: "7px solid transparent",
                        borderBottom: "10px solid #ffffff",
                        transform: "translateX(-50%)",
                        filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.6))",
                      }}
                    />
                  )}
                </Box>
                <Box
                  component="span"
                  sx={{
                    position: "absolute",
                    left: "50%",
                    top: "100%",
                    transform: "translateX(-50%)",
                    mt: 0.25,
                    fontSize: "min(3vw, 12px)",
                    fontWeight: 700,
                    color: "#ffffff",
                    bgcolor: "rgba(0,0,0,0.62)",
                    borderRadius: 999,
                    px: 0.75,
                    py: 0.1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {player.name}
                  {isLocal ? " (you)" : ""}
                </Box>
              </Box>
            );
          })}

          {scorePop !== null && local !== undefined && (
            <Box
              key={scorePop.id}
              role="status"
              sx={{
                position: "absolute",
                left: `${cellCenterLeft(local.x)}%`,
                top: `${cellCenterTop(local.y)}%`,
                transform: "translate(-50%, -120%)",
                zIndex: 9,
                pointerEvents: "none",
                color: "#ffe08a",
                fontWeight: 900,
                fontSize: "min(6vw, 28px)",
                textShadow: "0 2px 6px rgba(0,0,0,0.8)",
                animation: "coin-rush-score-pop 0.9s ease-out forwards",
                "@keyframes coin-rush-score-pop": {
                  "0%": { opacity: 1, transform: "translate(-50%, -120%) scale(0.7)" },
                  "100%": { opacity: 0, transform: "translate(-50%, -260%) scale(1.15)" },
                },
              }}
            >
              {scorePop.text}
            </Box>
          )}

          {state.phase === "countdown" && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "rgba(0, 0, 0, 0.5)",
                zIndex: 10,
                p: 2,
              }}
            >
              <Paper sx={{ p: 2, textAlign: "center", minWidth: 220 }}>
                <Typography component="h1" variant="h1">
                  Round {state.roundNumber}
                </Typography>
                <Typography
                  component="h2"
                  variant="h2"
                  aria-live="polite"
                  sx={{ fontSize: "2rem" }}
                >
                  {countdownRemaining}
                </Typography>
              </Paper>
            </Box>
          )}

          {state.phase === "countdown" && (
            <HowToPlay
              title="How to play Coin Rush"
              points={[
                "Swipe in any direction to jump one tile.",
                "Collect 1, 3, and 5-point coins before rivals do.",
                "Vehicles kill — and so does being pushed off the board.",
                "First to 10 points wins the round; best of three wins the match.",
              ]}
            />
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
                p: 2,
                pointerEvents: "none",
              }}
            >
              <Paper sx={{ p: 2, textAlign: "center", maxWidth: 420, width: "100%" }}>
                <Typography component="h1" variant="h1" aria-live="polite">
                  Round {state.roundNumber} result
                </Typography>
                <Typography variant="h2" sx={{ mt: 0.5 }} aria-live="polite">
                  {roundResultHeadline(state)}
                </Typography>
                <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                  {[...state.players.values()]
                    .sort((a, b) => a.joinedOrder - b.joinedOrder)
                    .map((player) => (
                      <Stack
                        key={player.name}
                        direction="row"
                        sx={{ justifyContent: "space-between" }}
                      >
                        <Typography variant="body2">{player.name}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {player.score} pts · {player.roundWins} win
                          {player.roundWins === 1 ? "" : "s"}
                        </Typography>
                      </Stack>
                    ))}
                </Stack>
              </Paper>
            </Box>
          )}
        </Box>
      </Box>

      <Paper square sx={{ p: 1 }}>
        <Stack spacing={0.75}>
          {roomError !== null && <Alert severity="error">{roomError}</Alert>}
          <Typography
            variant="body2"
            align="center"
            aria-live="polite"
            data-testid="coin-rush-arena-status"
          >
            {statusText}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}

function roundResultHeadline(state: CoinRushState): string {
  const winners = [...state.roundWinnerSessionIds]
    .map((sessionId) => state.players.get(sessionId)?.name)
    .filter((name): name is string => name !== undefined);
  if (winners.length === 0) {
    return "No winner this round";
  }
  return winners.length === 1
    ? `${winners[0]} wins the round`
    : `${winners.join(" & ")} share the round win`;
}
