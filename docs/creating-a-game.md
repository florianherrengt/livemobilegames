# Creating a new game

This guide walks through adding a new game end to end. The only files outside
your game package that change are the server registration and (optionally) the
client app.

## 1. Define commands

Commands are typed unions validated with Zod:

```ts
// packages/my-game/src/commands.ts
import { z } from "zod";

export const myGameCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("jump"), direction: z.enum(["left", "right"]) }).strict(),
]);

export type MyGameCommand = z.infer<typeof myGameCommandSchema>;
```

## 2. Define the synchronized state

Extend the platform schema classes. Games declare their own `players` map
typed with their player class:

```ts
// packages/my-game/src/state.ts
import { MapSchema, type } from "@colyseus/schema";
import {
  PlatformPlayerState,
  PlatformState,
} from "@falling-platforms/platform-schema";

export class MyPlayerState extends PlatformPlayerState {
  @type("number") score = 0;
}

export class MyGameState extends PlatformState {
  @type("string") phase: "lobby" | "playing" | "finished" = "lobby";
  @type({ map: MyPlayerState }) players = new MapSchema<MyPlayerState>();
}
```

State classes are isomorphic: they live in the game package root (or a shared
subpath) and never import `platform-server`.

## 3. Implement the GameDefinition

```ts
// packages/my-game/src/server.ts
import { type CommandResult, type GameContext, type GameDefinition } from "@falling-platforms/platform-server";
import { protocolError } from "@falling-platforms/platform-shared";
import { myGameCommandSchema, type MyGameCommand } from "./commands.js";
import { MyGameState, MyPlayerState } from "./state.js";

export function createMyGame(options: { reconnectGraceMs: number }): GameDefinition<
  MyGameState,
  MyPlayerState,
  MyGameCommand
> {
  return {
    id: "my_game",
    config: {
      minPlayers: 2,
      maxPlayers: 8,
      reconnectGraceMs: options.reconnectGraceMs,
      allowJoinAfterStart: false,
      removeDisconnectedPlayers: true,
      requiresReady: true,
    },
    commandSchema: myGameCommandSchema,
    createState: () => new MyGameState(),
    createPlayerState: () => new MyPlayerState(),
    onStart: (context, state) => {
      state.phase = "playing";
      context.scheduleIn("my-game-end", 10_000, () => {
        if (state.phase === "playing") {
          state.phase = "finished";
          context.finishMatch(buildResult(state, context.now()));
        }
      });
    },
    onCommand: (context, state, sessionId, command): CommandResult => {
      if (command.type !== "jump") {
        return { ok: false, error: protocolError("INVALID_GAME_COMMAND", "Unknown command") };
      }
      if (state.phase !== "playing") {
        return { ok: false, error: protocolError("GAME_NOT_RUNNING", "Not playing") };
      }
      const player = state.players.get(sessionId);
      if (!player) {
        return { ok: false, error: protocolError("PLAYER_NOT_IN_ROOM", "Not in room") };
      }
      player.score += command.direction === "left" ? 1 : 2;
      return { ok: true };
    },
    onReset: (_context, state) => {
      state.phase = "lobby";
      for (const player of state.players.values()) {
        player.score = 0;
      }
    },
  };
}
```

`onCommand` and `onTick` must be synchronous. Lifecycle hooks (`onJoin`,
`onDrop`, `onReconnect`, `onRemoved`, `onStart`, `onReset`, `onDispose`) are
optional.

## 4. Register the game

In `apps/server/src/app.config.ts`:

```ts
import { createMyGame } from "@falling-platforms/my-game/server";
import { MyGameState, MyPlayerState, type MyGameCommand } from "@falling-platforms/my-game";

class MyGameRoom extends PlatformRoom<MyGameState, MyPlayerState, MyGameCommand> {
  constructor() {
    super(createMyGame({ reconnectGraceMs: serverConfig.reconnectGraceMs }), platformRoomOptions);
  }
}

// in defineServer({ rooms: { ..., my_game: defineRoom(MyGameRoom) } })
```

No room, socket, session, reconnection or lobby code is required. The room code
is claimed automatically, the lobby works immediately, and reconnection works
through the platform.

## 5. Send commands from the client

```ts
import { MultiplayerClient } from "@falling-platforms/client-sdk";
import type { MyGameCommand, MyGameClientState } from "@falling-platforms/my-game";

const client = new MultiplayerClient<MyGameClientState, MyGameCommand>({
  serverUrl,
  storageKey: "my-game:connection",
});

await client.createRoom({ gameId: "my_game", name: "Florian" });
await client.setReady(true);
await client.startGame();
client.sendGameCommand({ type: "jump", direction: "left" }); // fire-and-forget
```

`getLobbySnapshot()` provides the shared lobby state model; render it with your
own UI. `getEstimatedServerTime()` returns the smoothed server clock for
countdowns based on absolute `startsAt`/`endsAt` timestamps.

## 6. Test it

See [testing-a-game.md](testing-a-game.md).
