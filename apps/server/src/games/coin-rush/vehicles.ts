import { COIN_RUSH_CONSTANTS, vehicleLeftEdge } from "@phone-party/protocol";

import type { RuntimeRow } from "./types.js";

/**
 * True when a player's horizontal interval overlaps any copy of the row's
 * vehicle stream. Both shapes are shrunk by the shared collision margins so a
 * decorative edge or transparent corner does not kill the player.
 */
export function vehicleOverlapsInterval(
  row: RuntimeRow,
  elapsedMs: number,
  centerX: number,
  halfWidth: number,
): boolean {
  if (row.terrain !== "road" || row.spacing <= 0) {
    return false;
  }
  const left = vehicleLeftEdge(row, elapsedMs);
  const vehicleLeft = left + COIN_RUSH_CONSTANTS.VEHICLE_COLLISION_MARGIN;
  const vehicleRight = left + row.vehicleLength - COIN_RUSH_CONSTANTS.VEHICLE_COLLISION_MARGIN;
  const playerLeft = centerX - halfWidth;
  const playerRight = centerX + halfWidth;
  const maxCopy = Math.ceil((COIN_RUSH_CONSTANTS.COL_COUNT + row.vehicleLength) / row.spacing) + 1;
  for (let copy = -1; copy <= maxCopy; copy++) {
    const copyLeft = vehicleLeft + copy * row.spacing;
    const copyRight = vehicleRight + copy * row.spacing;
    if (copyLeft < playerRight && copyRight > playerLeft) {
      return true;
    }
  }
  return false;
}

export function vehicleOverlapsCell(row: RuntimeRow, elapsedMs: number, col: number): boolean {
  const halfWidth = (1 - 2 * COIN_RUSH_CONSTANTS.PLAYER_COLLISION_MARGIN) / 2;
  return vehicleOverlapsInterval(row, elapsedMs, col + 0.5, halfWidth);
}
