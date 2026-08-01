# Protocol

All messages are Colyseus room messages (msgpack). Persistent state is
Colyseus Schema; messages carry commands, results and transient feedback.

## Message types

| Direction | Type | Payload |
|---|---|---|
| Client → server | `platform:set-ready` | `{ ready, requestId }` |
| Client → server | `platform:start` | `{ requestId }` |
| Client → server | `platform:play-again` | `{ requestId }` |
| Client → server | `game:command` | `{ command, requestId? }` |
| Client → server | `platform:time-sync` | `{ requestId, sentAt }` |
| Server → client | `platform:command-result` | `{ requestId, operation, ok, data? \| error }` |
| Server → client | `platform:error` | `{ operation, requestId?, error }` |
| Server → client | `platform:time-sync` | `{ requestId, sentAt, serverTime }` |
| Server → client | `match:finished` | `{ result }` |
| Game-specific | e.g. `hop-rejected` | game-defined transient feedback |

`operation` is one of `room.create`, `room.join`, `room.set-ready`,
`room.start`, `room.play-again`, `game.command`, `time-sync`,
`room.internal`.

## Command completion

- Lobby commands (`set-ready`, `start`, `play-again`) require a `requestId`.
  The server enqueues the mutation and replies with `platform:command-result`
  containing the same `requestId`. The SDK lobby methods return promises that
  resolve on `ok: true` and reject with the `ProtocolError` otherwise
  (5-second default timeout → `REQUEST_TIMEOUT`).
- `game:command` without a `requestId` is fire-and-forget: accepted commands
  mutate state; expected rejections are not transmitted (games may use their
  own feedback messages). With a `requestId`, the server replies with a
  `platform:command-result` carrying the game's `CommandResult`.
- Malformed platform payloads produce `platform:error` with `INVALID_REQUEST`
  (no request ID to correlate). Join/create failures reject the SDK call and
  emit `onError`.

## Error codes

`INVALID_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `ROOM_NOT_FOUND`,
`ROOM_FULL`, `ROOM_NOT_JOINABLE`, `PLAYER_NOT_IN_ROOM`, `NOT_HOST`,
`PLAYERS_NOT_READY`, `NOT_ENOUGH_PLAYERS`, `GAME_ALREADY_STARTED`,
`GAME_NOT_RUNNING`, `UNKNOWN_GAME`, `INVALID_GAME_COMMAND`, `RATE_LIMITED`,
`REQUEST_TIMEOUT`, `INTERNAL_ERROR`.

`ProtocolError` is `{ code, message, details? }`. Stack traces and internal
state are never exposed.

## Synchronized state

`PlatformState` (extended by every game):

```ts
roomCode, gameId, status ("lobby"|"running"|"finished"|"closed"),
hostSessionId, createdAt, minPlayers, requiresReady,
result: MatchResultState | null
```

`PlatformPlayerState` (extended by game player classes):

```ts
name, connectionStatus ("connected"|"reconnecting"|"disconnected"),
isHost, isReady, joinedAt, joinedOrder
```

Games declare their own `players` map typed with their player class, plus any
game fields. There are no sequence numbers or snapshot requests: Colyseus
patches are continuous and a full state snapshot is sent on join and reconnect.

## Start rules

`platform:start` succeeds only when the actor is the host, the room is in the
lobby, at least `minPlayers` connected players are present and (when
`requiresReady`) every player is ready. Falling Platforms configures
`requiresReady: false`; Tap Race requires ready states.

## Play again

`platform:play-again` is host-only and only valid in `finished`. It cancels the
finished-room disposal timer, resets ready states and scores, calls
`game.onReset` and returns the room to the lobby.

## Match results

`MatchResult`:

```ts
{
  winnerSessionIds: string[];          // ties supported
  leaderboard: Array<{
    sessionId; rank; primaryScore; label; secondaryLabel?;
  }>;
  finishedAt: number;
  metadata?: Record<string, unknown>;
}
```

Games build results (the platform exports a competition-ranking helper) and
call `GameContext.finishMatch(result)`; the platform validates that every
leaderboard entry belongs to the room before storing and broadcasting it.
