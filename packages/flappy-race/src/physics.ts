import type { FlappyRaceConfig } from "./constants.js";

export interface BirdKinematics {
  y: number;
  vy: number;
}

/**
 * One fixed simulation step of the Flappy-style vertical movement model.
 *
 * - A flap impulse immediately sets upward velocity.
 * - Gravity is applied every step.
 * - Downward velocity is clamped to the configured maximum.
 * - The bird is clamped inside the world; velocity that would push it out is
 *   cancelled (no bounce, no elimination).
 */
export function stepBird(
  bird: BirdKinematics,
  flap: boolean,
  dtMs: number,
  config: FlappyRaceConfig,
): BirdKinematics {
  const dt = dtMs / 1000;
  let vy = bird.vy + config.gravity * dt;
  if (vy > config.maxFallSpeed) {
    vy = config.maxFallSpeed;
  }
  if (flap) {
    vy = -config.flapImpulse;
  }
  let y = bird.y + vy * dt;

  const maxY = config.worldHeight - config.birdHeight;
  if (y < 0) {
    y = 0;
    if (vy < 0) {
      vy = 0;
    }
  } else if (y > maxY) {
    y = maxY;
    if (vy > 0) {
      vy = 0;
    }
  }
  return { y, vy };
}

/**
 * Client-side extrapolation from the last authoritative snapshot. Uses the
 * server-reported velocity so the rendered bird tracks the authoritative
 * position instead of leading it; deaths therefore match what the player sees.
 */
export function extrapolateBirdY(
  y: number,
  vy: number,
  deltaMs: number,
  config: FlappyRaceConfig,
): number {
  const dt = Math.max(0, deltaMs) / 1000;
  let next = y + vy * dt;
  const maxY = config.worldHeight - config.birdHeight;
  if (next < 0) {
    next = 0;
  } else if (next > maxY) {
    next = maxY;
  }
  return next;
}
