# Server gatekeep checklist

Use this checklist for recurring Hono, identity, Colyseus, authoritative game,
future SQLite persistence, process lifecycle, and server-test mistakes.

- Read `docs/runtime.md`, `docs/standards.md`, `docs/testing.md`,
  `docs/persistence.md`, and the relevant feature contract before changing their
  areas.
- Keep all application HTTP routes under `/api`; missing API, asset, and
  Colyseus paths never fall through to SPA HTML.
- Validate bodies, parameters, queries, environment values, cookies, room and
  seat options, and client message payloads with Zod at entry.
- Derive HTTP identity from the signed session and room actions from the
  connected Colyseus client. Ignore or reject client-supplied identity.
- The server validates phase, membership, host privileges, and action legality
  before mutating authoritative state.
- Clients never choose accepted positions, hits, scores, eliminations, seeds,
  timers, or winners.
- Expected failures use stable protocol error codes and safe messages;
  unexpected failures are logged and never exposed verbatim.
- The room-code reservation is removed when creation fails, a room disappears,
  or the room is disposed.
- Every new room, timer, listener, connection, and loop has leave, dispose,
  failure, and shutdown cleanup where applicable.
- Shared live state has one owner: registry data is immutable, the directory
  owns code mappings, and the room owns synchronized state.
- New games cannot collide with the reserved lobby room type or another game ID
  or room type.
- A game room that receives its roster through reservations must lock after
  those reservations are issued so late joins are rejected without deleting the
  still-live code mapping.
- Game rooms must reject direct matchmaking creation unless the options carry a
  server-issued capability token known only to the platform lobby.
- Unconsumed Colyseus seat reservations delay room disposal; keep the
  reservation window bounded when an aborted transition must clean up quickly.
- Server tests use explicit configuration, keep the test game out of production,
  and close every real HTTP/WebSocket server.
- Authority and failure tests cover forged input, invalid transitions, partial
  setup rollback, resource cleanup, and safe exact error codes.
- Preserve the compiled ESM model and `.js` import specifiers.
- Add SQLite only with the first durable fact, a real migration, isolated tests,
  transaction boundaries, and lifecycle documentation; live simulation remains
  in memory.
