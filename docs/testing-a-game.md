# Testing a game

## The test kit

`@falling-platforms/platform-test` provides:

- `createTestServer(appConfig)` — an isolated Colyseus test server.
- `connectTestClient(server, room, options)` — a typed `FakeClient` with
  `state`, `sessionId`, `reconnectionToken`, `send`, `waitForMessage`,
  `waitFor`, `disconnect`, `reconnect` and `leave`.
- `advanceRoomTime(room, ms)` — advances the room clock deterministically for
  server-scheduled timers.
- `waitFor(predicate, description, timeoutMs)` — polling assertion helper.

Avoid arbitrary real-time sleeps; prefer `waitFor` and `advanceRoomTime`.

## Unit-testing pure game logic

Keep scoring/validation logic in pure functions (Falling Platforms does this in
`apps/server/src/game/*`). Feed them explicit `now` values:

```ts
const runtime = makeRuntime();
const player = addPlayerAt(runtime, "p1", "P1", "3:3");
expect(validateHop(runtime, player, "3:4", 1)).toBeNull();
updateMatch(runtime, 1_000);
```

## Integration-testing a game

```ts
process.env.E2E_TEST_MODE = "true";
process.env.RECONNECT_GRACE_MS = "1000";
const { appConfig } = await import("../src/app.config.js");
const colyseus = await boot(appConfig);

const room = await colyseus.createRoom("my_game", {});
const alice = await connectTestClient(colyseus, room, { name: "Alice" });
const bob = await connectTestClient(colyseus, room, { name: "Bob" });

alice.send("platform:set-ready", { ready: true, requestId: "r1" });
await alice.waitForMessage("platform:command-result");
// ... ready, start, play, assert state ...
```

Recommended coverage:

- Lobby: create/join, host assignment, ready policy, non-host start rejection,
  minimum players, room capacity.
- Commands: valid commands mutate authoritative state; invalid shapes return
  `INVALID_REQUEST`/`INVALID_GAME_COMMAND`; disallowed phase commands return a
  typed rejection; game rate limits hold.
- Timers: `advanceRoomTime` drives countdown/end timers; results are stored and
  broadcast.
- Reconnection: same `sessionId` restored, removal cancelled, and an exact
  catch-up test where state changes while the client is offline.
- Lifecycle: grace-period removal, host transfer, empty-room disposal, room
  code uniqueness and release.

## Browser end-to-end tests

Two independent browser contexts (Playwright). Pattern used by both games:
create a room in context A, join with the code in context B, complete the flow,
and force offline/online for the reconnection scenario (`context.setOffline`).
E2E configs set `E2E_TEST_MODE=true` so matches finish in seconds.
