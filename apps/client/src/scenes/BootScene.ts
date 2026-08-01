import { TILE_SIZE } from "@falling-platforms/shared";
import Phaser from "phaser";

import { getPendingContext } from "../game/createGame.js";

/**
 * Generates every runtime texture from Graphics so the game needs no art
 * assets. Textures are plain white shapes that get tinted per entity.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    this.generateTextures();
    const context = getPendingContext();
    if (context) {
      this.scene.start("Game", context);
    }
  }

  private generateTextures(): void {
    const graphics = this.add.graphics();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(0, 0, 1, 1);
    graphics.generateTexture("pixel", 1, 1);
    graphics.clear();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(64, 64, 64);
    graphics.generateTexture("circle", 128, 128);
    graphics.clear();

    graphics.lineStyle(6, 0xffffff, 1);
    graphics.strokeCircle(64, 64, 58);
    graphics.generateTexture("circle-outline", 128, 128);
    graphics.clear();

    graphics.fillStyle(0x000000, 1);
    graphics.fillEllipse(64, 64, 116, 72);
    graphics.generateTexture("shadow", 128, 128);
    graphics.clear();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4, 10);
    graphics.generateTexture("platform-stable", TILE_SIZE, TILE_SIZE);
    graphics.clear();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4, 10);
    graphics.generateTexture("platform-warning", TILE_SIZE, TILE_SIZE);
    graphics.clear();

    graphics.destroy();
  }
}
