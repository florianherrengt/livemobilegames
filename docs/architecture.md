# Architecture

Phone Party is a phone-only multiplayer platform. Every participant uses a
browser; there is no shared display or privileged host process. One Node.js
process owns HTTP, matchmaking, WebSockets, active rooms, and authoritative game
simulation.

This document describes the implemented platform foundation and the four
installed games, Capital Pin, Falling Platforms, Flappy Race, and Live Drawing
& Guessing. The catalogue is no longer empty, and the lobby transitions into a
registered game room when the host starts a game.

## System topology

```text
Phone browsers
  ├── GET application assets and routes
  ├── HTTP /api requests
  ├── Colyseus /matchmake requests
  └── WebSocket /colyseus connections
                │
                v
One Node.js process / one application port (`3000`)
  ├── Hono middleware, API, static assets, SPA fallback
  ├── Colyseus matchmaking and WebSocket transport
  ├── immutable production game registry
  ├── in-memory room-code directory
  └── in-memory authoritative rooms and simulations
```

Hono and Colyseus share one `node:http` server. `createPlatformServer` is the
composition root that constructs the transport, directory, service, rooms, Hono
app, and lifecycle controls. In production, Hono also serves the compiled Vite
application. In development, Vite runs separately and proxies every server-owned
path to the same Node process.

There is deliberately no installed database, Redis, message broker, external
matchmaker, microservice, or game worker. SQLite is the selected future durable
store, introduced only with the first concrete durable fact.

### Production routing on helium

The production container still has one application process and one internal
port. The current access paths are deployment infrastructure around that same
port:

```text
Public browser
  -> Cloudflare
  -> helium host port 4478
  -> Docker mapping 4478:3000
  -> Node HTTP + WebSocket server on container port 3000

Coolify HTTPS origin proxy
  -> generated Traefik/Caddy upstream labels for port 3000
  -> the same container port 3000

Container/Coolify health checks
  -> http://127.0.0.1:3000/api/health
```

`COOKIE_SECRET` is a runtime-only Coolify variable. Deployment must not expose
it as a Docker build argument. The operational source of truth is the
[Coolify runbook](../coolify/README.md), whose helpers validate the port mapping,
health check, proxy labels, secret scope, tunnel origin, and public endpoint.

## Workspace boundaries and dependency direction

```text
apps/web ───────────────┐
                       v
              packages/protocol
                       ^
apps/server ────────────┘
```

### `apps/server`

Owns trusted configuration, signed anonymous identity, HTTP middleware and
routes, rate limiting, the game registry, room-code lookup, Colyseus rooms,
authoritative state transitions, logging, and shutdown.

### `apps/web`

Owns MUI routes and presentation, TanStack Query HTTP state and mutations, form
state and client-side validation, one live Colyseus connection, reconnection UI,
Storybook, browser sharing and clipboard behavior, and mobile interaction.

### `packages/protocol`

Owns only contracts that must execute on both sides: Zod request/response/error
schemas, inferred types, room-code constants and normalization, client-message
schemas, and Colyseus synchronized state classes. It is browser-safe and has no
dependency on either application.

Neither application imports the other. Cross-workspace shapes move through the
protocol package rather than mirrored interfaces or server runtime modules.

## Authority and state ownership

| State or decision | Owner | Browser role |
| --- | --- | --- |
| Anonymous player identity | Server-signed cookie | Stores and returns cookie automatically |
| Room code to room ID | Server `RoomDirectory` | Displays and submits room code |
| Installed game catalogue | Immutable server registry | Renders public manifests |
| HTTP catalogue snapshot and mutations | Server facts cached by TanStack Query | Renders request lifecycle and sends validated inputs |
| Room membership and host | Colyseus room state | Renders synchronized state |
| Selected game | Lobby room after host authorization | Sends selection intent and renders result |
| Game actions and outcomes | Authoritative game room/engine | Sends intent and may render prediction |
| Current socket | Web connection provider and Colyseus SDK | Connects, leaves, and reconnects |
| Shareable room location | Browser URL | Navigates to `/room/:code` |

There must be one mutable owner for each live fact. The browser does not copy
synchronized room facts into a second state model. The directory does not copy
lobby state. Derived values are computed from their owner.

Controlled mutation is part of the design where the framework or problem needs
it: Colyseus schema instances, an authoritative simulation loop, and the private
directory map. Elsewhere, readonly values, pure functions, and explicit
dependencies are the default.

## HTTP and WebSocket responsibilities

### Hono

Hono owns:

- `/api/health`;
- `/api/games`;
- room creation and join endpoints;
- request IDs, secure headers, body limits, no-store API caching, anonymous
  sessions, rate limiting, error normalization, and request logging;
- production assets and SPA fallback.

All untrusted HTTP bodies, parameters, cookies, and configuration values are
parsed with Zod before use. Expected errors have a stable protocol code. Unknown
failures are logged and returned as a generic safe error.

### Colyseus

Colyseus owns matchmaking HTTP under `/matchmake`, WebSocket upgrades under the
configured path, seat reservations, room lifecycle, synchronized schema state,
client messages, and reconnection tokens.

The WebSocket transport uses a 16 KiB maximum payload. Room-creation options,
seat options, and message bodies enter rooms as `unknown` and are parsed before
use. The connected `Client` establishes the actor; message data never does.
Lobby creation and seat reservation also require a process-local capability at
the matchmaking authorization boundary. Browsers only consume completed
reservations returned by the Hono API, so public Colyseus matchmaking cannot
forge trusted lobby or player options.

### Routing exclusions

Unknown `/api`, `/assets`, and Colyseus-path requests return a real 404. They
must not fall through to the SPA entry point, because HTML on an API, missing
asset, or socket route hides configuration defects and breaks clients in
misleading ways.

## Game registry

The registry is a trusted immutable list of `GameDefinition` values. A
definition combines:

- a Zod-validated public manifest;
- a unique game ID;
- a unique Colyseus room type;
- a room class constructed by Colyseus.

Construction rejects invalid manifests, duplicate IDs, and duplicate room
types. The platform also rejects collision with its reserved lobby room type.
Manifest data is frozen internally and copied when exposed.

Production games are explicitly imported into
`apps/server/src/games/production-games.ts`. Dynamic discovery, arbitrary module
loading, and an extension runtime are deliberately absent. See
[Adding a game](adding-a-game.md).

## Room lifecycle

The human-facing code is not the Colyseus room ID. `RoomDirectory` holds the
process-local mapping:

```text
room code -> { roomId, gameId: null | gameId }
```

A room is created as a platform lobby before a game is chosen. Code generation
uses an unambiguous alphabet and `crypto.randomInt`, reserves the code before
the asynchronous room create, and rolls it back on failure.

Creation and join both return a server-issued seat reservation. The browser
consumes it with the Colyseus SDK and then observes the room's synchronized
state. Join always targets the exact room ID found by code; it does not ask the
matchmaker for any compatible room.

The first connected player becomes host. Only the current host can select a game
from the trusted registry. If the host leaves, host responsibility moves to a
remaining session. Room disposal removes the code mapping, and a failed join to
a missing room removes a stale mapping.

See the [room lifecycle contract](../apps/server/src/rooms/docs/room-lifecycle.md)
for endpoints, errors, reservations, state, reconnect, and cleanup.

## Identity and trust boundaries

Each visitor receives a server-generated UUID in a signed HTTP-only cookie.
Tampered, malformed, or missing cookies are replaced. HTTP routes derive the
acting player from typed Hono context; room actions derive it from the connected
Colyseus client and state.

One trusted player ID may own at most one live membership in a platform lobby.
The room rejects a duplicate connection before changing synchronized state;
after the old connection leaves, the same browser may join again through the
room URL.

The platform never accepts a client-supplied identity, room ID, room type,
score, collision, death, winner, timestamp, or seed as authoritative. Zod's
default removal of unknown object fields limits accidental input propagation,
but signature verification and connection-derived identity are the actual trust
boundaries.

Current rate limits use both the trusted anonymous player ID and direct socket
address. Cloudflare and Coolify proxy production traffic, but the application
does not define either as a trusted security boundary and therefore ignores
`X-Forwarded-For`. Forwarded headers may influence security behavior only after
the exact proxy chain and trusted-hop configuration are explicitly modeled.

## Browser state and reconnection

The browser keeps shareable room identity in `/room/:code`. TanStack Query owns
HTTP catalogue and mutation lifecycles. A scoped React provider owns at most one
current Colyseus client and room. Components read live lobby data from the
mutable Colyseus schema state; a private React version counter triggers rendering
without becoming another state source. Colyseus state is never copied into the
query cache.

An unexpected leave attempts reconnection with the Colyseus token. A successful
reconnect replaces the room reference and listeners. Intentional leave or
provider unmount does not reconnect. A failed reconnect clears the connection.

A full page refresh currently loses the in-memory connection and reservation.
In a lobby the direct room URL still lets the person submit a name and reserve
a new seat while the room exists. Inside a running game the room is locked, so
a refresh cannot rejoin mid-game; reconnection within the grace window uses
the Colyseus token. Transparent refresh recovery is not implemented.

## Process lifecycle and failure semantics

Live rooms, code mappings, players, timers, and reconnection state exist only in
memory. A server restart or Coolify deployment terminates them. This is accepted
behavior because the current product has no durable-data requirement.

`SIGINT` and `SIGTERM` start shutdown once. New room creation is rejected after
shutdown begins; Colyseus then shuts down, the transport stops, and the HTTP
server closes. Feature resources added later need explicit ownership and cleanup
for normal completion, leave, room disposal, failed partial setup, and shutdown.

## Testing architecture

- Protocol tests exercise shared validation and normalization.
- Server unit tests exercise isolated state owners and identity middleware.
- Hono application tests call `app.request` with a stubbed room service to cover
  middleware, boundary parsing, and safe errors without sockets.
- Room integration tests boot the real composition with `@colyseus/testing` and
  exercise TCP, HTTP, matchmaking, reservations, WebSockets, synchronized state,
  messages, and cleanup.
- React Testing Library covers browser-visible component behavior at mocked
  network boundaries with an isolated Query client.
- Storybook renders deterministic MUI loading, empty, error, populated,
  long-content, form, invite, and player-list states through the same application
  theme and providers. CI verifies its static build.
- Playwright builds and starts the production server, then exercises full flows
  through mobile Chromium, including distinct contexts for distinct players.

Integration and E2E tests need local listening sockets. A restricted sandbox may
reject them with `EPERM`; CI remains responsible for running the real topology.

## Scaling and persistence boundaries

### Future SQLite persistence

SQLite is the selected store once durable facts exist, such as registered
accounts, entitlements, purchases, moderation records, or completed match
history. It will store those facts, not every frame of live game simulation.
The driver, optional schema/query library, schema, and migration chain are chosen
with the actual first durable feature rather than installed speculatively. See
[future SQLite persistence](../apps/server/docs/persistence.md).

### When Redis or multiple processes are justified

External presence or coordination becomes justified only when load testing or a
real deployment requirement proves one process cannot serve the active player
population. That change also requires a concrete strategy for matchmaking,
room-code ownership, sticky WebSockets, deployment draining, failure recovery,
and observability; adding Redis alone does not make the system distributed.

### Why neither exists now

There is no durable-data requirement and no demonstrated scale problem. An empty
SQLite subsystem or distributed infrastructure would add failure modes,
operating cost, and consistency work without improving current behavior.

## Implemented game lifecycles

The four installed games own their own transitions and lifecycles:

```text
platform lobby -> Capital Pin: round -> round-results -> finished -> lobby
platform lobby -> Falling Platforms: countdown -> playing -> results -> lobby
platform lobby -> Flappy Race: countdown -> running -> round-result -> finished -> lobby
platform lobby -> Live Drawing & Guessing: preparing -> drawing -> result -> round-summary -> finished
```

The host selects a game in the platform lobby; `start_game` creates the
registered game room, reserves one seat per connected player, repoints the room
code, and hands each client a `room:transition` reservation over the socket.
When the last roster player arrives, the game room starts round 1
automatically — the platform lobby's Start button is the only manual start.
Game-room creation requires a server-issued capability token, so the public
Colyseus matchmaking endpoint cannot forge a roster or test-mode timing.
The platform continues to own identity, room codes, membership, reservations,
reconnection, and cleanup.

Capital Pin owns its manifest, command schema, synchronized state, ten-round
scoring, map renderer, and tests; Falling Platforms owns its manifest, hop
command, synchronized arena state, seeded collapse simulation, swipe renderer,
and tests; Flappy Race owns its manifest, flap command, synchronized course
state, seeded course generation, physics/collision engine, canvas renderer, and
tests; Live Drawing & Guessing owns its manifest, stroke and guess commands,
synchronized drawing and turn state, private drawer briefings, word and reveal
rules, canvas renderer, and tests. Unlike the other games, its room unlocks
while play runs so players who join by code can spectate and participate in the
next game; seat reservations still require the process-local token through
`onAuth`. `play_again` is the host-only convention the games use to return to a
lobby and start the next game automatically when everyone is connected. The
transitions and lifecycles stay feature-local: no generic base room, transition
state machine, or lifecycle machinery has been extracted for additional games.

See [Adding a game](adding-a-game.md) for the boundaries additional games must
satisfy, and the [room lifecycle
contract](../apps/server/src/rooms/docs/room-lifecycle.md) for the transition
details.
