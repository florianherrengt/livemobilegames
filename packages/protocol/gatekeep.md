# Protocol gatekeep checklist

Use this checklist for shared Zod contracts, error codes, constants, Colyseus
schema state, and package exports.

- Keep the package browser-safe, side-effect free, and independent of both
  applications.
- Add only real cross-workspace or wire contracts; leave server internals and
  web view models with their owners.
- Derive public TypeScript shapes from Zod rather than duplicating schema and
  interface definitions.
- Define trimming, emptiness, length, format, number bounds, and related-field
  invariants explicitly where they matter.
- Use `z.custom` only for a third-party type that ordinary schemas cannot model,
  and validate its actual structure.
- Treat unknown-key stripping as normalization, never as identity or authority
  enforcement.
- Keep error codes stable and machine-readable; clients never parse error
  message prose.
- Keep secrets, reservations, reconnection tokens, hidden game state, and
  authority logic out of synchronized Colyseus state classes.
- Decorate and initialize every synchronized field; keep state mutation in the
  authoritative server owner.
- Export supported modules through `src/index.ts` and preserve compiled ESM
  `.js` specifiers.
- Update every server producer, web consumer, boundary test, and relevant
  document in the same contract change.
- Build the protocol before checking consumers and run focused valid, malformed,
  boundary, and serialization tests.
