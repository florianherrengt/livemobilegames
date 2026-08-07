# Room lifecycle

Rooms are ephemeral, server-authoritative Colyseus rooms addressed to people by
a six-character code. The platform creates a lobby before a game is chosen, and
the installed Capital Pin, Falling Platforms, Flappy Race, Live Drawing &
Guessing, and Memory Path games transition the whole lobby into a registered
game room when the host starts them.

## Ownership

| Concern | Owner | Lifetime |
| --- | --- | --- |
| Anonymous player ID | Signed `pp_player_id` cookie | Up to one year in a browser |
| Human room code mapping | `RoomDirectory` | Current server process and room lifetime |
| Matchmaking reservation | Colyseus | Until consumed or expired by Colyseus |
| Players, host, selected game | `LobbyRoomState` | Current Colyseus room |
| Live connection/reconnection | Colyseus client and server | Current room session |

The room directory maps a normalized code to `{ roomId, gameId }`. Lobby entries
currently use `gameId: null`; the selected lobby game lives in synchronized room
state. Do not infer or copy selected-game state into the directory until a real
room transition requires that mapping.

## Anonymous identity

Room endpoints run after anonymous-session middleware. A valid signed cookie is
reused; a missing, malformed, or tampered cookie is replaced with a
server-generated UUID and a new HTTP-only, `SameSite=Lax` signed cookie.

The HTTP layer passes that trusted ID into Colyseus room or seat options. Client
JSON cannot choose it. Once connected, a room action derives the actor from the
Colyseus `Client.sessionId` and its associated state, never from the message.

Lobby creation and seat reservation require a process-local capability through
Colyseus matchmaking authorization. The capability is injected only by
`RoomService` and is never included in the HTTP reservation response. Public
matchmaking calls therefore cannot create a platform lobby or reserve forged
seat options directly.

## Room codes

Codes contain six characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, excluding
ambiguous `0`, `1`, `I`, and `O`. Input is trimmed and uppercased. Generation uses
`crypto.randomInt` and reserves a placeholder in the directory before async room
creation, preventing two concurrent creates from receiving the same code.

The directory attempts at most 100 generated codes. A failed room creation
deletes its reservation. Directory entries are copied on read and write so
callers cannot mutate the owned map indirectly.

## HTTP contract

### `POST /api/rooms`

Creates a lobby and returns `201 Created`.

Request:

```json
{ "playerName": "Alice" }
```

Response:

```json
{
  "room": { "code": "ABC234", "game": null },
  "reservation": {
    "name": "__platform_lobby",
    "roomId": "<colyseus-room-id>",
    "sessionId": "<colyseus-session-id>"
  }
}
```

The reservation may contain additional Colyseus transport fields defined by the
shared protocol schema. Creation is limited to 10 attempts per minute per
anonymous player and socket address.

Creation sequence:

1. Hono parses the player name and derives the signed-session player ID.
2. `RoomDirectory` reserves a random code.
3. `RoomService` asks Colyseus to create `__platform_lobby` with trusted room and
   creator options.
4. The service replaces the placeholder with the room ID and attaches disposal
   cleanup.
5. The browser consumes the returned seat reservation and opens the room socket.

If any step after reservation fails, the code is deleted. If a Colyseus room was
already created, the service disconnects it before returning a safe error.

### `POST /api/rooms/:code/join`

Reserves a seat in the exact room and returns `200 OK` with the same response
shape.

Request:

```json
{ "playerName": "Bob" }
```

The route validates the code syntax, normalizes it, looks up its room ID, and
calls `joinById`; it never asks the matchmaker for an arbitrary room. Joining is
limited to 20 attempts per minute per anonymous player and socket address.

### Errors

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | Malformed code, JSON, or player name |
| `ROOM_NOT_FOUND` | 404 | No current mapping exists for the code |
| `ROOM_EXPIRED` | 404 | A mapping existed but its Colyseus room no longer does |
| `ROOM_FULL` | 409 | The existing room cannot accept another reservation |
| `RATE_LIMITED` | 429 | The per-player/address limit was exceeded |
| `SERVER_SHUTTING_DOWN` | 503 | Creation began after shutdown started |
| `INTERNAL_ERROR` | 500 | Room creation failed unexpectedly |

An expired mapping is deleted before `ROOM_EXPIRED` is returned, allowing the
code to be reused later.

## Lobby state and messages

`LobbyRoomState` synchronizes:

- `roomCode`;
- `gameId`, empty until a valid selection;
- `hostSessionId`;
- a `MapSchema` of players keyed by Colyseus session ID.

Each `LobbyPlayerState` contains the server-supplied player UUID, display name,
and host flag. The first connected client becomes host.

A trusted player UUID may have only one live lobby membership. A duplicate
connection is rejected before state changes, preventing one browser identity
from inflating the roster or producing an impossible game transition. Once the
old membership leaves, the same identity may join again normally.

The lobby accepts these messages, sent through the Colyseus SDK:

```ts
room.send("select_game", { gameId: "game-id" });
```

The select payload is parsed by `selectGameRequestSchema`. Only the current host
may select, and the ID must exist in the immutable server registry. Invalid
messages produce a Colyseus application error and do not change state.

```ts
room.send("start_game", {});
```

`start_game` is parsed by `startGameRequestSchema`. Only the current host may
start, a game must already be selected, and at least the game's minimum number
of players must be connected. A failed start sends a typed `room:error` payload
and leaves the lobby untouched.

## Lobby-to-game transition

Starting the selected game hands every connected player off to the registered
game room in one documented flow:

1. The lobby builds a trusted roster from its synchronized player rows: player
   ID, display name, host flag, and join order. No client payload contributes
   to the roster.
2. The lobby marks itself `transitioning`, which rejects new joins, and calls
   `startGameTransition`.
3. `startGameTransition` creates the game room with the roster as trusted room
   options, reserves one seat per connected player with `joinById`, repoints
   the room-code directory entry to the game room, locks the game room, and
   attaches directory cleanup to its disposal.
4. The lobby sends each connected client a `room:transition` message carrying
   that player's own seat reservation, then disconnects itself after the
   messages flush. The lobby's own disposal cleanup only deletes the directory
   entry while it still points at the lobby.
5. Each web client consumes its reservation with the game's synchronized state
   class and replaces its single room connection; the lobby room is left.
6. The game room requires every roster player to connect within the configured
   transition deadline (`CAPITAL_PIN_TRANSITION_TIMEOUT_MS`, shared by every
   registered game). If any never arrives, it disconnects itself; unconsumed
   reservations expire within the bounded reservation window and the directory
   mapping is released. There is no half-started game.
7. When the last roster player arrives, the game room starts round 1
   automatically. The platform lobby's Start button is the only manual start:
   there is no second start inside the game room.

Game-room creation carries a server-issued capability token that only the
platform lobby knows. The game room rejects any creation that does not include
it, so the public Colyseus matchmaking endpoint cannot forge a roster,
host flags, or test-mode timing.

After the transition the room code continues to address the game room. Joining
by code during gameplay returns `ROOM_NOT_JOINABLE` (409) and keeps the mapping;
the game room is locked, so no new seat reservation is issued. Only the players
who were in the lobby when the game started can participate.

## Leave, host transfer, reconnect, and disposal

When a client leaves, the room removes its player. If the host leaves, the first
remaining session in the room map becomes host; with no players the host ID is
cleared. Colyseus controls the room's ultimate disposal policy.

The web client uses the room's reconnection token after an unexpected socket
leave. Successful reconnection replaces the room reference and reattaches state
and leave listeners. Intentional leave and provider unmount do not reconnect.
If no token exists or reconnect fails, the browser clears its connection and can
join again through the room URL while the server room still exists.

`RoomService` wraps each created room's `onDispose` callback to delete the code
mapping and preserve any original callback. A stale mapping found during join is
also deleted. Server restart loses the directory, every room, and every
reconnection token by design.

## Current game lifecycles

Each installed game owns the transition into its own room and then its full
loop inside that room:

- Capital Pin: `lobby -> round -> round-results -> finished -> lobby`.
- Falling Platforms: `lobby -> countdown -> playing -> results -> lobby`.
- Flappy Race: `lobby -> countdown -> running -> round-result -> finished -> lobby`.
- Live Drawing & Guessing: `lobby -> preparing -> drawing -> result -> round-summary -> finished`.
- Memory Path: `lobby -> preparing -> preview -> racing -> round-result -> match-result -> lobby`.

The games start themselves when the roster is complete, so the host starts
once in the platform lobby. `play_again` is the host-only convention the games
use: it returns the room to its lobby and starts the next game immediately when
everyone is connected. Falling Platforms resets the round counter for a fresh
match and draws a new server-side seed for every round, while Capital Pin keeps
its ten-round match and Flappy Race keeps its five-round match until
`play_again` resets them; Memory Path plays three normal rounds plus sudden
death when leaders are tied, and `play_again` resets it for a fresh match.

The platform still owns identity, room codes, membership, reservations,
reconnection, and cleanup; the feature-local transitions do not justify
generic transition or lifecycle machinery.

### Live Drawing & Guessing

Live Drawing & Guessing follows the same lobby-to-game transition, then runs
three rounds of drawing turns (`preparing -> drawing -> result`) with a brief
round summary between rounds and a final scoreboard. The drawer receives the
private word through a `drawer:briefing` message and can request it again with
`drawer:request`; guessers see only the category, a progressive letter pattern,
and the live synchronized strokes.

Two behaviors intentionally differ from the other installed games:

- The game room unlocks itself as soon as a match starts. A player who joins by
  room code mid-match consumes a normal HTTP seat reservation as a spectator:
  they watch, cannot guess or draw, and become a participant when the host
  presses Play again. The room rejects direct Colyseus matchmaking seats through
  `onAuth`, so only the Hono join route (which knows the process-local token)
  can issue spectator seats.
- A participant who disconnects keeps their score and place in the drawing
  order. If the current drawer drops, the turn holds for up to five seconds and
  resumes on reconnect; otherwise it is skipped with no points. A guesser who
  drops simply stops guessing until they reconnect, and the turn ends
  immediately when no connected guessers remain.
