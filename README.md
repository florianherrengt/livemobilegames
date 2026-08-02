# Multiplayer Games Platform

A reusable, server-authoritative multiplayer platform for browser mini-games,
built on Colyseus 0.17. One server hosts every game behind a single shared
communication layer — room codes, lobbies, host and ready state, reconnection,
typed commands and errors, server-controlled timers, match results and
leaderboards. Adding a game means writing its rules and its client; the room
and networking code is written once and reused by all of them.

Four games ship in this repository:

- **Falling Platforms** (Phaser client): swipe-to-hop survival on a shrinking
  grid of platforms. The original product, now running on the platform.
- **Tap Race** (vanilla TypeScript client): the second consumer, proving that a
  new game registers without touching platform internals.
- **Capital Pin** (React + MapLibre client): drop a pin where you think each
  capital city is; the closest guess wins the round.
- **Flappy Race** (Phaser client): tap to flap through shared obstacle
  courses; the furthest bird wins each of five rounds.

Opening the server in a browser shows a **game selector** (the hub). Each game
runs in its own independent client app, but every client talks to the server
through the same shared layer.

## Architecture overview

```text
apps/server             Colyseus server: registers all games, serves the hub
                        landing page and every game client from one origin
apps/hub-client         Landing page (root): lists the games and links into them
apps/client             Falling Platforms Phaser client
apps/tap-race-client    Tap Race vanilla TypeScript client
apps/capital-pin-client Capital Pin React + MapLibre client
apps/flappy-race-client Flappy Race Phaser client
packages/platform-shared    Protocol types, Zod schemas, errors, results
packages/platform-schema    Synchronized Colyseus Schema classes (isomorphic)
packages/platform-server     GameDefinition contract, PlatformRoom, Presence room
                            codes, serial queue, host/ready rules, logging
packages/client-sdk          Framework-independent client (connection, commands,
                            reconnection records, clock estimation) — the single
                            shared layer every game client reuses
packages/platform-test       Test kit: test server, fake clients, time advancement
packages/shared              Falling Platforms types, schemas, grid math
packages/tap-race            Tap Race command/state schemas + server module
packages/capital-pin         Capital Pin command/state schemas, server module,
                            capitals dataset + pure game logic
packages/flappy-race        Flappy Race command/state schemas, server module,
                            deterministic course generation, pure round rules
```

The server owns everything that matters: room codes, player presence, host and
ready state, start and play-again permissions, reconnection, command
validation, match results and timers. Games implement
`GameDefinition` (state schema, command schema, lifecycle hooks, tick and
scoring) and never touch sockets or room internals. On the client, every game
reuses `MultiplayerClient` (`packages/client-sdk`) for room creation, joining
and command sending — the part that is identical for every game.

See [docs/architecture.md](docs/architecture.md) for the full design,
[docs/protocol.md](docs/protocol.md) for the wire protocol,
[docs/creating-a-game.md](docs/creating-a-game.md) for adding a new game, and
[docs/testing-a-game.md](docs/testing-a-game.md) for the test kit.

## Requirements

- Node.js 20.19+ (Node 22 LTS or newer recommended)
- pnpm 9+ (10.x used in this repo)

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Builds the shared/platform packages, then starts:

- The multiplayer server at `http://0.0.0.0:2567`
- The hub landing page at `http://0.0.0.0:5176/` (the game selector)
- Falling Platforms at `http://0.0.0.0:5173`
- Tap Race at `http://localhost:5174/tap-race/`
- Capital Pin at `http://localhost:5175/capital-pin/`
- Flappy Race at `http://localhost:5177/flappy-race/`

The clients derive the server URL from the page origin (dev: `ws://<host>:2567`;
production: same origin). Override with `VITE_GAME_SERVER_URL`.

In production (`pnpm build && pnpm start`) the single server serves everything
from one origin:

- `/`           — the hub (game selector)
- `/falling-platforms/` — Falling Platforms
- `/tap-race/`  — Tap Race
- `/capital-pin/` — Capital Pin
- `/flappy-race/` — Flappy Race
- `/games`      — JSON list of registered games (used by the hub)

### Playing locally

1. Open the hub (dev: `http://localhost:5176/`, prod: the server URL) and pick a
   game, or open a game client directly.
2. Enter a display name and create a room.
3. Join from a second browser (or a normal + private window) with the
   5-character room code.
4. Falling Platforms: the host starts immediately. Tap Race: everyone marks
   ready, then the host starts.

## Deploying with Docker

The repository ships a multi-stage `Dockerfile` that installs dependencies,
builds every package and client, strips dev dependencies and runs the server
as a non-root user. The final image is a single container serving the hub, all
three game clients and the WebSocket/API server from one origin.

```bash
docker build -t livemobilegames .

docker run --rm -p 2567:2567 \
  -e CLIENT_ORIGINS=https://games.example.com \
  livemobilegames
```

Notes:

- The container listens on `PORT` (default `2567`) and exposes that port. A
  healthcheck hits `/health` every 30 seconds.
- Set `CLIENT_ORIGINS` to the public origin(s) your players connect from
  (comma-separated). Browsers send an `Origin` header even for same-origin
  WebSockets, so leave it empty only if you want to accept any origin.
- All other environment variables in `.env.example` (`LOG_LEVEL`,
  `ROOM_CODE_LENGTH`, `MAX_ROOM_LIFETIME_MS`, etc.) apply unchanged.
- Rooms and Presence are in-memory: a container restart loses active rooms.
  Run a single replica, or accept that limitation before scaling horizontally.

## Commands

```bash
pnpm dev              # server + hub + all four game clients
pnpm dev:falling-platforms  # server + hub + Falling Platforms only
pnpm dev:tap-race           # server + hub + Tap Race only
pnpm dev:capital-pin        # server + hub + Capital Pin only
pnpm dev:flappy-race        # server + hub + Flappy Race only
pnpm build            # production build of every package and app
pnpm start            # run the built server (serves the hub and all built clients)
pnpm test             # all unit + integration tests
pnpm test:unit        # platform package unit tests
pnpm test:integration # server integration tests
pnpm test:e2e         # Playwright end-to-end for all four games
pnpm typecheck        # strict TypeScript across the workspace
pnpm lint             # Biome check
pnpm format           # Biome format
```

## Sessions, rooms and reconnection

- **Sessions.** There are no accounts. Joining a room with a display name
  creates a Colyseus session; `sessionId` is the stable room-membership
  identity and survives socket reconnection. It is scoped to one room
  membership — a separate cross-room `playerId` is a documented future
  extension.
- **Rooms.** Creating a room claims a unique 5-character code (configurable)
  through the Colyseus Presence API. The creator is the host. Codes are
  case-insensitive, use an unambiguous alphabet, and are released on room
  disposal.
- **Reconnection.** On an unexpected disconnect the player is marked
  `reconnecting` and kept in the room for the game's grace period. The client
  persists `{ serverUrl, roomId, roomName, reconnectToken, updatedAt }` and
  auto-reconnects with the token; the token is rotated and re-persisted after
  every successful reconnection. Colyseus sends a full state snapshot on
  reconnect, so a reconnecting client exactly catches up. After the grace
  period the player is permanently removed; the host transfers to the earliest
  joined connected player.
- **Commands, events and snapshots.** Persistent state is synchronized Colyseus
  Schema. Commands are typed messages validated with Zod; lobby commands
  require a request ID and receive a `platform:command-result`. See
  [docs/protocol.md](docs/protocol.md).

## Creating a new game

Because the room, socket, session, reconnection and lobby code all live in the
shared layer, a new game is just its rules plus a client that uses
`MultiplayerClient` to talk to the server.

1. Create a package with your command types/Zod schema and synchronized state
   schema (extending `PlatformState`/`PlatformPlayerState` from
   `platform-schema`).
2. Implement `GameDefinition` from `platform-server`: config, state/player
   factories, lifecycle hooks, `onCommand`, optional `onTick`.
3. Register it in `apps/server/src/app.config.ts` with `defineRoom`.
4. Build a client app that uses `MultiplayerClient`
   (`@falling-platforms/client-sdk`) for create/join/ready/start/command — the
   shared layer — and render the synced state however you like.

The new game automatically appears in the hub's game selector (the hub reads
`/games`) and is served at the path you wire in `app.config.ts`. No room,
socket, session, reconnection or lobby code is needed. The complete walkthrough
is in [docs/creating-a-game.md](docs/creating-a-game.md). Capital Pin
(`packages/capital-pin` + `apps/capital-pin-client`) is a full reference for a
game with secret per-round state (the answer is hidden until a round ends).

## Environment variables

See `.env.example`. Notable options:

```text
PORT=2567                    server port
HOST=0.0.0.0                 bind host
ROOM_CODE_LENGTH=5           room code length
RECONNECT_GRACE_MS=10000     default reconnection grace period
MAX_MESSAGES_PER_SECOND=60   per-socket message rate limit
MAX_ROOM_LIFETIME_MS=1800000 room lifetime cap
FINISHED_ROOM_TIMEOUT_MS=600000  finished-room disposal timeout
ROOM_CODE_CLAIM_TTL_MS=      presence claim TTL override
MAX_SOCKET_PAYLOAD_BYTES=65536  websocket payload cap
CLIENT_ORIGINS=...           comma-separated allowed origins (empty = allow all)
LOG_LEVEL=info               pino log level
QUEUE_WARN_DEPTH=20          serial queue depth warning
QUEUE_WARN_DURATION_MS=100   serial queue duration warning
ALLOW_SOLO=false             Falling Platforms: allow 1-player matches
E2E_TEST_MODE=false          fast deterministic timings for tests
```

Invalid configuration fails fast at startup with a clear error.

## Known v1 limitations

- Single Node.js process; rooms and Presence are in-memory. A server restart
  loses active rooms.
- Room codes are allocated through Colyseus Presence (in-memory in v1, Redis
  Presence compatible) and are not horizontally partitioned.
- Identity is room-scoped: there is no cross-room anonymous `playerId`.
- No accounts, matchmaking, persistent histories or databases.
- No shared UI package: the SDK shares the controller/state model; each client
  renders its own lobby UI.
- In Falling Platforms, a permanent mid-match leave removes the player row
  immediately (previously it lingered as an eliminated ghost), and the player
  cap is a finite 100.
