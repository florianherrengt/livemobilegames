import Phaser from "phaser";

import { getPendingContext } from "../game/createGame.js";

/**
 * Generates every runtime texture from Graphics so the game needs no art
 * assets. Textures are plain white shapes tinted per entity.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    this.generateTextures();
    const context = getPendingContext();
    if (context) {
      this.scene.start("Flappy", context);
    }
  }

  private generateTextures(): void {
    const graphics = this.add.graphics();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(0, 0, 1, 1);
    graphics.generateTexture("pixel", 1, 1);
    graphics.clear();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(64, 64, 62);
    graphics.generateTexture("bird-body", 128, 128);
    graphics.clear();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillEllipse(64, 76, 96, 46);
    graphics.generateTexture("bird-wing", 128, 128);
    graphics.clear();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillTriangle(34, 26, 112, 64, 34, 102);
    graphics.generateTexture("bird-beak", 128, 128);
    graphics.clear();

    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(64, 64, 10);
    graphics.generateTexture("bird-eye", 128, 128);
    graphics.clear();

    graphics.fillStyle(0x000000, 1);
    graphics.fillCircle(64, 64, 5);
    graphics.generateTexture("bird-pupil", 128, 128);
    graphics.clear();

    graphics.destroy();
  }
}
