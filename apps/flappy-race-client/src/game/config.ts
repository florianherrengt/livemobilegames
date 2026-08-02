import { FLAPPY_RACE_CONFIG } from "@falling-platforms/flappy-race";

/** Portrait logical resolution. Phaser scales this to fit any phone. */
export const GAME_WIDTH = FLAPPY_RACE_CONFIG.worldWidth;
export const GAME_HEIGHT = FLAPPY_RACE_CONFIG.worldHeight;

export const COLORS = {
  backgroundTop: 0x0c1520,
  backgroundBottom: 0x1c3a52,
  ground: 0x22303d,
  obstacle: 0x9db8c9,
  obstacleEdge: 0x5c7a8a,
  beak: 0xf4a259,
} as const;

export const TEXT_STYLE = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontSize: "14px",
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 3,
} as const;
