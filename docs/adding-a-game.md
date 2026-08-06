# Adding a game

The production catalogue contains three games, Capital Pin, Falling Platforms,
and Flappy Race. This guide defines the boundaries every additional game must
satisfy; it does not imply that generic lifecycle transitions or client
rendering infrastructure exist beyond the narrow, feature-local transitions
the three installed games established.

Read these first:

- [Architecture](architecture.md)
- [Server standards](../apps/server/docs/standards.md)
- [Web standards](../apps/web/docs/standards.md)
- [Protocol standards](../packages/protocol/docs/standards.md)
- [Room lifecycle](../apps/server/src/rooms/docs/room-lifecycle.md)

## What the platform and game each own

The platform owns anonymous identity, room codes, reservations, membership,
reconnection, the trusted catalogue, the lobby, and resource cleanup.

Each game owns:

- a stable public manifest;
- client-to-server action schemas;
- synchronized public state;
- server-only hidden state and random seed where required;
- authoritative rules, timing, scoring, elimination, and results;
- its Colyseus room behavior;
- its phone renderer and controls;
- unit, room-integration, component, and playable browser coverage.

Clients send intentions. They never submit an accepted position, collision,
score, death, timer result, seed, or winner. The room derives the actor from the
connected Colyseus client.

## Suggested first-game layout

Use feature-local modules in the existing workspaces instead of creating a new
workspace or plugin system:

```text
packages/protocol/src/
└── <game-id>.ts                 shared actions and synchronized state

apps/server/src/games/<game-id>/
├── definition.ts               manifest plus room registration
├── room.ts                     Colyseus boundary and lifecycle
└── engine.ts                   authoritative rules when separation is useful

apps/server/tests/games/<game-id>/
├── engine.test.ts
└── room.test.ts

apps/web/src/games/<game-id>/
├── game-view.tsx
└── *.test.tsx
```

This shape is a default for the first implementations, not a generic extension
contract. Omit `engine.ts` when the rules are clearer directly in a small room.
Add files only when they have a concrete responsibility. Do not add a base game
room, universal engine interface, dynamic loader, or package per game.

## 1. Define the shared contract

Add browser-safe contract values to `@phone-party/protocol` and export the module
from `packages/protocol/src/index.ts`.

A real game normally needs:

- a Zod discriminated union for client action payloads;
- Colyseus schema classes for public synchronized state;
- stable phase or outcome constants shared by server and UI;
- inferred TypeScript types where consumers need parsed values.

Every action schema should contain only user intent. For example, a movement
message may contain a direction or pressed/released control; it must not contain
`playerId`, authoritative coordinates, velocity, collision results, or score.

Synchronized state is visible to all room clients. Keep hidden roles, secret
answers, anti-cheat data, signed values, reservations, and server-only seeds
outside it. If information is private to one player, design an explicit private
message or per-client view rather than placing it in shared schema state.

## 2. Implement authoritative rules

The server must validate each action against:

- the connected player's membership and current status;
- the current game phase;
- action-specific payload constraints;
- rate or timing constraints;
- the authoritative current world state.

Use a server-generated seed from `node:crypto` when determinism matters. If a
simulation tick or rules engine is independently meaningful, keep it as a pure
or narrowly mutable module whose inputs and outputs can be tested without
networking. Colyseus schema mutation should remain in the room boundary or in a
clearly owned simulation object.

Define explicit behavior for:

- minimum players and late joins;
- readiness and countdown cancellation;
- disconnect, reconnection, and permanent leave;
- host departure if the game gives the host special controls;
- simultaneous or conflicting actions;
- timers and process shutdown;
- completion, winner calculation, results, replay/rematch, and return to lobby.

Do not invent generalized platform behavior to avoid deciding these rules for
the actual game.

## 3. Define and register the game

Create a `GameDefinition` containing:

- a manifest parsed by `gameManifestSchema`;
- a unique, kebab-case game ID;
- a unique Colyseus room type that is not `__platform_lobby`;
- the game room class.

The manifest defines display name, description, positive version, minimum and
maximum player counts, and required phone orientation. Register the definition
explicitly in `apps/server/src/games/production-games.ts`.

The registry validates manifests, IDs, and room types at server startup. Do not
add filesystem discovery, arbitrary imports, a plugin manifest format, or a
second registry.

Registration makes the game trusted and exposes its public manifest at
`GET /api/games`; it does not by itself make the game playable from the lobby.

## 4. Implement the lobby-to-game transition

`select_game` still only stores a validated game ID. A new game must define the
smallest complete transition from lobby to play. Capital Pin, Falling
Platforms, and Flappy Race are the reference implementations: the lobby creates
the registered game room with a trusted roster, reserves one seat per connected player, sends
each client a `room:transition` reservation, repoints the room-code directory,
and then disconnects itself. The game room locks after its reservations are
issued so late joins are rejected without deleting the mapping, and it disposes
itself if any roster player never arrives. Game-room creation requires a
server-issued capability token so the public Colyseus matchmaking endpoint
cannot forge a roster; each game starts round 1 automatically when the roster
is complete.

That change must address, in one documented contract:

- when selection is allowed and whether players confirm readiness;
- whether gameplay stays in the lobby room class or moves to the registered game
  room;
- how every connected player receives or consumes a new seat reservation if a
  new room is created;
- what happens when only some clients transition successfully;
- whether late joins are allowed;
- how the room code continues to address the active room;
- how the previous room and directory mapping are cleaned up;
- how results return to a lobby or start a rematch.

Prefer the narrowest design for the actual game. Do not build a generic
lifecycle state machine until more implemented games prove the common
transitions; two feature-local transitions are not yet that evidence.

Update the [room lifecycle contract](../apps/server/src/rooms/docs/room-lifecycle.md)
as part of this work.

## 5. Build the phone UI

Add a feature-local MUI renderer that consumes synchronized game state and sends
validated intent messages. It must:

- work at 320 CSS pixels without page-level horizontal scrolling;
- use accessible semantic controls with visible focus and adequate touch sizes;
- communicate phase, status, results, and errors without color alone;
- respect required orientation and reduced-motion preferences;
- clean up subscriptions, input listeners, animation frames, and timers;
- render honestly during disconnect and reconnection;
- avoid copying the Colyseus state into another authoritative React store.

Use the application theme, MUI primitives, responsive `sx`, and the shared
provider stack. Do not introduce game-local CSS or a second component system for
ordinary controls and layout.

Do not add a generic client game loader before the first concrete renderer makes
its actual needs known. Explicit imports and a small switch over trusted game IDs
are acceptable for the first game.

## 6. Test the complete authority boundary

### Protocol tests

- valid and malformed actions;
- bounds, empty values, and discriminant handling;
- synchronized state defaults and public shape.

### Engine unit tests

- phase transitions and timers;
- legal and illegal actions;
- deterministic seeded behavior;
- collisions, scoring, elimination, ties, and winners;
- disconnect and player-count edge cases.

### Room integration tests

Use the real Colyseus test server and multiple clients. Cover:

- game registration and room creation;
- state synchronization to every client;
- forged player IDs and claimed outcomes being ignored or rejected;
- non-host privilege attempts;
- invalid phase and malformed messages;
- simultaneous actions where ordering matters;
- leave, reconnect, host transfer, disposal, and timer cleanup.

### Component and E2E tests

Cover visible phases, controls, connection states, accessibility, narrow layout,
and results. The browser test should create a lobby, join with the supported
minimum number of isolated browser contexts, select the game, play a
deterministic path, observe the authoritative result on every phone, and cleanly
finish or return to lobby.

Add colocated Storybook stories for the renderer's meaningful waiting,
countdown, playing, disconnected, completed, long-content, and narrow-phone
states. Stories use deterministic props and the global application providers;
they do not open real rooms.

## Completion checklist

Before shipping a production game:

1. Update protocol, server, web, room-lifecycle, and architecture documentation
   to match the implemented transition.
2. Run focused protocol, engine, room, and component tests.
3. Run `pnpm check`.
4. Run `pnpm storybook:build`.
5. Run `pnpm test:e2e`.
6. Review the complete change for copied authority, leaked private state,
   missing cleanup, speculative abstractions, fake catalogue data, and obsolete
   placeholders.
