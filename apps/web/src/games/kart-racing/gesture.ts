import { KART_RACING_CONSTANTS } from "@phone-party/protocol";

export interface SwipeThresholds {
  distancePx: number;
  timeMs: number;
  verticalRatio: number;
}

export const SWIPE_THRESHOLDS: SwipeThresholds = {
  distancePx: KART_RACING_CONSTANTS.SWIPE_DISTANCE_PX,
  timeMs: KART_RACING_CONSTANTS.SWIPE_TIME_MS,
  verticalRatio: KART_RACING_CONSTANTS.SWIPE_VERTICAL_RATIO,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Relative steering amount from the finger's horizontal offset against the
 * touch origin. A small movement produces a gentle turn; the amount is capped
 * at full steering.
 */
export function steeringFromOffset(
  offsetX: number,
  maxPx = KART_RACING_CONSTANTS.STEER_MAX_OFFSET_PX,
): number {
  if (maxPx <= 0) {
    return 0;
  }
  return clamp(offsetX / maxPx, -1, 1);
}

export type SwipeOutcome = "shoot" | "none";

/**
 * Decides whether a gesture is a deliberate upward swipe. Requires enough
 * upward distance, completion within the time window, and vertical movement
 * clearly stronger than horizontal movement, so diagonal steering never
 * accidentally fires.
 */
export function swipeOutcome(
  offsetX: number,
  offsetY: number,
  elapsedMs: number,
  thresholds: SwipeThresholds = SWIPE_THRESHOLDS,
): SwipeOutcome {
  if (elapsedMs > thresholds.timeMs) {
    return "none";
  }
  if (offsetY < thresholds.distancePx) {
    return "none";
  }
  if (Math.abs(offsetX) * thresholds.verticalRatio > offsetY) {
    return "none";
  }
  return "shoot";
}
