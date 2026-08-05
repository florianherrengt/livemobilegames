# Gatekeep checklist maintenance

The gatekeep files are living, feature-independent review checklists for
recurring mistakes and durable engineering decisions. They supplement
`AGENTS.md`, scoped technical documentation, and executable checks; they do not
replace them.

- [`../gatekeep.md`](../gatekeep.md) contains repository-wide and cross-workspace
  checks.
- [`../apps/server/gatekeep.md`](../apps/server/gatekeep.md) contains HTTP,
  identity, Colyseus, gameplay authority, future SQLite persistence, lifecycle,
  and server-test checks.
- [`../apps/web/gatekeep.md`](../apps/web/gatekeep.md) contains React, MUI,
  TanStack Query, Storybook, browser networking, room-connection, responsive UI,
  accessibility, and browser-test checks.
- [`../packages/protocol/gatekeep.md`](../packages/protocol/gatekeep.md) contains
  shared schema, error, state, and export checks.

When updating these files:

- Read only the checklist files whose scopes are changing. Read the root
  checklist for cross-cutting entries.
- Inspect the current task, review findings, failed checks, and complete change
  for mistakes likely to recur.
- Generalize the lesson before adding it. Do not record feature names, fixed
  product values, temporary paths, one-off typos, or implementation details with
  no future review value.
- Put each rule in the narrowest applicable checklist and avoid duplicating it.
  Add companion rules in multiple scopes only when the layers have distinct
  responsibilities.
- Write concise assertions or imperatives. Include a reason only when a future
  maintainer might otherwise reverse a deliberate decision.
- Update or remove stale entries as requirements and architecture change. A
  checklist that preserves an obsolete rule is a defect.
- Keep each file short enough to use during every relevant review. Merge
  overlapping entries instead of accumulating variants.
- Review all changed checklists together for contradictions. Run `pnpm check`
  whenever code or executable configuration also changed.
