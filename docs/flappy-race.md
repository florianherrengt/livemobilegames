# Flappy Race

Flappy Race is a five-round multiplayer elimination minigame registered on the
shared Colyseus platform. Every player controls a bird on the same synchronized
course; tapping flaps. Birds that hit an obstacle are eliminated for the round;
the round win goes to the player(s) who cleared the most obstacles. The match
ends after five rounds with a tied final scoreboard kept intact.

## Registration and package layout

- Game package: `packages/flappy-race` (types, schemas, pure rules, server
  module).
- Client app: `apps/flappy-race-client` (Phaser 4 + DOM screens).
- Server registration: `apps/server/src/app.config.ts` registers
  `flappy_race` through `createFlappyRaceGame` + `FlappyRaceRoom`, serves the
  client at `/flappy-race/`, and exposes the game through the shared `/games`
  hub endpoint.
- Hub metadata and dev port (5177): `apps/hub-client/src/main.ts`.

The game implements `GameDefinition` from `@falling-platforms/platform-server`
and reuses the platform's room codes, lobby, host/ready rules, reconnection,
typed Zod commands, Colyseus schema synchronization, timers, `buildLeaderboard`
match results and the room lifecycle. It adds no second networking layer.

## Integration points

| Concern | Shared platform facility |
|---|---|
| Rooms, codes, join, host, start | `PlatformRoom` (`platform:start`, lobby rules) |
| Player identity + presence | `PlatformPlayerState` rows, session ids, connection status |
| Commands + validation | `game:command` wrapper + Zod `flappyRaceCommandSchema` |
| State sync | Colyseus Schema projection in `src/sync.ts` |
| Match results + play again | `context.finishMatch(buildLeaderboard(...))`, `platform:play-again` |
| Timers | `context.scheduleIn` (auto-cleared on dispose) |
| Reconnection | Platform grace period; dropped players spectate the rest of the match |
| Logging | Platform pino logger (no gameplay `console.log`) |

## Message flow

Client to server (`game:command`):

```ts
{ type: "flap", sequence: number, roundNumber: number }
```

The server rejects flaps outside countdown/running, from eliminated or
match-removed players, for old rounds, with stale/duplicate sequences, or above
the 20/s rate limit. Expected rejections emit a `flap-rejected` transient
message; with a `requestId` they also produce `platform:command-result`.

Server to client: the synchronized state (schema patches) carries the full
authoritative snapshot: phase, round number, countdown/result deadlines,
`roundStartedAt`, `courseElapsedMs`, `courseSeed`, `courseSpeed`, obstacle
openings, per-player colour/score/cleared count/alive flags/bird kinematics,
round winners and the final match result. Clients never send positions,
velocities, collisions, progress or scores.

## Authoritative simulation

- Fixed 30 ms simulation steps accumulated inside the platform's 50 ms
  `onTick`; catch-up is clamped to 250 ms.
- Bird physics: gravity, flap impulse, max fall speed, top/bottom clamping
  with velocity cancellation (no bounce, no boundary elimination).
- Obstacle positions are derived from `roundStartedAt` + `courseElapsedMs`,
  never mutated per packet.
- Collision is AABB against a bounded window of obstacles; progress
  increments exactly once per fully passed obstacle (obstacle right edge
  passed the bird's left edge).
- Round resolution (`src/resolution.ts`) is pure and table-tested: furthest
  cleared obstacles win; equal furthest progress draws; a sole survivor must
  exceed the highest eliminated progress; disconnected players are never
  eligible. Resolution is independent of packet/elimination ordering.
- Every round transition (countdown to running to result to next round) is
  server-timed and idempotent; a round can never award scores twice.

## Deterministic course generation

`generateOpenings(config, seed, count, e2eMode)` in `src/course.ts`:

- Normal mode: `seedrandom(seed)` produces a reproducible sequence of gap tops
  within `[upperMargin, worldHeight - gapSize - lowerMargin]`. Gap size,
  spacing, speed and safe-start distance are constants.
- E2E mode (server config `E2E_TEST_MODE=true`): fixed alternating openings
  (gap at the bottom on even obstacles, top on odd) so tests can force exact
  draws and a furthest-player win without cheat controls. E2E also shortens
  countdown/results and raises course speed.

## Running locally

```bash
pnpm dev:flappy-race        # server + hub + Flappy Race client (port 5177)
```

Open the hub at `http://localhost:5176/`, pick Flappy Race, or open
`http://localhost:5177/flappy-race/` directly.

## Tests

```bash
pnpm --filter @falling-platforms/flappy-race test
pnpm --filter @falling-platforms/server exec vitest run test/flappy-race.test.ts
pnpm exec playwright test -c apps/flappy-race-client/e2e/playwright.config.ts
```

Coverage: deterministic generation, physics/clamping, progress, table-driven
round resolution, rate limiting, full five-round server integration
(draw/furthest-victory/disconnect/rematch), and Playwright multi-phone E2E
(shared course, independent taps, elimination/spectating, tied scoreboards,
desktop + landscape viewports). The E2E suite also samples rendered pixels and
asserts the visible pillar/gap geometry matches the authoritative obstacle
geometry, so collision rendering cannot drift from the server rules again.

## Tuning gameplay

All simulation values live in `packages/flappy-race/src/constants.ts`
(`FLAPPY_RACE_CONFIG`). Change gravity, flap impulse, gap size, spacing,
speed, margins or durations there; the server, client and tests all consume
the same object. E2E timing overrides are the `e2e*` entries in the same file.
