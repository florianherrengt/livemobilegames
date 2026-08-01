import type { Room } from "colyseus";

/**
 * Advances a Colyseus room clock by a delta. Scheduled room timers execute
 * during the tick. Real-time ticks continue in the background, so tests should
 * assert with waitFor predicates after advancing.
 */
export function advanceRoomTime(room: Room, deltaMs: number): void {
  const tick = room.clock.tick as (time: number) => void;
  tick(room.clock.currentTime + deltaMs);
}
