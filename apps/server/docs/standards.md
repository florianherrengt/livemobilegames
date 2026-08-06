# Server coding standards

These standards describe the current Hono and Colyseus architecture. They apply
to new server code and to related code being changed; they do not require an
unrelated repository-wide rewrite.

The terms **MUST**, **SHOULD**, and **MAY** are normative. MUST identifies an
invariant, SHOULD identifies the default that needs a concrete reason to vary,
and MAY identifies an allowed choice.

## 1. Authority and scope

- The server MUST determine every gameplay outcome, including accepted actions,
  timing, positions, collisions, damage, scoring, elimination, random seeds,
  round transitions, and winners.
- A client message MUST represent intent only. It MUST NOT be accepted as proof
  of player identity or an outcome.
- Current requirements and the single-process architecture take priority over
  speculative scale, persistence, or reuse. SQLite is reserved for the first
  concrete durable feature, not installed pre-emptively.
- Existing code outside the requested change MUST NOT be reorganized merely to
  match a preferred directory pattern.

## 2. Approved stack and dependencies

The server stack is Node.js, strict TypeScript, Hono, Zod, Colyseus, Pino,
`rate-limiter-flexible`, Vitest, and `@colyseus/testing`.

- Hono MUST own ordinary HTTP middleware, routing, validation integration, and
  responses.
- Colyseus MUST own matchmaking, room lifecycle, WebSocket messages, and
  synchronized game state.
- Zod MUST parse values at untrusted boundaries.
- Pino MUST remain the structured application logger; request and error data
  MUST be logged as fields rather than interpolated prose.
- A new dependency MUST solve a current problem better than the installed stack
  or a small direct implementation. Document the reason when it establishes a
  durable pattern.
- Server modules MAY import `@phone-party/protocol`; they MUST NOT import browser
  modules from `apps/web`.

## 3. Validation and contracts

Validate once when data crosses a trust boundary, then pass parsed typed values
through trusted internal functions.

Zod validation is required for:

- HTTP bodies, route parameters, and query values;
- environment variables;
- signed-cookie payloads;
- Colyseus room-creation and seat options;
- every client-to-room message payload;
- third-party responses if external services are added.

Use `zValidator` for Hono request values and read them through
`c.req.valid(...)`. Validation failures use the stable `INVALID_REQUEST` error
shape and normalized `{ path, message }` details.

Shared wire shapes belong in `@phone-party/protocol`. Server-only composition
inputs and internal domain values SHOULD use ordinary TypeScript types. Do not
wrap trusted internal functions or objects in Zod solely to repeat compile-time
types.

Zod objects currently strip unknown keys by default. This is a defense in depth
measure, not identity enforcement: authoritative identity still comes from the
signed session or Colyseus connection.

## 4. HTTP and identity

- Public application routes MUST live below `/api`.
- Route modules SHOULD expose a focused app or registration function and receive
  their dependencies explicitly.
- Route handlers SHOULD validate and translate HTTP concerns, then delegate
  room or domain work to a service.
- Request bodies are limited. New large-body routes require an explicit limit
  and a documented reason.
- Routes that mutate player-owned state MUST run after the anonymous-session
  middleware or a future stronger authentication boundary.
- The acting `playerId` MUST come from `c.get("playerId")`; request bodies,
  query strings, and route parameters MUST NOT supply it.
- Signed-cookie values MUST be treated as untrusted until their signature and
  schema are valid. Missing or invalid anonymous identity is replaced with a
  server-generated UUID.
- Do not trust forwarding headers for security decisions unless a documented,
  configured proxy boundary is introduced.

HTTP errors use `AppError` with a protocol `ErrorCode`. Expected errors are
specific and safe. Unexpected errors are logged with request context and become
the generic `INTERNAL_ERROR`; stack traces and internal messages MUST NOT reach
clients.

## 5. Colyseus rooms and messages

- Room creation and seat reservations MUST be initiated with trusted options
  assembled by the server.
- `onCreate`, `onJoin`, and every `onMessage` handler MUST parse unknown options
  or payloads before using them.
- The acting room player MUST be derived from the `Client` or its `sessionId`.
  Never accept a player or session ID inside an action payload.
- Membership, host privileges, readiness, and game phase MUST be checked on the
  server before applying an action.
- Invalid messages MUST fail explicitly without partially mutating state.
- Colyseus `Schema`, `MapSchema`, and other synchronized state are intentionally
  mutable. Keep mutation inside the owning room or engine and make multi-field
  transitions deliberate.
- State exposed through a Colyseus schema is public to room clients. Secrets,
  signed values, server-only options, and hidden authoritative data MUST stay
  outside synchronized state.
- A game room created from a platform lobby MUST reject direct matchmaking
  creation unless the room options carry a server-issued capability token, so
  untrusted callers cannot forge rosters, host flags, or test-mode timing.

A game's deterministic rules SHOULD be pure or isolated from networking when
that materially improves testing. Do not create a generic engine or base-room
abstraction before multiple games demonstrate the same responsibility.

## 6. State ownership, concurrency, and cleanup

- The game registry is immutable after startup and is the only trusted list of
  installed games.
- `RoomDirectory` owns the only room-code map. Callers receive copies and MUST
  NOT retain a second mutable index.
- A room's Colyseus state is authoritative for its live players, host, selected
  game, and gameplay state.
- Derived values SHOULD be computed from authoritative state instead of copied
  into parallel mutable fields.
- Cryptographic identity, codes, tokens, and security-sensitive seeds MUST use
  `node:crypto`. `Math.random` is not acceptable for those values.
- Work that reserves a code or creates a room MUST roll back its partial state
  when a later step fails.
- Every mapping, room, timer, listener, and asynchronous loop needs an ownership
  boundary and cleanup path for leave, dispose, failure, and process shutdown.
- Concurrent actions MUST be safe under the owning room's event order. If future
  work escapes that model, document and test the ordering guarantee rather than
  assuming it.

## 7. Errors, logging, and operational behavior

- Use stable machine-readable protocol error codes. Human messages MAY improve
  without forcing clients to parse them.
- Map third-party or framework failures deliberately. Do not expose raw errors
  or silently convert distinct recoverable conditions into success.
- Logs MUST include useful structured context such as request ID, room ID, game
  ID, player/session ID when appropriate, status, and duration.
- Secrets, signed cookies, seat reservations, reconnection tokens, and sensitive
  user content MUST NOT be logged.
- Expected client errors SHOULD NOT be logged as unhandled server failures.
- Health checks MUST remain cheap and independent of browser assets.

## 8. TypeScript and structure

- TypeScript MUST remain strict. Use `unknown` at trust boundaries; `any` is not
  an escape hatch.
- Use type-only imports when an import has no runtime role.
- Preserve `.js` import specifiers under the NodeNext build model.
- Export types only when they form an actual module boundary.
- Use readonly types by default. Mutable collections SHOULD be private to the
  module or object that enforces their invariants.
- Prefer `const`, immutable values, and pure functions; module-level mutable
  state requires a documented single owner.
- Comments SHOULD explain framework constraints, security boundaries, cleanup,
  and deliberate omissions that a future refactor might otherwise undo.

## 9. Testing

- Unit tests SHOULD cover schemas, pure rules, code generation, registry
  validation, and isolated in-memory state owners.
- Hono tests SHOULD cover status, parsed response shapes, stable error codes,
  malformed input, unknown keys, body limits where relevant, and non-disclosure
  of internal errors.
- Room integration tests SHOULD use the real Colyseus server, matchmaking,
  reservation consumption, WebSocket state, and cleanup.
- Authority tests MUST attempt forged identities or outcomes when a new message
  or action could otherwise trust them.
- A bug fix SHOULD add a regression test at the lowest layer that reproduces the
  behavior without hiding the real boundary.

See [testing.md](testing.md) for commands and fixtures.

## 10. Prohibited patterns and exceptions

The following patterns are prohibited unless a narrow documented exception
shows why the current architecture cannot meet the requirement:

- trusting client identity or gameplay outcomes;
- direct environment reads scattered through feature modules;
- a second HTTP process, CORS layer, Redis, queue, external matchmaker,
  microservice, or game worker without a demonstrated current need;
- an SQLite driver, schema, migration layer, or repository with no durable fact
  to store;
- duplicate room directories or client-maintained authoritative state;
- generic base rooms, plugin runtimes, repositories, or DI containers created
  for hypothetical consumers;
- swallowed failures, fake success, or raw internal error responses.

A MUST rule may be broken only by a narrow, recorded exception that preserves
its underlying invariant where possible. A durable new pattern requires an
update to these standards and the server gatekeep checklist.
