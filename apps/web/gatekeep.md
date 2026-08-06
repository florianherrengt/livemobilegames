# Web gatekeep checklist

Use this checklist for recurring React, MUI, TanStack Query, HTTP, Colyseus,
Storybook, mobile UI, accessibility, and browser-test mistakes.

- Read `docs/standards.md` and the relevant server room or protocol contract
  before changing a cross-boundary flow.
- Use the installed React, MUI, Router, TanStack Query, React Hook Form, Zod,
  Colyseus SDK, and Storybook stack; do not add overlapping state, UI, or styling
  systems without a demonstrated current need.
- Keep one exported MUI theme shared by the application, Storybook, and tests
  that need explicit theme context; use theme values and `sx` before custom CSS.
- Prefer MUI interaction primitives and preserve their semantics, focus, and
  keyboard behavior; do not depend on generated class names.
- TanStack Query owns HTTP snapshots, pending/error state, caching, and mutation
  lifecycles. Do not copy its results into local state.
- Keep HTTP calls, URL construction, response parsing, and error translation in
  the network boundary rather than scattered through visual components.
- Parse every HTTP response from `unknown`, encode path identifiers, and pass
  Query's `AbortSignal` to cancellable reads.
- Keep the room code in the URL, the live connection in its scoped provider,
  and synchronized lobby/game facts in Colyseus state; never put live room state
  in the Query cache.
- Consume only server-issued seat reservations and send intent-only room
  messages without player identity or claimed outcomes.
- Intentional leave, replacement, and unmount release the current room;
  unexpected leave reconnects only when a token exists.
- Successful reconnect reattaches all listeners; failed reconnect clears stale
  room state and presents an honest recoverable UI.
- Effects reject stale async updates and clean up subscriptions, timers,
  connections, and generated resources.
- Forms preserve useful input after errors, show field and mutation errors in
  the right place, and prevent duplicate pending submissions.
- Every async boundary renders its reachable loading, empty, error, success,
  reconnecting, and disconnected states.
- Screens remain usable at 320 CSS pixels without page-level horizontal scroll;
  touch targets, wrapping, focus, contrast, and reduced motion remain usable.
- Every game introduces its rules and controls with a brief how-to that
  auto-dismisses when play begins.
- Audio and haptic feedback is subtle, initialized from a user gesture, and
  never the only signal for an important state.
- Controls have accessible names and semantics, inputs have visible labels,
  color is not the only signal, and important dynamic state is announced.
- Stories use the shared provider stack, avoid real network calls, and cover
  meaningful loading, error, empty, ready, long-content, and responsive states.
- Interactive map/canvas game surfaces must hide answer-revealing layers (text
  labels and POIs) and keep pan/zoom bounded so the visualization cannot leak
  hidden game state.
- Component tests use isolated Query clients and accessible queries; E2E uses
  the built app and real server with separate browser contexts per player.
- Run `pnpm storybook:build` for theme, provider, config, or covered-component
  changes, plus `pnpm test:e2e` for affected full-stack browser flows.
