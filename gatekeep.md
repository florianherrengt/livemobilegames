# Repository gatekeep checklist

Use this checklist for cross-cutting mistakes and invariants. Keep server-only,
web-only, and protocol-only checks in their scoped files.

- Read the root instructions and every relevant scoped document before changing
  code.
- Keep changes within the requested scope and preserve unrelated or in-progress
  user work and generated artifacts.
- Keep the dependency direction `apps/* -> packages/protocol`; the applications
  never import each other.
- Change a shared contract in `@phone-party/protocol` and update every producer,
  consumer, and boundary test in the same change.
- Keep the server authoritative. A browser message may express intent but never
  establishes identity, score, collisions, elimination, timing, or winners.
- Keep live rooms and simulations in the single process. Introduce the selected
  future SQLite store only with the first concrete durable fact and migration;
  other infrastructure still requires measured need.
- New dependencies, state, and abstractions remove more complexity than they
  add. Do not introduce an overlapping library or speculative extension point.
- Prefer `const`, immutable values, and pure functions; module-level mutable
  state requires a documented single owner.
- Data derived from one authoritative source is not copied into another mutable
  source of truth.
- Untrusted HTTP, WebSocket, environment, cookie, and third-party values are
  parsed before domain code consumes them.
- Keep container listen ports, published mappings, health-check targets, and
  proxy upstreams aligned. Inject secrets only at runtime, never as image build
  arguments.
- Error responses use stable codes, expose safe messages, and never include
  stack traces, secrets, or provider internals.
- Identity, codes, tokens, and security-sensitive seeds use `node:crypto`, not
  `Math.random`.
- Every created room, listener, timer, connection, reservation placeholder, and
  in-memory mapping has a deliberate cleanup path.
- TanStack Query owns HTTP server state and mutation lifecycles, Colyseus owns
  live room state, and the URL or local React state owns only its narrow scope.
- The application and Storybook use the same exported MUI theme and provider
  stack; new reusable UI states receive representative stories.
- Comments record non-obvious constraints and deliberate omissions rather than
  narrating the code.
- Documentation describes current behavior and explicit current limitations,
  not speculative features presented as implemented.
- Run `pnpm check` after executable changes and `pnpm test:e2e` when a covered
  browser or full-stack flow changes.
