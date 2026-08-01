/**
 * Stable player colours derived from a hash of the session id.
 * The same player always gets the same colour throughout a game.
 */

export const PLAYER_COLOURS = [
  "#e6194B", // red
  "#3cb44b", // green
  "#4363d8", // blue
  "#f58231", // orange
  "#911eb4", // purple
  "#42d4f4", // cyan
  "#f032e6", // magenta
  "#9A6324", // brown
] as const;

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getPlayerColour(playerId: string): string {
  return PLAYER_COLOURS[hashString(playerId) % PLAYER_COLOURS.length] ?? "#888888";
}

/** A readable foreground colour (black/white) for a given background colour. */
export function readableTextOn(background: string): string {
  // background is hex like #RRGGBB
  const hex = background.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return "#000000";
  // Relative luminance (approx).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}
