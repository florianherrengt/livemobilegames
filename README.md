# Phone Party Platform

Phone Party is a foundation for a phone-only multiplayer party-game platform. Every player uses their own phone browser; there is no shared television or host screen. The server is authoritative: it owns rooms, game state, timing, scoring, collisions, eliminations, and results. Clients send intentions and render locally.

This repository contains the platform foundation and four installed games:
**Capital Pin** (drop a pin where you think each capital city is; closest guess
wins the round) and **Falling Platforms** (hop across platforms as the arena
collapses under you; last survivor wins), plus **Flappy Race** (tap to flap
through a shared obstacle course; the furthest bird wins each round) and
**Live Drawing & Guessing** (one player draws a secret word while everyone else
guesses it live). The
production game catalogue is a small, trusted, explicitly imported list — no
test games or dynamic discovery ever appear there.

The room flow is: create a room first, share the room code, let other players
join, let the host choose a game from the installed catalogue, and then start
the game. Starting moves every connected player from the platform lobby into
the selected game's room; the same room code continues to address the game.
Round 1 begins automatically when everyone has arrived — one Start click is
enough.

Every game opens with a short how-to during the initial countdown (or the
opening seconds of a game without one) that disappears automatically. Audio and
haptics add subtle feedback for actions and outcomes without being the only
signal.

Inside a room the host can share an invite link (or QR code), copy the room code, and every player can see the live player list with host and “you” markers. Opening a room link on another phone lets that player join directly.

Capital Pin plays 10 rounds. Each round names a capital city and every phone
drops a pin on a world map; the closest guess wins the round. The server keeps
the answer secret until the round ends, owns all timing and scoring, and
finishes with a leaderboard and a host-only play-again option.

Falling Platforms drops every player onto a shared grid of platforms. A zoomed
camera follows your player (or a survivor you tap while spectating), so the
platforms stay large enough to read on a phone. Swipe to hop to an adjacent
tile while the server warns and removes platforms on a seeded difficulty
schedule. One survivor wins; the room returns to its lobby and the host can
play again with a fresh seed.

Flappy Race gives every player a bird on the same server-generated course.
Tap to flap, dodge shared obstacles, and let the furthest bird win each of five
rounds. The server owns the course, physics, collisions, round winners, final
scoreboard, and rematch.

Live Drawing & Guessing runs three rounds in which every player draws three
secret words. The drawer sees the word privately and draws live; guessers see
the category, a progressive letter pattern, and the drawing, and the first
exact correct guess scores a point for both players. The room unlocks during
play so late joiners can spectate and join the next game, while the server
keeps guesses private and owns words, reveals, timing, scoring, and winners.

Capital Pin, Falling Platforms, and Flappy Race stay locked while running: a
browser refresh mid-game cannot rejoin them; reconnection within the grace
window uses the Colyseus token. Live Drawing & Guessing deliberately unlocks so
late joiners can spectate.

## Architecture

One Node.js process runs everything:

```text
Phones
  |
  ├── HTTP requests (Hono under /api)
  └── Colyseus WebSocket connections
          |
          v
Single Node.js process
  ├── Hono HTTP application
  ├── Colyseus server (WebSocket transport)
  ├── In-memory game registry
  ├── In-memory room directory
  ├── In-memory active rooms
  └── In-memory authoritative game simulations
```

Hono and Colyseus share one Node.js HTTP server and one application port. In
production, Cloudflare's host-port route and Coolify's HTTPS proxy both forward
to container port `3000`. Colyseus uses its local presence and local driver.

There is deliberately no database in this version. SQLite is the selected store for the first real durable-data requirement, but no driver, schema, migration, or empty database is added before there is a durable fact to model. Live rooms and room codes will remain in memory. A server restart currently ends active rooms; that is an accepted trade-off for this stage.

## Prerequisites

- Node.js 22 or newer
- pnpm 9 or newer

## Setup

```bash
pnpm install
cp .env.example .env
```

`COOKIE_SECRET` is required and must be at least 32 characters. Never commit a real secret.

The server, Vite, the Storybook dev launcher, and Playwright all read the same
repository-root `.env`; Vite also reads `VITE_*` values from it. A value already
exported in the shell always wins.

## Development

```bash
pnpm dev
```

This starts:

- Web application: http://localhost:5173
- HTTP API and Colyseus: http://localhost:3000

Vite proxies `/api`, `/matchmake`, and `/colyseus` to the Node server, so no CORS configuration is needed.

Every listener reads its port from `.env` or the shell:

| Variable | Default | Listener |
| --- | --- | --- |
| `PORT` | `3000` | Shared HTTP API and Colyseus server |
| `WEB_PORT` | `5173` | Vite dev server |
| `STORYBOOK_PORT` | `6006` | Storybook dev server |
| `PREVIEW_PORT` | `4173` | `vite preview` |
| `E2E_PORT` | `3210` | Playwright production server |

The Vite dev proxy automatically follows `PORT`. Vite and Storybook fail
instead of silently moving to another port when the configured one is taken,
so a misconfigured worktree cannot quietly take over another worktree's port.

## Multiple worktrees

Worktrees live in `.worktrees/` and each one gets its own non-conflicting port
set in a gitignored `.env`. Create and start one with:

```bash
pnpm worktree:create <name>
cd .worktrees/<name>
pnpm dev
```

See [docs/worktrees.md](docs/worktrees.md) for the full workflow: options,
port allocation, Storybook/preview/E2E, and troubleshooting.

## Commands

```bash
pnpm format          # format all files
pnpm format:check    # verify formatting
pnpm lint            # Biome lint
pnpm typecheck       # TypeScript strict checks
pnpm test            # all unit and integration tests
pnpm test:unit       # unit tests only
pnpm test:integration # server integration tests
pnpm test:e2e        # build, then run Playwright against the production server
pnpm build           # build protocol, server, and web application
pnpm storybook       # isolated MUI component states on STORYBOOK_PORT (6006)
pnpm storybook:build # verify the static Storybook build
pnpm check           # formatting + lint + types + tests + build
```

Integration and end-to-end tests start real TCP/WebSocket servers. In sandboxes that block listening sockets, those suites cannot run locally; CI runs them against the real built application.

## Production

```bash
pnpm build
pnpm start
```

The compiled Node server serves the built web assets, the `/api` routes, and the Colyseus WebSocket endpoint from one process.

## Docker

```bash
docker build -t phone-party-platform .
docker run -p 3000:3000 \
  -e COOKIE_SECRET="replace-with-at-least-32-random-characters" \
  phone-party-platform
```

The container health check calls `/api/health`.

### Coolify

Use the repository `Dockerfile` build pack with `/` as the base directory. Route
traffic to container port `3000` and configure `/api/health` as the health-check
path. The application serves HTTP and WebSockets on the same internal port, so
no second service or socket port is needed.

Coolify's reverse proxy provides direct HTTPS origin access. On the current
helium deployment, the public Cloudflare route instead reaches the application
through host port `4478`. Keep the Coolify host-port mapping set to `4478:3000`;
the container side must remain `3000`. This mapping is an additional route to
the same Node process, not a second application or WebSocket service. The
detailed configuration and recovery procedure live in
[`coolify/README.md`](coolify/README.md).

Set `COOKIE_SECRET` to a random value of at least 32 characters. The image
already defaults `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`,
`COLYSEUS_PATH=/colyseus`, and `LOG_LEVEL=info`. If `PORT` is overridden, the
Coolify target port must match it; the container health check follows the
runtime `PORT` value.

Run exactly one replica and do not attach a persistent volume. Active rooms,
room codes, and reconnection tokens are process-local and intentionally end on
restart or redeployment. Horizontal scaling requires a separate design for
matchmaking ownership and sticky WebSockets.

## Repository structure

```text
apps/server/          Hono API, Colyseus server, room infrastructure, game rooms
apps/web/             React phone UI, Capital Pin map, Falling Platforms arena, Flappy Race canvas, Live Drawing canvas
packages/protocol/    Shared Zod schemas, Colyseus state, and inferred types
docs/                 Architecture and game-authoring guides
```

The web application uses MUI as its component and styling system, TanStack Query for HTTP server state and mutation lifecycles, and React Hook Form with `@hookform/resolvers/zod` for forms. Live synchronized room state remains owned by Colyseus rather than the query cache.

Unknown fields in API request bodies are stripped by Zod's default object behaviour; clients cannot inject identity or room fields through extra JSON properties.

## Documentation

- [Architecture](docs/architecture.md) explains process topology, dependency direction,
  authority, state ownership, and the boundaries for future persistence or scaling.
- [Room lifecycle](apps/server/src/rooms/docs/room-lifecycle.md) defines the current HTTP,
  reservation, lobby, reconnection, host-transfer, error, and cleanup behavior.
- [Adding a game](docs/adding-a-game.md) defines what every additional production game must own and
  how it joins the trusted platform registry.
- [Multiple worktrees](docs/worktrees.md) explains how to create and run
  worktrees with per-worktree ports.
- [Server runtime](apps/server/docs/runtime.md), [server standards](apps/server/docs/standards.md),
  [future SQLite persistence](apps/server/docs/persistence.md),
  [web standards](apps/web/docs/standards.md), and
  [protocol standards](packages/protocol/docs/standards.md) contain scoped engineering rules.
- [Coolify operations](coolify/README.md) records the production identifiers,
  required configuration, deployment and verification commands, and incident recovery procedure.
- [`AGENTS.md`](AGENTS.md) is the concise repository map and documentation index.

## Current limitations

- Active rooms are lost on server restart.
- One process limits horizontal scaling until a real product requirement proves otherwise.
- Durable accounts, purchases, and match history do not exist.
