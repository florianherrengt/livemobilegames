import { type KartRacingTrack, nearestRoadPoint, type TrackPoint } from "@phone-party/protocol";

import { KART_RACING_SERVER_CONSTANTS } from "../../../src/games/kart-racing/constants.js";
import { updateRuntime } from "../../../src/games/kart-racing/engine.js";
import {
  createRuntime,
  createRuntimePlayer,
  createSettings,
  startMatch,
} from "../../../src/games/kart-racing/runtime.js";
import { angleDifference, pointAlongCenterline } from "../../../src/games/kart-racing/track.js";
import type { KartRacingRuntime, RuntimePlayer } from "../../../src/games/kart-racing/types.js";

export function createTestRuntime(playerCount = 2): KartRacingRuntime {
  const runtime = createRuntime(createSettings(true));
  for (let index = 0; index < playerCount; index++) {
    const sessionId = `session-${index}`;
    runtime.players.set(
      sessionId,
      createRuntimePlayer(
        sessionId,
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        `Player ${index}`,
        index,
        "",
      ),
    );
  }
  startMatch(runtime, 1_000);
  return runtime;
}

function nearestCenterlineIndex(track: KartRacingTrack, point: TrackPoint): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < track.centerline.length; index++) {
    const candidate = track.centerline[index] ?? { x: 0, y: 0 };
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function obstacleAvoidance(track: KartRacingTrack, player: RuntimePlayer): number | null {
  const hx = Math.cos(player.heading);
  const hy = Math.sin(player.heading);
  for (const obstacle of track.obstacles) {
    const dx = obstacle.x - player.x;
    const dy = obstacle.y - player.y;
    const ahead = dx * hx + dy * hy;
    if (ahead < 0 || ahead > 160) {
      continue;
    }
    const lateral = -dx * hy + dy * hx;
    const clear = obstacle.radius + KART_RACING_SERVER_CONSTANTS.KART_RADIUS + 18;
    if (Math.abs(lateral) < clear) {
      return lateral > 0 ? -1 : 1;
    }
  }
  return null;
}

/**
 * A deterministic test driver that steers a kart toward a point just ahead on
 * the centreline. It sends the same kind of steering intent a phone player
 * sends; it does not touch server state directly beyond the accepted input.
 */
export function setAutopilotSteering(
  runtime: KartRacingRuntime,
  player: RuntimePlayer,
  lookahead = 150,
): void {
  const track = runtime.track;
  const nearest = nearestRoadPoint(track, { x: player.x, y: player.y });
  const index = nearestCenterlineIndex(track, nearest);
  const target = pointAlongCenterline(track, index, lookahead);
  const desired = Math.atan2(target.y - player.y, target.x - player.x);
  const error = angleDifference(player.heading, desired);
  const avoidance = obstacleAvoidance(track, player);
  player.targetSteering = avoidance === null ? Math.max(-1, Math.min(1, error * 1.8)) : avoidance;
}

export function runAutopilot(
  runtime: KartRacingRuntime,
  startNow: number,
  maxDurationMs: number,
  stepMs = 50,
): number {
  let now = startNow;
  const end = startNow + maxDurationMs;
  while (now < end && runtime.phase !== "finished" && runtime.phase !== "lobby") {
    if (runtime.phase === "countdown" || runtime.phase === "racing") {
      for (const player of runtime.players.values()) {
        if (player.connected && !player.removed && !player.finished) {
          setAutopilotSteering(runtime, player);
        }
      }
    }
    now += stepMs;
    updateRuntime(runtime, now);
  }
  return now;
}
