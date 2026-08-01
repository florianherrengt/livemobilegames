import { TILE_PITCH } from "@falling-platforms/shared";

/** Portrait logical resolution. Phaser scales this to fit any phone. */
export const GAME_WIDTH = 390;
export const GAME_HEIGHT = 844;

/** Roughly seven platforms across the portrait screen. */
export const CAMERA_ZOOM = GAME_WIDTH / (TILE_PITCH * 7);

/** Minimum pointer travel (logical px) for a swipe to count as a hop. */
export const SWIPE_THRESHOLD = 24;

export const COLORS = {
  void: 0x0b0e14,
  platformStable: 0xcfe3f2,
  platformWarning: 0xffb020,
  outline: 0xffffff,
  buffered: 0x8ad7ff,
  invalid: 0xff5d6c,
  localRing: 0xffffff,
  shadow: 0x000000,
} as const;

export const TEXT_STYLE = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontSize: "13px",
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 3,
} as const;
