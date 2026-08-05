/**
 * Stable player colours derived from a hash of the session id. The same player
 * keeps the same colour throughout a game.
 */
export const PLAYER_COLOURS = [
  "#e6194B",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#9A6324",
] as const;

function hashString(s: string): number {
  return Math.abs([...s].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0));
}

export function getPlayerColour(playerId: string): string {
  return PLAYER_COLOURS[hashString(playerId) % PLAYER_COLOURS.length] ?? "#888888";
}

/** A readable foreground colour (black/white) for a given background colour. */
export function readableTextOn(background: string): string {
  const hex = background.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    return "#000000";
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}
