import Phaser from "phaser";

import type { GameClient } from "../networking/GameClient.js";
import { BootScene } from "../scenes/BootScene.js";
import { FlappyScene } from "../scenes/FlappyScene.js";
import type { ScreensApi } from "../ui/screens.js";
import { GAME_HEIGHT, GAME_WIDTH } from "./config.js";

export type GameContext = {
  client: GameClient;
  screens: ScreensApi;
};

let pendingContext: GameContext | null = null;

export function getPendingContext(): GameContext | null {
  return pendingContext;
}

export function createGame(context: GameContext): Phaser.Game {
  pendingContext = context;
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game-container",
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: "#0c1520",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, FlappyScene],
  });
}
