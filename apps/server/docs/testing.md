# Server testing

The server uses Vitest. Test files use the `.test.ts` suffix and live under
`apps/server/tests`.

## Commands

From the repository root:

```sh
pnpm --filter @phone-party/server test
pnpm --filter @phone-party/server test:unit
pnpm --filter @phone-party/server test:integration
```

The root commands build `@phone-party/protocol` first:

```sh
pnpm test:unit
pnpm test:integration
```

`vitest.config.ts` disables file-level parallelism because Colyseus uses shared
process-level matchmaking state. Do not enable parallel test files without
first isolating that state and proving cleanup is reliable.

## Unit and Hono application tests

Unit suites cover room-code generation, configuration, the immutable game
registry, the room directory, anonymous sessions, and every game's pure engine,
simulation, scoring, and input boundaries. `app.test.ts` calls the Hono
application directly with a stubbed room service so route validation,
middleware, independent player/address rate limits, headers, error mapping, and
safe responses can be tested without a listening socket.

Prefer explicit test configuration through `loadConfig({...})` or
`createTestConfig()`. Tests must not depend on or mutate the developer's root
`.env`.

## Room integration tests

`tests/helpers/test-platform.ts` creates the same platform composition used in
production and boots it through `@colyseus/testing`. These tests exercise:

- a real Node HTTP listener;
- Hono room endpoints and signed cookies;
- Colyseus matchmaking and seat reservations;
- the configured WebSocket path;
- room state synchronization and client messages;
- room disposal and directory cleanup.

`tests/fixtures/test-game-room.ts` is a test-only registered game. It must never
be added to the production game list or appear in the production catalogue.

The integration command includes `tests/rooms.test.ts` and every
`tests/games/*/room.test.ts` file. This is intentional: a game-room suite must
not disappear from CI merely because its filename lives below `tests/games`.

Always stop the test platform in `afterEach`, even after failures. Await state
changes with a bounded condition helper; do not add arbitrary sleeps.

`@colyseus/testing`'s default port is hardcoded to 2568. The helper listens
directly and defaults to an OS-assigned port, and accepts a `TEST_SERVER_PORT`
environment override to pin a specific port, so multiple worktrees on one
machine can run integration suites without colliding.

Some execution sandboxes reject all local listeners with `EPERM`. That is an
environment limitation, not a reason to mock away the HTTP/WebSocket integration
path. Run the suite on a normal developer machine or in CI.

## What to test

- Parse response bodies with shared protocol schemas where a contract exists.
- Assert stable error codes and statuses, not exact incidental framework text.
- Test malformed JSON, missing fields, boundary values, and unknown fields at
  each new HTTP boundary.
- Test invalid room options and malformed message payloads at each new Colyseus
  boundary.
- Attempt to forge player identity, privilege, score, or outcomes for every new
  player action.
- Test rollback and cleanup after failures, leave, room disposal, and shutdown.
- Test host or ownership transfer and reconnect behavior when touched.
- Avoid mocking internal helpers or room methods when the real composition can
  provide a focused assertion.

## End-to-end coverage

Playwright lives in `apps/web/e2e` but starts the compiled production server.
Every production game has a multi-context spec that creates a platform lobby,
joins independent phones, starts through the real lobby-to-game reservation
handoff, plays the complete documented match, asserts its final result, and
starts a rematch. The flows also cover real socket loss/reconnection and
game-specific late-join or disconnect behavior. Run `pnpm test:e2e` when a
covered server flow changes.

SQLite is not part of the current test setup. When the first durable feature is
added, tests must use an isolated database and the real migration chain as
defined in [persistence.md](persistence.md).
