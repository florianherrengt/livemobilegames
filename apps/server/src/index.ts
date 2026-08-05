import { randomBytes } from "node:crypto";

import { loadConfig } from "./config.js";
import { createGameRegistry } from "./games/game-registry.js";
import { createProductionGames } from "./games/production-games.js";
import { createLogger } from "./logging.js";
import { createPlatformServer } from "./server/create-server.js";

export const config = loadConfig();
const logger = createLogger(config.logLevel);
// Process-local capability shared between the lobby and the game room classes;
// it proves a game room was created by the platform, not by matchmaking.
const roomCreationToken = randomBytes(32).toString("hex");
const registry = createGameRegistry(createProductionGames(roomCreationToken));

const platform = await createPlatformServer({
  config,
  games: registry,
  logger,
  roomCreationToken,
});

await platform.start();
logger.info(
  {
    host: config.host,
    port: config.port,
    colyseusPath: config.colyseusPath,
  },
  "server started",
);

let stopping = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info({ signal }, "shutting down");
  try {
    await platform.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error, signal }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
