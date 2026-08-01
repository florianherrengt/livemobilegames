import {
  HOP_DURATION_MS,
  type HopRejectionReason,
  isAdjacent,
  type MatchRuntime,
  parsePlatformId,
  type RuntimePlayer,
} from "@falling-platforms/shared";

export type LandingResult = "landed" | "eliminated";

/**
 * True when another participant is standing on the platform or has already
 * committed an in-flight jump that lands on it. A platform can hold at most
 * one player, so such targets are not hop targets.
 */
export function isPlatformOccupied(
  runtime: MatchRuntime,
  platformId: string,
  exceptSessionId: string,
): boolean {
  for (const player of runtime.players.values()) {
    if (player.sessionId === exceptSessionId || !player.participating || !player.alive) {
      continue;
    }
    if (player.jumping) {
      if (player.targetPlatformId === platformId) {
        return true;
      }
    } else if (player.currentPlatformId === platformId) {
      return true;
    }
  }
  return false;
}

/**
 * Server-authoritative hop validation. Every rule is checked against server
 * state only; nothing from the client except sequence and target is trusted.
 * Returns null when the hop is acceptable.
 */
export function validateHop(
  runtime: MatchRuntime,
  player: RuntimePlayer,
  targetPlatformId: string,
  sequence: number,
): HopRejectionReason | null {
  if (runtime.phase !== "playing") {
    return "not-playing";
  }
  if (!player.participating || !player.alive) {
    return "not-alive";
  }
  if (player.jumping) {
    return "already-jumping";
  }
  if (sequence <= player.lastAcceptedSequence) {
    return "stale-sequence";
  }

  const parts = parsePlatformId(targetPlatformId);
  if (!parts) {
    return "invalid-target";
  }
  const target = runtime.platforms.get(targetPlatformId);
  if (!target) {
    return "invalid-target";
  }
  if (target.state === "gone") {
    return "target-gone";
  }

  const source = runtime.platforms.get(player.currentPlatformId);
  if (!source) {
    return "invalid-target";
  }
  if (targetPlatformId === player.currentPlatformId) {
    return "not-adjacent";
  }
  if (!isAdjacent(source.gridX, source.gridY, parts.gridX, parts.gridY)) {
    return "not-adjacent";
  }
  if (isPlatformOccupied(runtime, targetPlatformId, player.sessionId)) {
    return "target-occupied";
  }
  return null;
}

export function startHop(
  runtime: MatchRuntime,
  player: RuntimePlayer,
  targetPlatformId: string,
  sequence: number,
  now: number,
): void {
  player.fromPlatformId = player.currentPlatformId;
  player.targetPlatformId = targetPlatformId;
  player.jumpStartedAt = now;
  player.jumpEndsAt = now + (runtime.settings.hopDurationMs || HOP_DURATION_MS);
  player.jumping = true;
  player.lastAcceptedSequence = sequence;
}

export function isJumpActive(player: RuntimePlayer, now: number): boolean {
  return player.jumping && now < player.jumpEndsAt;
}

/**
 * Resolves a jump whose deadline has been reached. Landing on a gone platform
 * (or a platform that disappeared in this same update) eliminates the player.
 */
export function resolveLanding(runtime: MatchRuntime, player: RuntimePlayer): LandingResult {
  const target = runtime.platforms.get(player.targetPlatformId);
  if (!target || target.state === "gone") {
    player.jumping = false;
    player.fromPlatformId = "";
    player.targetPlatformId = "";
    player.jumpStartedAt = 0;
    player.jumpEndsAt = 0;
    return "eliminated";
  }

  player.currentPlatformId = player.targetPlatformId;
  player.fromPlatformId = "";
  player.targetPlatformId = "";
  player.jumpStartedAt = 0;
  player.jumpEndsAt = 0;
  player.jumping = false;
  return "landed";
}
