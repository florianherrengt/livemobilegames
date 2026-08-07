import { createCapitalPinGameDefinition } from "./capital-pin/definition.js";
import { createFallingPlatformsGameDefinition } from "./falling-platforms/definition.js";
import { createFlappyRaceGameDefinition } from "./flappy-race/definition.js";
import type { GameDefinition } from "./game-definition.js";
import { createMemoryPathGameDefinition } from "./memory-path/definition.js";

export function createProductionGames(roomCreationToken: string): readonly GameDefinition[] {
  return [
    createCapitalPinGameDefinition(roomCreationToken),
    createFallingPlatformsGameDefinition(roomCreationToken),
    createFlappyRaceGameDefinition(roomCreationToken),
    createMemoryPathGameDefinition(roomCreationToken),
  ];
}
