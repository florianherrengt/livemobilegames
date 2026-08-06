import type { FlappyRaceServerConstants } from "./constants.js";

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
  config: FlappyRaceServerConstants,
): BirdKinematics {
  const dt = dtMs / 1000;
  let vy = bird.vy + config.GRAVITY * dt;
  if (vy > config.MAX_FALL_SPEED) {
    vy = config.MAX_FALL_SPEED;
  }
  if (flap) {
    vy = -config.FLAP_IMPULSE;
  }
  let y = bird.y + vy * dt;

  const maxY = config.WORLD_HEIGHT - config.BIRD_HEIGHT;
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
