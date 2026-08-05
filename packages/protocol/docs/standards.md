# Shared protocol standards

`@phone-party/protocol` is the browser-safe contract package shared by the
server and web workspaces. It contains runtime Zod schemas, inferred TypeScript
types, stable constants and error codes, and Colyseus schema state. It contains
no application orchestration and depends on neither application.

The terms **MUST**, **SHOULD**, and **MAY** are normative. MUST identifies an
invariant, SHOULD identifies the default that needs a concrete reason to vary,
and MAY identifies an allowed choice.

## 1. Package boundary

- The package MUST remain safe to execute in both Node.js and modern browsers.
- It MUST NOT import from `apps/server` or `apps/web`.
- It MUST NOT read environment variables, open network connections, access the
  filesystem, own mutable process state, or perform application startup.
- Shared code belongs here only when it defines an actual wire, synchronized
  state, or cross-workspace semantic contract. Do not turn the package into a
  generic utilities collection.
- Server-only options, internal services, and browser-only view models belong in
  their owning application even when their TypeScript shape looks reusable.

## 2. Zod schemas and inferred types

- Zod schemas are the runtime source of truth for JSON request, response, error,
  cookie-value, room-option, seat-option, and client-message shapes.
- Export a TypeScript type with `z.infer` when consumers need the parsed shape.
  Do not hand-maintain a duplicate interface.
- Schemas SHOULD normalize only contract-level semantics shared by every
  consumer, such as room-code casing. UI-only presentation transforms and
  server-only authority checks do not belong here.
- String values SHOULD define trimming, empty-value, length, format, and allowed
  character behavior explicitly.
- Numeric values SHOULD define integer, range, and sign constraints explicitly.
- Related-field invariants SHOULD use a refinement with a useful issue path.
- Treat objects as stripping unknown keys unless strict rejection is an explicit
  compatibility or security requirement. Consumers MUST NOT rely on stripped
  client fields for identity or authorization.
- Use `z.custom` only when a third-party type cannot be represented faithfully
  with ordinary Zod schemas. Back it with real structural validation and a test.

## 3. Error contract

- Add every public HTTP error code to `ERROR_CODES`; `ErrorCode` and
  `errorCodeSchema` derive from that single list.
- Codes MUST be stable, uppercase machine identifiers with a clear semantic
  meaning. Clients branch on codes, never message text.
- Use a new code only when callers can distinguish or act on the condition. Do
  not create one code per incidental internal failure.
- Error messages are safe user-facing text. Optional details MUST contain only
  intentionally public structured data.
- A contract change MUST update server production, web consumption, tests, and
  relevant documentation together.

## 4. Colyseus synchronized state

- Colyseus state classes define data visible to every room client. Never include
  secrets, signed-cookie values, seat reservations, reconnection tokens, or
  hidden game information.
- Every synchronized field MUST have a Colyseus `@type` decorator and a stable
  initialized value compatible with serialization.
- Use `MapSchema` when records need stable keys and incremental synchronization;
  use the connected session ID for live membership when that is the real room
  identity.
- State classes are intentionally mutable because Colyseus observes mutation.
  Mutation policy and authority stay in the server room or engine, not in this
  package.
- Methods that enforce game rules, access services, or perform side effects MUST
  NOT be added to shared state classes.
- Schema changes MUST account for active server/client compatibility. The
  current deployment builds and ships server and web together, so no versioning
  layer is needed until incompatible versions must coexist.

## 5. Constants, helpers, and exports

- Stable wire constants such as room-code length and alphabet MAY live beside
  their schema.
- A helper belongs here when both applications must apply exactly the same
  deterministic contract behavior. Keep it pure and test it directly.
- `src/index.ts` is the public surface. Export each supported module there and do
  not ask consumers to import internal package paths.
- Preserve `.js` relative import specifiers for the compiled ESM package.
- Public exports SHOULD be minimal. Removing or renaming an export requires
  updating every consumer in the same change.

## 6. Testing and change workflow

Protocol tests SHOULD cover:

- valid examples for every public schema;
- empty, malformed, boundary, and related-field invalid cases;
- normalization and unknown-key behavior when consumers rely on it;
- stable error-code parsing;
- Colyseus schema initialization and serialization-sensitive shape;
- custom third-party validators with representative valid and invalid values.

After a protocol change, build the package before typechecking or testing its
consumers. Root `pnpm typecheck`, `pnpm test`, and `pnpm check` do this
automatically.

Do not add a format version merely because a schema changed. Version only when
incompatible wire or persisted formats must coexist, and never change the
meaning of an existing version.
