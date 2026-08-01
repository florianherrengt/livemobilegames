import {
  type ClientPlatformState,
  type MatchPhase,
  type PlatformStateValue,
  parsePlatformId,
  platformCenterX,
  platformCenterY,
  platformId,
  TILE_SIZE,
} from "@falling-platforms/shared";
import type Phaser from "phaser";

import { COLORS } from "../game/config.js";

type PlatformDisplay = {
  image: Phaser.GameObjects.Image;
  state: PlatformStateValue;
  baseX: number;
  baseY: number;
};

export type OutlineOptions = {
  phase: MatchPhase;
  localAlive: boolean;
  localGrounded: boolean;
  localPlatformId: string;
  bufferedTarget: string | null;
  occupiedPlatformIds: ReadonlySet<string>;
  platforms: ReadonlyMap<string, ClientPlatformState>;
  arenaSide: number;
};

/** Renders platforms, their state transitions and the input feedback layers. */
export class ArenaRenderer {
  private scene: Phaser.Scene;
  private platforms = new Map<string, PlatformDisplay>();
  private outlineLayer: Phaser.GameObjects.Graphics;
  private effectLayer: Phaser.GameObjects.Graphics;
  private arenaSide = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.outlineLayer = scene.add.graphics().setDepth(5);
    this.effectLayer = scene.add.graphics().setDepth(6);
  }

  sync(platforms: ReadonlyMap<string, ClientPlatformState>, arenaSide: number): void {
    if (arenaSide !== this.arenaSide) {
      this.clearAll();
      this.arenaSide = arenaSide;
    }
    if (arenaSide <= 0) {
      return;
    }

    for (const platform of platforms.values()) {
      let display = this.platforms.get(platform.id);
      if (!display) {
        display = {
          image: this.scene.add.image(0, 0, "platform-stable").setOrigin(0.5).setDepth(1),
          state: platform.state,
          baseX: platformCenterX(platform.gridX, arenaSide),
          baseY: platformCenterY(platform.gridY, arenaSide),
        };
        display.image.setPosition(display.baseX, display.baseY);
        this.platforms.set(platform.id, display);
      }
      this.applyState(display, platform.state);
    }

    for (const [id, display] of [...this.platforms]) {
      if (!platforms.has(id)) {
        display.image.destroy();
        this.platforms.delete(id);
      }
    }
  }

  updateOutlines(options: OutlineOptions): void {
    this.outlineLayer.clear();
    const {
      phase,
      localAlive,
      localGrounded,
      localPlatformId,
      bufferedTarget,
      occupiedPlatformIds,
      platforms,
      arenaSide,
    } = options;
    if (
      phase !== "playing" ||
      !localAlive ||
      !localGrounded ||
      !localPlatformId ||
      arenaSide <= 0
    ) {
      return;
    }

    const source = parsePlatformId(localPlatformId);
    if (!source) {
      return;
    }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const gridX = source.gridX + dx;
        const gridY = source.gridY + dy;
        if (gridX < 0 || gridY < 0 || gridX >= arenaSide || gridY >= arenaSide) {
          continue;
        }
        const id = platformId(gridX, gridY);
        const platform = platforms.get(id);
        if (!platform || platform.state === "gone" || occupiedPlatformIds.has(id)) {
          continue;
        }
        this.strokeTile(gridX, gridY, arenaSide, COLORS.outline, 2, 0.32);
      }
    }

    if (bufferedTarget) {
      const parts = parsePlatformId(bufferedTarget);
      const platform = platforms.get(bufferedTarget);
      if (parts && platform && platform.state !== "gone") {
        this.strokeTile(parts.gridX, parts.gridY, arenaSide, COLORS.buffered, 3, 0.75);
      }
    }
  }

  /** Brief muted pulse for an invalid input (e.g. a swipe at a gone tile). */
  invalidPulse(platformIdString: string, arenaSide: number): void {
    const parts = parsePlatformId(platformIdString);
    if (!parts || arenaSide <= 0) {
      return;
    }
    const x = platformCenterX(parts.gridX, arenaSide);
    const y = platformCenterY(parts.gridY, arenaSide);
    const marker = this.scene.add
      .image(x, y, "circle")
      .setTint(COLORS.invalid)
      .setAlpha(0.65)
      .setScale(0.26)
      .setDepth(6);
    this.scene.tweens.add({
      targets: marker,
      scale: 0.42,
      alpha: 0,
      duration: 280,
      ease: "Sine.easeOut",
      onComplete: () => marker.destroy(),
    });
  }

  clearAll(): void {
    for (const display of this.platforms.values()) {
      display.image.destroy();
    }
    this.platforms.clear();
    this.arenaSide = 0;
    this.outlineLayer.clear();
    this.effectLayer.clear();
  }

  private strokeTile(
    gridX: number,
    gridY: number,
    arenaSide: number,
    color: number,
    width: number,
    alpha: number,
  ): void {
    const x = platformCenterX(gridX, arenaSide);
    const y = platformCenterY(gridY, arenaSide);
    this.outlineLayer.lineStyle(width, color, alpha);
    this.outlineLayer.strokeRoundedRect(
      x - TILE_SIZE / 2,
      y - TILE_SIZE / 2,
      TILE_SIZE,
      TILE_SIZE,
      10,
    );
  }

  private applyState(display: PlatformDisplay, state: PlatformStateValue): void {
    if (display.state === state) {
      return;
    }
    const previous = display.state;
    display.state = state;

    if (state === "warning") {
      display.image.setTexture("platform-warning");
      display.image.setTint(COLORS.platformWarning);
      display.image.setPosition(display.baseX, display.baseY);
      display.image.setVisible(true);
      display.image.setAlpha(1);
      display.image.setScale(1);
      this.scene.tweens.killTweensOf(display.image);
      this.scene.tweens.add({
        targets: display.image,
        scale: { from: 1, to: 1.08 },
        alpha: { from: 1, to: 0.82 },
        yoyo: true,
        repeat: -1,
        duration: 220,
        ease: "Sine.easeInOut",
      });
    } else if (state === "gone") {
      this.scene.tweens.killTweensOf(display.image);
      display.image.setTexture(previous === "warning" ? "platform-warning" : "platform-stable");
      display.image.setTint(
        previous === "warning" ? COLORS.platformWarning : COLORS.platformStable,
      );
      this.scene.tweens.add({
        targets: display.image,
        scale: 0.3,
        y: display.image.y + 24,
        alpha: 0,
        duration: 320,
        ease: "Sine.easeIn",
        onComplete: () => {
          display.image.setVisible(false);
        },
      });
    } else {
      this.scene.tweens.killTweensOf(display.image);
      display.image.setTexture("platform-stable");
      display.image.setTint(COLORS.platformStable);
      display.image.setPosition(display.baseX, display.baseY);
      display.image.setVisible(true);
      display.image.setAlpha(1);
      display.image.setScale(1);
    }
  }
}
