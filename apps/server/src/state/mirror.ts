import type { RuntimePlatform, RuntimePlayer } from "../game/types.js";
import type { PlatformState } from "./PlatformState.js";
import type { PlayerState } from "./PlayerState.js";

export function copyPlayer(target: PlayerState, source: RuntimePlayer): void {
  target.name = source.name;
  target.connected = source.connected;
  target.participating = source.participating;
  target.alive = source.alive;
  target.jumping = source.jumping;
  target.currentPlatformId = source.currentPlatformId;
  target.fromPlatformId = source.fromPlatformId;
  target.targetPlatformId = source.targetPlatformId;
  target.jumpStartedAt = source.jumpStartedAt;
  target.jumpEndsAt = source.jumpEndsAt;
  target.lastAcceptedSequence = source.lastAcceptedSequence;
  target.joinedOrder = source.joinedOrder;
}

export function copyPlatform(target: PlatformState, source: RuntimePlatform): void {
  target.id = source.id;
  target.gridX = source.gridX;
  target.gridY = source.gridY;
  target.state = source.state;
}
