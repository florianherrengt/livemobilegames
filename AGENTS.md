# Agent instructions

pnpm workspaces monorepo for a phone-only multiplayer party-game platform. A
single Node.js process runs a Hono HTTP application and a Colyseus room server;
the browser client is React, Vite, MUI, and TanStack Query, with Storybook for
isolated UI states. The server is authoritative for every gameplay outcome.

This file contains cross-cutting orientation. Detailed rules live in scoped
documents and review checklists. Read only the documents relevant to the area
being changed.

## Layout and dependency direction

- `apps/server` -> `@phone-party/server`: Hono routes, anonymous identity,
  Colyseus rooms, the trusted game registry, and process lifecycle.
- `apps/web` -> `@phone-party/web`: React/MUI phone UI, TanStack Query HTTP
  state, Colyseus room connection, Storybook, and browser tests.
- `packages/protocol` -> `@phone-party/protocol`: browser-safe Zod contracts,
  inferred types, constants, and Colyseus schema state shared by server and web.
- `coolify`: local, credential-safe production configuration, deployment,
  monitoring, and verification helpers for the helium Coolify application.
- `docs`: cross-cutting architecture and game-authoring guidance.

Dependencies point inward through the protocol package:

```text
apps/web ──────> packages/protocol <────── apps/server
    │                                         │
    └── must not import server modules        └── owns authority and outcomes
```

Do not add a dependency from either application to the other.

## Commands

- `pnpm dev`: build the protocol package, then run server and web development
  processes together.
- `pnpm check`: canonical local quality gate; runs formatting checks, linting,
  type checking, all Vitest suites, and the production build.
- `pnpm test:unit`: protocol, server unit, and web component tests.
- `pnpm test:integration`: real Hono/Colyseus server integration tests.
- `pnpm test:e2e`: builds the repository, starts the production server, and runs
  Playwright against a mobile Chromium project.
- `pnpm storybook`: run Storybook on port 6006.
- `pnpm storybook:build`: build all isolated UI stories.

`pnpm check` does not run Storybook or Playwright. Run `pnpm storybook:build`
for theme, provider, Storybook configuration, or covered-component changes, and
run `pnpm test:e2e` for affected browser or full-stack flows. CI runs both after
the ordinary build.

Integration and E2E tests open real TCP and WebSocket listeners. They can fail
with `EPERM` in a restricted sandbox even when the code is correct; CI runs them
on an ordinary Linux host.

## Current product state

- The production catalogue explicitly registers Capital Pin, Coin Rush,
  Falling Platforms, Flappy Race, Golf Race, Kart Racing, Live Drawing &
  Guessing, Memory Path, and Four-Sided Pong. Test game definitions must never
  be registered in
  `production-games.ts` or exposed by the production API.
- Rooms start as platform lobbies. The host selects a registry-validated game
  and `start_game` moves the trusted roster into that game's locked Colyseus
  room. All nine games implement authoritative gameplay, results, and rematch
  or lobby-return behavior.
- Active rooms, room codes, memberships, and reconnection state are ephemeral.
  A process restart or deployment ends them. A lobby refresh can join again
  through the room URL; a running Capital Pin, Coin Rush, Falling Platforms,
  Flappy Race, Golf Race, Kart Racing, Memory Path, or Four-Sided Pong game is
  locked, so mid-game continuity relies on Colyseus reconnection within its
  grace window rather than page refresh. Live Drawing & Guessing unlocks during
  play so late joiners can spectate and join the next game.
- SQLite is the chosen future durable store, but the driver and schema remain
  deliberately undecided until the first durable fact is requested.
- Production runs commit `main` through Coolify on helium. Container port
  `3000`, host mapping `4478:3000`, `/api/health`, runtime-only
  `COOKIE_SECRET`, and generated proxy labels are validated by the helpers in
  `coolify/`; `coolify/README.md` is the operational runbook.

## Architectural invariants

- Simplicity first: build only what the current requirement needs and prefer the
  installed stack over custom replacements.
- Hono and Zod own untrusted HTTP boundaries. Colyseus owns rooms, matchmaking,
  WebSocket messages, and synchronized room state.
- The server owns game state, timing, scoring, collisions, eliminations, random
  seeds, and winners. Clients send intentions and render received state.
- Derive the acting player from the authenticated connection or signed anonymous
  session. Never trust a client-supplied player ID.
- Keep one Node.js process and in-memory live state until measured scale or a
  real durability requirement exists. SQLite is the selected future durable
  store, but no driver, schema, or empty database belongs in the repository yet.
  Redis, a queue, or a second service still require measured need.
- Prefer immutable values, pure functions, and explicit inputs and outputs.
  Local, encapsulated mutation is appropriate for Colyseus schema state,
  simulation loops, and a module-owned in-memory `Map`.
- TanStack Query owns HTTP snapshots, request errors, caching, and mutations.
  Colyseus owns live room state; never copy it into the query cache. React Router
  owns shareable URL state, React Hook Form owns form state, and local React
  state owns only ephemeral interface state.
- MUI is the application component and styling system. The application and
  Storybook use the same exported theme and provider stack. Do not add another
  UI framework, styling system, or general client-state store without a current
  requirement that the installed stack cannot satisfy.
- Do not introduce base game rooms, generic engine interfaces, plugin runtimes,
  repository classes, DI containers, or global client stores before concrete
  duplication makes them simpler than the direct implementation.

## Review checklists

The repository has living checklists for recurring mistakes. Read a checklist
only when the current work touches its scope:

- `gatekeep.md`: repository-wide configuration, shared behavior, dependency
  direction, or changes spanning workspaces.
- `apps/server/gatekeep.md`: HTTP, identity, rooms, matchmaking, authoritative
  simulation, future SQLite persistence, process lifecycle, or server tests.
- `apps/web/gatekeep.md`: React, MUI, TanStack Query, Storybook, browser
  networking, live room state, responsive UI, accessibility, or browser tests.
- `packages/protocol/gatekeep.md`: shared Zod contracts, constants, error codes,
  Colyseus schema state, or package exports.
- `docs/gatekeep.md`: checklist maintenance rules; read only when adding,
  removing, moving, or revising checklist entries.

Checklists supplement the scoped standards and executable `pnpm check` command;
they replace neither. Keep entries feature-independent and remove stale rules
when the architecture changes.

## Area documentation

- `docs/architecture.md`: process topology, authority, state ownership,
  dependency direction, and scaling boundaries.
- `docs/adding-a-game.md`: requirements and sequence for adding a real game.
- `docs/worktrees.md`: per-worktree ports, creation options, and lifecycle.
- `apps/server/docs/runtime.md`: build/runtime model, environment, shared HTTP
  server, routing, static assets, and shutdown.
- `apps/server/docs/standards.md`: Hono, Zod, identity, Colyseus, state,
  errors, logging, and dependency rules.
- `apps/server/docs/testing.md`: server test layers and real-socket fixtures.
- `apps/server/docs/persistence.md`: why SQLite is selected for future durable
  facts, what must remain in memory, and the rules for introducing it.
- `apps/server/src/rooms/docs/room-lifecycle.md`: current room HTTP, reservation,
  lobby, reconnection, host transfer, and cleanup contract.
- `apps/web/docs/standards.md`: React, MUI, TanStack Query, Storybook, state
  ownership, HTTP and Colyseus boundaries, accessibility, and testing.
- `packages/protocol/docs/standards.md`: rules for shared schemas, types,
  state, and exports.
- `coolify/README.md`: production identifiers, required Coolify settings,
  deployment workflow, health verification, troubleshooting, and the current
  Cloudflare tunnel boundary.

## Workflow and definition of done

Before changing code, inspect the implementation and tests, read the relevant
scoped documents, and confirm the change fits the current architecture.

After implementation:

1. Run formatting.
2. Run linting.
3. Run type checking.
4. Run targeted unit and integration tests.
5. Build Storybook when its providers, theme, configuration, stories, or covered
   components changed.
6. Run E2E tests when the changed flow is covered.
7. Review the complete change for unnecessary complexity and stale artifacts.
8. Update documentation when behavior or architecture changes.

A task is complete only when behavior works, untrusted inputs are validated,
server authority is preserved, errors are explicit and safe, resources are
cleaned up, important behavior is tested, checks pass, no placeholders or dead
code remain, Storybook represents meaningful reusable UI states, and
documentation matches the implementation. Do not claim a check passed unless it
was run.
