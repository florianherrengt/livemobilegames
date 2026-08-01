# Reusable Colyseus Multiplayer Platform — Implementation Plan (v3)

Status: approved. This plan is the authoritative implementation reference.

## Summary

Convert the repository into a reusable multiplayer application layer on top of
Colyseus 0.17, preserving Falling Platforms (Phaser client, gameplay, server
authority) as the first consumer and adding Tap Race as the second consumer.
The platform owns rooms, room codes, lobby/host/ready state, reconnection
handling, typed commands and errors, match results, time synchronisation and
test tooling. Games own rules, state schemas, commands, timers and scoring.

Non-negotiable corrections applied in this version:

1. `allowReconnection()` awaits outside the room serial queue; only the
   immediate "mark reconnecting" mutation is queued. `onReconnect()` and
   permanent `onLeave()` enqueue their own short mutations. Game hooks are
   synchronous; only platform lifecycle operations (Presence, reconnection)
   are asynchronous.
2. Falling Platforms commands go through the shared `"game:command"` ingress.
   `GameClient.sendHop()` remains the public client API but sends a typed
   `FallingPlatformsCommand` through the platform. `hop-rejected` remains as
   game-specific outbound feedback.
3. `GameDefinition` is generic over game state, game player state and command,
   and provides `createState()` and `createPlayerState()`. All synchronized
   schema classes live in isomorphic packages (`platform-schema`, game
   packages); server packages contain behaviour only.
4. Colyseus `validate()` ignores invalid messages without structured errors;
   the platform manually Zod-parses messages so it can return typed errors.
   Lobby commands require request IDs and receive `platform:command-result`.
   SDK lobby methods return promises. High-frequency game commands are
   fire-and-forget unless a request ID is requested. `onCommand` returns a
   typed success/rejection result; only unexpected exceptions close the room.
5. The SDK uses `client.create(roomName, options)` and
   `client.joinById(roomCode, options)`. Room-code claims use the Presence API
   (`incr` + `expire`, released with `del` in `onDispose`) with a TTL longer
   than the maximum possible room lifetime.

## Current state (audit)

- `packages/shared`: Falling Platforms types, Zod schemas, room-code
  alphabet/generation/normalisation, grid math, constants.
- `apps/server`: Colyseus 0.17 + `@colyseus/schema` + Express 5. The room owns
  codes, host, reconnection, start, simulation loop and schema sync; `src/game/*`
  is pure game logic.
- `apps/client`: Phaser 4 + Vite + `@colyseus/sdk`; `GameClient.ts` is a thin
  transport wrapper; scenes/renderers are game-specific.
- Root: pnpm 10, Biome, Vitest, Playwright. Baseline green: typecheck, lint,
  77 tests.

## Architecture

### Packages

| Package | Contents | Depends on |
|---|---|---|
| `packages/platform-shared` | Protocol errors, operations, message types, Zod schemas (names, room codes, lobby commands, game config, match results, stored connection), `CommandResult` | `zod`, `nanoid` |
| `packages/platform-schema` (new, isomorphic) | All synchronized Colyseus Schema classes: `PlatformState`, `PlatformPlayerState`, `LeaderboardEntryState`, `MatchResultState` | `@colyseus/schema`, `platform-shared` |
| `packages/platform-server` | `GameDefinition`, `GameContext`, `PlatformRoom`, `RoomCodeAllocator` (Presence), `SerialQueue`, host/ready/start helpers, leaderboard, logger, config | `colyseus`, `@colyseus/schema`, `zod`, `pino`, `platform-shared`, `platform-schema` |
| `packages/client-sdk` | `MultiplayerClient`, connection record storage, time sync, connection status, lobby selectors | `@colyseus/sdk`, `platform-shared` |
| `packages/platform-test` | `createTestServer`, `createTestClient`, `advanceRoomTime`, `waitFor` helpers, cleanup | `@colyseus/testing`, `colyseus`, `platform-server`, `platform-schema`, `client-sdk` |
| `packages/tap-race` | Root: command types/Zod schema, `TapRaceState`/`TapRacePlayerState` schema classes. `./server`: `TapRaceGame` | `platform-shared`; `./server` also `platform-schema`, `platform-server` |
| `apps/server` | Config, registrations, FP game module, `/health`, `/games`, static clients | platform packages, `tap-race`, `shared`, `colyseus`, `express`, `seedrandom` |
| `apps/client` | Existing Phaser FP client consuming `client-sdk` | `client-sdk`, `shared` |
| `apps/tap-race-client` | Minimal Vite + vanilla TS Tap Race client | `client-sdk`, `tap-race` |

Dependency rule: synchronized schema classes import only `platform-schema`
(never `platform-server`). Server behaviour imports `platform-server`.

### Identity

No cross-room `playerId` in v1. Colyseus `sessionId` is the room-membership
identity: stable across socket reconnection, valid for one room membership.
SDK exposes `getMembership()`. Display names are prefilled from local storage.
A separate anonymous `playerId` across rooms is a documented future extension.

### Room codes (Presence)

- Claim: `code = generate()`; `count = presence.incr("room_codes:" + code)`;
  if `count === 1` set `expire(key, ttlSeconds)` and return; else retry.
- TTL: `MAX_ROOM_LIFETIME_MS + FINISHED_ROOM_TIMEOUT_MS +
  max reconnect grace + 60s safety margin` (override: `ROOM_CODE_CLAIM_TTL_MS`).
- Release: `presence.del(key)` in `onDispose`.
- In-memory `LocalPresence` in v1; Redis Presence compatible (atomic `incr`).

### Clock synchronisation

- Message `"platform:time-sync"`: client sends `{ requestId, sentAt }`; server
  replies `{ requestId, sentAt, serverTime }` from the injectable epoch clock.
- SDK: `offset = serverTime - (sentAt + receivedAt) / 2`, EWMA smoothing
  (α = 0.3, RTT > 1s samples discarded), `getEstimatedServerTime()`.
- `GameContext.now()` uses the same epoch clock; game schema timestamps
  (`startsAt`, `endsAt`) are absolute epoch ms.

### Errors and command completion

- Lobby commands (`platform:set-ready`, `platform:start`,
  `platform:play-again`) require `requestId`; server replies
  `"platform:command-result"` `{ requestId, operation, ok, data? | error }`.
- SDK lobby methods return promises (5s default timeout → `REQUEST_TIMEOUT`).
- `"game:command"` is `{ command, requestId? }`. With a request ID the server
  replies with a command result; without one it is fire-and-forget and expected
  rejections are not transmitted (games use game-specific feedback such as
  `hop-rejected` when needed).
- `onCommand` returns `CommandResult | void` synchronously. Expected failures
  are results; only unexpected exceptions close the room.
- Malformed platform messages → `"platform:error"` `INVALID_REQUEST` with
  operation. Join/create failures reject the SDK promise and emit `onError`,
  mapping Colyseus `ServerError` codes.

### Reconnection state

`StoredConnection { serverUrl, roomId, roomName, reconnectToken, updatedAt }`
persisted after create/join and after every successful reconnect (token
rotation), cleared on leave/expiry. localStorage + in-memory implementations.
Manual `reconnect()` re-attaches every listener to the new Colyseus Room
before exposing the connection as restored. Colyseus sends a full state on
reconnect (`sendFullState`); a catch-up integration test proves exact
resynchronisation; no extra mechanism unless that test fails.

### Serial processing and async policy

- Per-room `SerialQueue` for all room mutations and game lifecycle hooks.
- `onDrop`: enqueue only the "mark reconnecting" mutation; `await
  allowReconnection(...)` outside the queue; `onReconnect`/`onLeave` enqueue
  their own mutations.
- `onTick` and `onCommand` are synchronous (thenable return detected at
  runtime → error + room close). Lifecycle hooks may be async but are expected
  to be short.
- Queue health: warn when depth > `QUEUE_WARN_DEPTH` (20) or an operation runs
  longer than `QUEUE_WARN_DURATION_MS` (100).

### Lobby UI

Not extracted. The SDK shares only the controller/state model
(`getLobbySnapshot()`, `onStateChange`, connection status). Phaser and vanilla
clients render their own UI.

### Platform room behaviour

- `onCreate`: claim code via Presence, set `roomId`, create game state, wire
  simulation tick if the game defines `onTick`, schedule lifetime timer.
- `onJoin`: validate `{ name }` via Zod (reject with `ServerError` on failure),
  enforce `lobby || allowJoinAfterStart`, create player state, first joiner is
  host, call `game.onJoin`.
- `onDrop`/`onReconnect`: presence transitions + game hooks (queue); Colyseus
  handles the token handshake.
- Permanent leave: remove player, call `game.onRemoved`, transfer host
  (earliest-joined connected, else earliest remaining), close when empty.
- Start: host only, lobby only, `>= minPlayers` connected, all ready iff
  `requiresReady`. Play again: host only, finished only; resets ready and
  calls `game.onReset`; cancels the finished-room disposal timer.
- `finishMatch(result)`: validates leaderboard ids against the room, stores the
  result in the schema, status → `finished`, schedules finished-room timeout,
  broadcasts `"match:finished"`.
- `returnToLobby()`: cancels the finished timer, status → `lobby`, clears
  result, resets ready states, calls `game.onReset`.
- Unexpected errors: log with room/game context, notify clients, close room.
- `onDispose`: release code, cancel timers, dispose queue, call `game.onDispose`.

## Migration sequence

### Phase A — platform foundation (Falling Platforms untouched)

1. `platform-shared`, `platform-schema`, `platform-server`, `client-sdk`,
   `platform-test` with unit tests.
2. Root config: strict tsconfig flags across the workspace, `.env.example`
   (`PORT`, `HOST`, `ROOM_CODE_LENGTH=5`, `MAX_MESSAGES_PER_SECOND=60`,
   `MAX_ROOM_LIFETIME_MS`, `FINISHED_ROOM_TIMEOUT_MS`,
   `ROOM_CODE_CLAIM_TTL_MS`, `MAX_SOCKET_PAYLOAD_BYTES`, `CLIENT_ORIGINS`,
   `LOG_LEVEL`, `QUEUE_WARN_DEPTH`, `QUEUE_WARN_DURATION_MS`,
   `RECONNECT_GRACE_MS`), root scripts.

### Phase B — Falling Platforms migration

1. `packages/shared` becomes the isomorphic FP game package: FP command types
   and Zod schema (`fallingPlatformsCommandSchema` with `type: "hop"`),
   `FallingPlatformsState`/`FallingPlatformsPlayerState` extending
   `platform-schema` classes, existing constants/grid/types.
2. Extract `FallingPlatformsRoom` into a `GameDefinition` in `apps/server`:
   config `{ minPlayers: ALLOW_SOLO ? 1 : 2, maxPlayers: 100,
   allowJoinAfterStart: true, requiresReady: false, removeDisconnectedPlayers:
   true, reconnectGraceMs: env }`. Runtime timestamps become absolute epoch ms.
   Platform owns codes/host/reconnection/start; FP owns simulation, hops,
   platforms, results.
3. `onTick` runs `updateMatch` + schema sync and calls `finishMatch` on
   results, `returnToLobby` when the results timer resets the phase.
4. `GameClient` wraps `client-sdk`; `sendHop` sends
   `{ type: "hop", sequence, targetPlatformId }` via `game:command`; UI and
   Phaser scenes unchanged.
5. Behavior deltas (documented): permanent mid-match leave removes the player
   row immediately; player cap is finite (100). Existing tests stay green.

### Phase C — Tap Race

1. `packages/tap-race`: config `{ minPlayers: 2, maxPlayers: 20,
   reconnectGraceMs: env, allowJoinAfterStart: false, removeDisconnectedPlayers:
   true, requiresReady: true }`; countdown 3s, match 10s (0.5s/2s in
   `E2E_TEST_MODE`); taps only while playing, 20 taps/sec rate limit; standard
   competition ranking with ties; `onReset` clears scores.
2. `apps/tap-race-client`: vanilla Vite app (name → create/join → lobby with
   ready → countdown → tap button → leaderboard → play again; reconnecting
   overlay). Served at `/tap-race/`.
3. Register both games in `apps/server`; `/games` endpoint; integration tests;
   two-context Playwright e2e.

### Phase D — docs and verification

README rewrite; `docs/architecture.md`, `docs/protocol.md`,
`docs/creating-a-game.md`, `docs/testing-a-game.md`. Full verification: clean
install, format, lint, typecheck, unit, integration, both e2e suites,
production build, manual two-browser run, offline reconnect, token-log scan,
`rg` for `any`/TODOs/skipped tests, new-game registration check.

## Test plan

- Unit: room-code allocator (fake Presence: length/alphabet/collision/atomic
  claim/release/TTL); serial queue (order, async lifecycle ops, isolation,
  dispose rejection, idle, warnings); host/ready/start rules; leaderboard
  ranking; sync-hook guard; schema encode/decode incl. nullable result;
  display-name and config schemas; stored-connection schema; client storage,
  time-sync math, status transitions, lobby selectors.
- Integration (Colyseus test server, `advanceRoomTime` + `waitFor`): FP
  regression suite preserved; Tap Race lobby flow, ready/start policy,
  non-host rejection, countdown, taps, timer finish, ties, play again, room
  full, malformed payloads, disallowed commands with request IDs, rate limit,
  empty-room dispose, code uniqueness/freeing; reconnection: same sessionId,
  removal cancelled, catch-up while state changed offline, grace expiry,
  reconnect-after-expiry; time sync tolerance; origin/payload limits.
- E2E (Playwright, two contexts): FP existing specs; Tap Race full flow and
  offline reconnection (same sessionId, exact state, token rotated).

## Known v1 limitations

Single process; in-memory rooms and Presence; restart loses active rooms; no
accounts/matchmaking/persistence; room-scoped identity only; no shared lobby UI
package; FP mid-match quit removes the player row; no replay/sequence audit.
