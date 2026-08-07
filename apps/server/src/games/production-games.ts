import { createCapitalPinGameDefinition } from "./capital-pin/definition.js";
import { createCoinRushGameDefinition } from "./coin-rush/definition.js";
import { createFallingPlatformsGameDefinition } from "./falling-platforms/definition.js";
import { createFlappyRaceGameDefinition } from "./flappy-race/definition.js";
import type { GameDefinition } from "./game-definition.js";
import { createGolfRaceGameDefinition } from "./golf-race/definition.js";
import { createKartRacingGameDefinition } from "./kart-racing/definition.js";
import { createLiveDrawingGuessingGameDefinition } from "./live-drawing-guessing/definition.js";
import { createMemoryPathGameDefinition } from "./memory-path/definition.js";
import { createPongGameDefinition } from "./pong/definition.js";

export function createProductionGames(roomCreationToken: string): readonly GameDefinition[] {
  return [
    createCapitalPinGameDefinition(roomCreationToken),
    createCoinRushGameDefinition(roomCreationToken),
    createFallingPlatformsGameDefinition(roomCreationToken),
    createFlappyRaceGameDefinition(roomCreationToken),
    createGolfRaceGameDefinition(roomCreationToken),
    createKartRacingGameDefinition(roomCreationToken),
    createLiveDrawingGuessingGameDefinition(roomCreationToken),
    createMemoryPathGameDefinition(roomCreationToken),
    createPongGameDefinition(roomCreationToken),
  ];
}
