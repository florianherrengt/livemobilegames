# Server runtime

High-signal facts about how the server builds, starts, routes traffic, and shuts
down. Read this before changing startup, configuration, imports, HTTP ownership,
or deployment behavior.

## Build and module model

- Development runs TypeScript with `tsx watch src/index.ts`.
- Production compiles `src` to `dist` with TypeScript and runs
  `node dist/index.js`.
- The package uses ESM and `NodeNext` resolution. Source imports use `.js`
  specifiers, even when they refer to `.ts` files; TypeScript preserves those
  specifiers for the compiled JavaScript. Do not convert them to `.ts` or
  extensionless imports.
- `@phone-party/protocol` is a compiled workspace dependency. Root development,
  typecheck, and test commands build it before consuming it.
- Node.js 22 or newer is required. The configuration loader uses
  `process.loadEnvFile`.

## Configuration

`src/config.ts` loads the repository-root `.env` when it exists, then validates
the selected environment variables with Zod. Tests normally call `loadConfig`
with an explicit object, so they do not depend on a developer's `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Cookie security and runtime mode |
| `PORT` | `3000` | Shared HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `COOKIE_SECRET` | none | Required signing secret, at least 32 characters |
| `PUBLIC_ORIGIN` | `http://localhost:5173` | Validated public browser origin; reserved but not otherwise consumed yet |
| `COLYSEUS_PATH` | `/colyseus` | WebSocket path prefix; must begin with `/` |
| `LOBBY_MAX_CLIENTS` | `8` | Lobby capacity, from 1 through 32 |
| `E2E_TEST_MODE` | `false` | Shortens game round/results timings for test suites |
| `CAPITAL_PIN_TRANSITION_TIMEOUT_MS` | `15000` | Deadline for all roster players to arrive in a registered game room |
| `LOG_LEVEL` | `info` | Pino log level |

Add server environment values to the schema, `loadConfig` mapping,
`.env.example`, Docker configuration when relevant, tests, and documentation in
one change. Do not read `process.env` throughout feature modules.

Each git worktree loads its own root `.env`. `PUBLIC_ORIGIN` must match that
worktree's `WEB_PORT`; `pnpm worktree:create` sets both, and the Vite dev proxy
follows the same `PORT`.

`src/config.ts` is the only runtime access layer for environment values. The
only exceptions are build and test tooling (`vite.config.ts` and
`playwright.config.ts`), which read ports before the application config module
can load. Process-local secrets that are not environment values, such as the
room-creation capability token, are generated at startup with `node:crypto`
and injected through the composition root; they never live in module-level
mutable state.

## One public server

One Node.js HTTP server owns all public traffic:

- Colyseus handles matchmaking requests under `/matchmake`.
- `WebSocketTransport` handles upgrades under the configured Colyseus path.
- Hono handles `/api`, production static assets, and the single-page application
  fallback.
- Hono and Colyseus share the same port. Do not start a second HTTP server or
  add CORS as a workaround for local routing.

`createPlatformServer` is the composition root. It owns the HTTP server,
WebSocket transport, Colyseus server, room directory, room service, Hono app,
and shutdown state. Tests use the same composition function.

## Route ownership and fallback

Hono API routes live under `/api`. Missing `/api`, `/assets`, or Colyseus-path
requests return an explicit JSON 404 and must never receive the SPA HTML.

When `apps/web/dist` exists, hashed assets are served with long-lived immutable
caching and the SPA entry point with `no-cache`. In development, Vite serves the
web app and proxies `/api`, `/matchmake`, and `/colyseus` to this server.

## In-memory state and restart behavior

Colyseus local presence, active rooms, synchronized room state, and the
room-code directory live only in this process. A restart ends all rooms and
invalidates every code and reconnection token. This is current product behavior,
not an incomplete persistence implementation.

SQLite is the selected future store, but it is introduced only with the first
concrete durable fact. Do not add an empty schema or unused driver. Redis, an
external matchmaker, and queues still require measured scaling need. Live
simulation state remains in memory even after durable accounts or match history
exist. See [persistence.md](persistence.md).

## Shutdown

`src/index.ts` handles `SIGINT` and `SIGTERM` once. Shutdown marks the room
service unavailable for new room creation, asks Colyseus to shut down, stops the
transport, and closes the HTTP server. New resources added to the composition
root need an explicit shutdown path and tests where failure would leak handles.
