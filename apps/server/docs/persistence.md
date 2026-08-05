# Future SQLite persistence

SQLite is the selected store for the platform's first real durable-data
requirement. It is not installed yet because the current product has no durable
facts: the production catalogue is code, anonymous identity is a signed cookie,
and active rooms and gameplay are intentionally ephemeral.

This document fixes the architectural direction without creating an empty
database, speculative schema, migration framework, repository layer, or unused
runtime dependency.

## What belongs in SQLite

Introduce SQLite when a requested feature creates a fact that must survive a
process restart, such as:

- registered accounts or durable player profiles;
- purchases, entitlements, or billing references;
- completed match summaries or leaderboards;
- moderation records or durable bans;
- game configuration that must be changed independently of a deployment.

The first feature must define the actual owner, retention policy, privacy needs,
and read/write paths before a table is designed.

## What stays in memory

Do not persist live simulation state merely because SQLite exists. These remain
owned by Colyseus and the running process unless a separate product requirement
proves otherwise:

- active rooms and room-code mappings;
- current players and connection/reconnection state;
- frame or tick state, positions, velocities, and collisions;
- countdowns, timers, transient scores, and in-progress actions;
- matchmaking reservations and WebSocket tokens.

Persist a completed match fact at a deliberate terminal boundary if match
history is required. Do not write every simulation update to the database.

## Introduction requirements

The change that adds the first durable feature must also add:

1. One server-owned database module and explicit configuration.
2. A reviewed migration from an empty database to the first schema.
3. Startup that applies or verifies committed migrations before serving traffic.
4. Foreign-key enforcement and an explicit journaling/busy-timeout policy.
5. Transaction boundaries for related facts that must agree after a crash.
6. Test setup that uses an isolated temporary or in-memory database and the real
   committed migration chain.
7. Shutdown cleanup for the database connection.
8. Backup, retention, and deployment-path documentation appropriate to the data.
9. Updated `.env.example`, Docker storage instructions, architecture docs, and
   scoped review checklist.

Choose the SQLite driver and optional query/schema library at that time, against
the concrete access patterns. The engine choice is settled; the adapter is not.
Do not assume that the libraries used by another repository are automatically
the right choice here.

## Schema rules

- Model durable facts, not projections or caches that can be reconstructed.
- Give durable records stable primary keys; never use array position as identity.
- Normalize repeated data when another record references it or it has its own
  lifecycle.
- Persist explicit order when order is semantically important; timestamps can
  tie and are not ordering keys.
- Make nullability reflect real lifecycle states and use checks for row-local
  invariants.
- Add foreign keys for every durable relation and choose cascade or restrict
  behavior deliberately.
- Scope uniqueness to the owning aggregate and enforce business invariants with
  database constraints where SQLite can express them locally.
- Keep cross-row and workflow-wide checks in transactional application logic
  when forcing them into SQL would duplicate ownership or add disproportionate
  complexity.
- Store machine-readable outcomes separately from display prose. Application
  logic must never recover a winner or status by parsing text.
- Persist only the minimum personal data required by the feature and document
  deletion behavior.
- Add format versions only when incompatible durable formats must coexist. Never
  change the meaning of an existing version.

## Transactions and failure behavior

Writes that establish one logical durable outcome must commit atomically. A
completed match and its winner, for example, cannot survive in contradictory
states after a crash.

Database failure must not silently become success. Decide per feature whether a
failed durable write prevents the user-visible outcome, can be retried, or is an
operationally visible secondary failure. Do not keep background writes running
after their owning room or request reports terminal completion.

SQLite will remain local to the one Node.js process. If a future multi-process
deployment is required, revisit storage and coordination as one architecture
change rather than treating a shared SQLite file as a distributed database.

## Testing expectations

- Tests never read or mutate a developer database.
- Apply the real migration chain to each isolated test database.
- Test migrations from the previous committed schema, not only clean creation.
- Verify foreign keys and integrity after migrations.
- Cover uniqueness, checks, ownership, transactions, rollback, and restart
  behavior at the database boundary.
- Keep higher-level room tests real: a database mock must not replace Hono,
  Colyseus, reservations, or WebSocket behavior.
