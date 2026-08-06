import type { FlappyRaceServerConstants } from "./constants.js";

export type FlapTimestampMap = Map<string, number[]>;

export function createFlapTimestampMap(): FlapTimestampMap {
  return new Map();
}

/**
 * Sliding-window flap limiter. Returns false once a player exceeds
 * maxFlapsPerSecond within the trailing second so accidental floods or naive
 * client spam cannot drive unbounded server work.
 */
export function consumeFlapRateLimit(
  config: Pick<FlappyRaceServerConstants, "MAX_FLAPS_PER_SECOND">,
  timestamps: FlapTimestampMap,
  sessionId: string,
  now: number,
): boolean {
  const recent = (timestamps.get(sessionId) ?? []).filter((timestamp) => timestamp >= now - 1000);
  if (recent.length >= config.MAX_FLAPS_PER_SECOND) {
    timestamps.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  timestamps.set(sessionId, recent);
  return true;
}
