# Architecture

## Principles

1. **Server-authoritative.** Clients send intentions; the server validates,
   mutates state and synchronizes the result. Clients never announce scores,
   wins or positions.
2. **Games are isolated modules.** The platform knows no game rules. A game
   provides a `GameDefinition` and owns its state schema, commands, validation,
   views, scoring, round lifecycle and victory conditions.
3. **One authoritative owner per room.** Each room is a single `PlatformRoom`
   instance; all mutations flow through its per-room `SerialQueue`.
4. **Colyseus is the foundation, not a detail.** Rooms, schema state sync,
   messages, reconnection tokens and Presence are Colyseus primitives. The
   platform adds the application concepts Colyseus does not provide: room
   codes, lobby/host/ready state, play again, typed errors, match results and
   test tooling.

## Packages

| Package | Role |
|---|---|
| `platform-shared` | Protocol error codes, operations, message names, Zod schemas (names, room codes, commands, config, results, stored connections), `MatchResult` types. Isomorphic. |
| `platform-schema` | Synchronized Colyseus Schema classes: `PlatformState`, `PlatformPlayerState`, `LeaderboardEntryState`, `MatchResultState`. Isomorphic; imported by games and server. |
| `platform-server` | Behaviour only: `GameDefinition` contract, `PlatformRoom`, `RoomCodeAllocator` (Presence), `SerialQueue`, host/ready/start rules, leaderboard builder, config, Pino logger. |
| `client-sdk` | Framework-independent `MultiplayerClient`: connection lifecycle, typed lobby commands with request IDs, reconnection records, server clock estimation, state selectors. |
| `platform-test` | `createTestServer`, `FakeClient`, `advanceRoomTime`, `waitFor`. |
| `shared` (Falling Platforms) | FP command schema, synchronized FP state classes, constants, grid math. |
| `tap-race` | Tap Race command schema, synchronized state classes (root export) and `GameDefinition` (`./server`). |

Dependency rule: synchronized schema classes import only `platform-schema`
(never `platform-server`). Server behaviour imports `platform-server`.

## Room lifecycle

`PlatformRoom` (extends Colyseus `Room`):

- `onCreate`: claims a unique room code via Presence (`incr` + `expire` TTL),
  sets it as the Colyseus `roomId`, creates the game state, wires the optional
  simulation tick, schedules the room lifetime timer.
- `onJoin`: validates `{ name }` (Zod), enforces `lobby || allowJoinAfterStart`
  and `maxClients`, creates the player row, makes the first joiner host.
- `onDrop`: enqueues only the "mark reconnecting" mutation, then awaits
  `allowReconnection(client, graceSeconds)` **outside** the serial queue.
  `onReconnect`/`onLeave` enqueue their own short mutations.
- `onLeave`: permanently removes the player (host transfer included), calls
  `game.onRemoved`; Colyseus auto-disposes the empty room.
- `onDispose`: releases the code, cancels timers, disposes the queue, calls
  `game.onDispose`.

Room status: `lobby → running → finished → lobby` (play again) or `closed`.
Countdowns are game-level state (Falling Platforms models its own phases).

## Serial processing and sync hooks

- `SerialQueue`: one operation at a time, insertion order preserved, failures
  logged and isolated, work rejected after disposal, `idle()` for tests,
  warnings when depth or operation duration exceed thresholds.
- `onTick` and `onCommand` must be synchronous. A thenable return is treated as
  an unexpected game error (logged, room closed). Lifecycle hooks are expected
  to be short and synchronous too; the queue protects against accidental async
  lifecycle operations.
- Platform-only async work (Presence access, `allowReconnection`) happens
  outside the queue.

## Reconnection

The client SDK persists a per-connection record
`{ serverUrl, roomId, roomName, reconnectToken, updatedAt }` after create/join
and after every successful reconnect (Colyseus rotates the token on each
handshake). On drop, the SDK enters `reconnecting`; Colyseus reconnects with
the token and sends a full state snapshot (`sendFullState`), so the client
exactly catches up — verified by an integration test that changes state while
the client is offline.

## Timers and clock

- Games schedule through `GameContext.scheduleIn/scheduleAt/cancelSchedule`,
  which use the Colyseus room clock (auto-cleared on dispose). Callbacks run
  through the serial queue.
- `GameContext.now()` returns absolute epoch milliseconds from an injectable
  clock, and game schema timestamps (`startsAt`, `endsAt`) are absolute.
- Clock synchronisation uses a typed `platform:time-sync` exchange: the client
  sends `{ requestId, sentAt }`, the server replies with `serverTime`, and the
  SDK computes `offset = serverTime − (sentAt + receivedAt) / 2`, smoothed with
  an exponential moving average. `client.getEstimatedServerTime()` exposes the
  result. `room.ping()` is deliberately not used for offsets; it only measures
  RTT.

## Errors

- Join/create failures reject the SDK promise and map Colyseus `ServerError`
  codes to stable `ProtocolErrorCode`s.
- Lobby and game commands are manually Zod-parsed (Colyseus `validate()` would
  silently ignore malformed messages without a structured error).
- Lobby commands require a `requestId`; the server replies with
  `platform:command-result`. High-frequency game commands are fire-and-forget
  unless a request ID is requested.
- `GameDefinition.onCommand` returns a typed `CommandResult` for expected
  failures. Only unexpected exceptions close the room.

## Config and hardening

`loadServerConfig` Zod-validates environment variables at startup. The server
applies `maxMessagesPerSecond` (Colyseus), `maxPayload` and origin verification
on the WebSocket transport, plus `CLIENT_ORIGINS` on HTTP. Reconnect tokens are
never logged; untrusted payloads are validated before any room mutation.
