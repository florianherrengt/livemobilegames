import { parsePlatformId, platformId } from "@falling-platforms/shared";
import type Phaser from "phaser";

import { SWIPE_THRESHOLD } from "../game/config.js";
import type { GameScene } from "../scenes/GameScene.js";

export type SwipeDirection = "up" | "down" | "left" | "right";

export const SWIPE_DELTAS: Record<SwipeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

function resolveDirection(dx: number, dy: number): SwipeDirection {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

/**
 * Swipe-to-hop input. A swipe anywhere on the arena resolves to the adjacent
 * platform in the dominant cardinal direction (diagonal flicks snap to the
 * stronger axis). A short touch with no movement is ignored for players and
 * lets spectators tap a living player to follow.
 */
export class SwipeController {
  private scene: GameScene;
  private starts = new Map<number, { x: number; y: number; handled: boolean }>();

  constructor(scene: GameScene) {
    this.scene = scene;
  }

  attach(): void {
    this.scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.starts.set(pointer.id, { x: pointer.x, y: pointer.y, handled: false });
    });
    this.scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.handleDrag(pointer);
    });
    this.scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const start = this.starts.get(pointer.id);
      this.starts.delete(pointer.id);
      if (!start) {
        return;
      }
      if (start.handled) {
        return;
      }
      const dx = pointer.x - start.x;
      const dy = pointer.y - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_THRESHOLD) {
        // The release delta crossed the threshold even without move events
        // (fast flick): resolve it like a drag.
        this.handleSwipe(resolveDirection(dx, dy));
        return;
      }
      // A short touch with no significant travel: spectator follow only.
      this.handleTap(pointer);
    });
    this.scene.input.on("pointercancel", (pointer: Phaser.Input.Pointer) => {
      this.starts.delete(pointer.id);
    });
  }

  /** Fires the hop as soon as the swipe threshold is crossed. */
  private handleDrag(pointer: Phaser.Input.Pointer): void {
    const start = this.starts.get(pointer.id);
    if (!start || start.handled) {
      return;
    }
    const dx = pointer.x - start.x;
    const dy = pointer.y - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) {
      return;
    }
    start.handled = true;
    this.handleSwipe(resolveDirection(dx, dy));
  }

  private handleSwipe(direction: SwipeDirection): void {
    const state = this.scene.getLatestState();
    if (state?.phase !== "playing") {
      return;
    }
    const local = state.players.get(this.scene.getSessionId());
    if (!local?.participating || !local.alive) {
      return;
    }
    const current = parsePlatformId(local.currentPlatformId);
    if (!current) {
      return;
    }

    const delta = SWIPE_DELTAS[direction];
    const gridX = current.gridX + delta.dx;
    const gridY = current.gridY + delta.dy;
    if (gridX < 0 || gridY < 0 || gridX >= state.arenaSide || gridY >= state.arenaSide) {
      // Swiping off the arena edge: pulse the player's own tile as feedback.
      this.scene.invalidPulse(local.currentPlatformId);
      return;
    }

    if (local.jumping) {
      // Airborne swipes only buffer the most recent direction; it is resolved
      // and validated against the actual landing platform.
      this.scene.bufferDirection(direction);
      return;
    }

    const targetId = platformId(gridX, gridY);
    const target = state.platforms.get(targetId);
    if (!target?.state || target.state === "gone" || this.scene.isTargetOccupied(targetId)) {
      this.scene.invalidPulse(targetId);
      return;
    }
    this.scene.requestHop(targetId);
  }

  private handleTap(pointer: Phaser.Input.Pointer): void {
    const state = this.scene.getLatestState();
    if (state?.phase !== "playing") {
      return;
    }
    const local = state.players.get(this.scene.getSessionId());
    if (!local || (local.participating && local.alive)) {
      return;
    }
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.scene.tryFollowAt(world.x, world.y);
  }
}
