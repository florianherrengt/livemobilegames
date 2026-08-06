# Web frontend standards

These standards define how the phone UI is designed and implemented. They
describe the current architecture and apply to new code and related code being
changed; they do not require an unrelated repository-wide migration.

The terms **MUST**, **SHOULD**, and **MAY** are normative. MUST identifies an
invariant, SHOULD identifies the default that needs a concrete reason to vary,
and MAY identifies an allowed choice.

## 1. Authority and scope

- The browser MUST treat server HTTP responses and Colyseus room state as
  authoritative. It sends intentions and never decides gameplay outcomes.
- UI validation improves feedback but MUST NOT be treated as authorization or
  domain enforcement.
- Current product requirements and the installed stack take priority over
  speculative reuse or scale.
- Existing code outside the requested change MUST NOT be reorganized only to
  conform to a preferred directory shape.
- Feature behavior belongs in feature documentation; this file defines durable
  frontend policy.

## 2. Approved stack and dependencies

The web stack is React 19, strict TypeScript, MUI 9 with Emotion, React Router,
TanStack Query 5, React Hook Form, Zod, the Colyseus SDK, Vitest, React Testing
Library, Playwright, and Storybook 10.

MapLibre GL is the interactive world-map renderer for Capital Pin. It is the
one installed dependency MUI cannot replace (a geographic pin game needs a real
map surface); feature code consumes it through the shared `config.ts` style URL
and keeps answer-revealing layers hidden.

- MUI MUST remain the component and styling system. Do not add Tailwind, another
  component library, a parallel design-system framework, or application-level
  Emotion styling.
- Direct application imports from `@emotion/react` and `@emotion/styled` MUST
  NOT be used. They remain implementation dependencies required by MUI.
- TanStack Query MUST own HTTP snapshots, request loading and error state,
  caching, background refresh, and mutation lifecycles.
- React Router MUST own routing and navigational URL state.
- `@phone-party/protocol` and Zod MUST validate HTTP data at the browser boundary.
- The Colyseus SDK MUST own matchmaking-reservation consumption, WebSocket room
  connections, synchronized state, and reconnection.
- React Hook Form SHOULD own forms whose validation or submission lifecycle is
  nontrivial. A small isolated form MAY use controlled React state.
- A general client-state library such as Redux, Zustand, or Jotai MUST NOT be
  added until real application-wide client state exists and URL state, local
  state, Query, or a narrowly scoped context cannot own it cleanly.
- A new dependency MUST solve a current problem better than the installed stack
  or a small direct implementation. Consider browser weight, mobile performance,
  accessibility, type quality, and overlap.
- Web modules MAY import `@phone-party/protocol`; they MUST NOT import modules
  from `apps/server`.

## 3. Project structure

- `routes/` contains route-level screen coordination and URL handling.
- `components/` contains independently meaningful UI pieces, forms, and their
  colocated Storybook stories.
- `queries/` contains TanStack Query keys, queries, and mutations grouped by
  server resource or workflow.
- `api.ts` owns HTTP URLs, request serialization, response parsing, and error
  translation.
- `game-connection.tsx` owns the one active Colyseus client/room lifecycle.
- `multiplayer.ts` owns construction and path configuration of the Colyseus SDK.
- `theme.ts` owns the one application MUI theme.
- `config.ts` owns parsed `VITE_*` environment values; runtime code never reads
  `import.meta.env` directly.
- Vite and Playwright configs and the Storybook dev launcher may read
  `process.env` for build/dev/test ports only; this is a narrow tooling
  exception, not a pattern for feature modules.
- `app-providers.tsx` owns the shared Theme, CssBaseline, Query, and room
  connection providers used by the application and Storybook.
- `tests/` contains component behavior tests; `e2e/` contains production-stack
  browser flows; `.storybook/` contains global story configuration only.

Keep feature-specific code near its route or component until multiple consumers
demonstrate a shared responsibility. Do not create generic root `utils`, `hooks`,
`models`, or `schemas` directories pre-emptively.

A route MAY coordinate URL values, queries, mutations, connection state,
navigation, and screen-level state. A visual child SHOULD receive the smallest
stable interface it needs and emit events upward. Components SHOULD be small
enough to understand as a unit but MUST NOT be split into fragments with no
independent responsibility.

## 4. MUI theme, components, and styling

`theme.ts` exports the single application theme. `AppProviders` supplies that
theme and `CssBaseline`; Storybook uses the same provider rather than recreating
visual defaults.

Use this styling order:

1. Theme palette, typography, shape, spacing, breakpoint, and transition values
   for global design decisions.
2. `theme.components` for application-wide MUI defaults and visual overrides.
3. `sx` for local component and responsive layout.
4. MUI `styled()` only for a genuinely reusable styled element whose styles are
   unwieldy in `sx`.
5. A CSS file only for work poorly expressed by MUI, such as a complex animation
   or visualization.

- Existing MUI primitives MUST be preferred for buttons, links, fields, alerts,
  lists, cards, surfaces, progress, and other standard interactions.
- A wrapper around a MUI primitive SHOULD exist only when it provides stable
  product semantics, not merely to rename props or restyle one use.
- Semantic theme values MUST be used when they express the intended color,
  surface, typography, radius, breakpoint, or state.
- Literal values MAY be used for real geometry such as QR size, touch target
  minimums, media dimensions, or grid thresholds.
- MUI 9 layout system values such as alignment and wrapping belong in `sx`, not
  as unsupported shorthand props.
- Avoid deeply nested selectors, `!important`, and unexplained mixtures of
  inline style, CSS, Emotion, and `sx`.
- Responsive `sx` and theme breakpoints SHOULD replace JavaScript viewport
  checks.
- Screens with competing actions SHOULD establish one obvious primary action.
- Typography, spacing, and layout SHOULD establish hierarchy before decorative
  borders, surfaces, or color.
- Product copy SHOULD use sentence case and clear verb-based action labels.
- Status presentation MUST combine text or accessible naming with color or icon
  treatment.
- Motion MUST communicate state and respect reduced-motion preferences.
- Games MUST show a brief rules-and-controls message during the initial
  countdown (or opening seconds) and auto-dismiss it without user action.
- Audio and haptic feedback MUST be subtle and optional, SHOULD initialize from
  a user gesture, and MUST never be the only signal for an important state.

## 5. React behavior and state ownership

Use the narrowest owner that preserves the required behavior:

- The URL owns shareable navigation state, currently the room code.
- TanStack Query owns HTTP catalogue data and create/join mutation lifecycles.
- `RoomConnectionProvider` owns the single live browser connection and its
  reconnecting status.
- The Colyseus room owns synchronized lobby and game state. Components
  MUST derive views from `room.state` rather than copy it into Query or React
  state.
- Local React state owns ephemeral interface state such as temporary clipboard
  feedback or a controlled field in a genuinely small form.
- React Hook Form owns unsubmitted form values, client validation, and field
  errors.

HTTP server state MUST NOT be copied from Query into React state. Colyseus state
MUST NOT be copied into the query cache. These are different transports with
different lifecycle and authority models.

Derived values MUST be computed from their source instead of copied into state
and synchronized with an effect. Effects MUST synchronize React with an external
system such as a room subscription, timer, QR generation, or browser API. Every
effect must prevent stale updates and clean up listeners, connections, timers,
or other resources it owns.

Prefer composition over components with many mode flags. Domain transitions,
game rules, and complex projections SHOULD live in pure functions outside JSX.
Performance work SHOULD follow measurement; do not add memoization,
virtualization, or deferred loading without evidence of a real mobile cost.

## 6. TanStack Query and HTTP boundaries

`createAppQueryClient()` defines shared defaults: queries may retry once and are
fresh for 60 seconds; mutations do not retry. A workflow MAY override those
defaults only when its failure and idempotency semantics require it.

- Define stable readonly query keys beside the related query hook.
- A query function SHOULD accept the `AbortSignal` supplied by Query and pass it
  to the HTTP client.
- Visual components MUST NOT scatter direct `fetch` calls or construct API URLs.
  Add focused operations to `api.ts`.
- Request values MUST be parsed before serialization and successful response
  bodies MUST be parsed from `unknown` with shared protocol schemas.
- Identifiers interpolated into paths MUST be encoded.
- Network failures, protocol error responses, and malformed successful responses
  MUST become safe `ApiClientError` values. Do not expose raw exceptions or use
  invented production fallback data.
- Structured error codes SHOULD drive behavior. Human-readable messages are for
  display and MUST NOT be parsed as application state.
- Room create/join mutations include reservation consumption because the user
  action succeeds only after the live room connection exists. Their mutation
  state owns pending and error presentation.
- Do not add optimistic updates for server-authoritative gameplay. An ordinary
  HTTP mutation MAY use an optimistic projection only when rollback and
  reconciliation are explicit and the projection cannot establish authority.
- Client parsing and mutation state do not replace server validation or
  authority.

## 7. Room connection and live state

- A room is entered only by consuming a server-issued Colyseus seat reservation.
- `RoomConnectionProvider` MUST own at most one current room. Replacing or
  unmounting it leaves the old room and releases references.
- Unexpected leave SHOULD attempt Colyseus reconnection when a token is present.
  Intentional leave and provider disposal MUST NOT trigger reconnection.
- A successful reconnect MUST replace the room reference and reattach state and
  leave listeners. A failed reconnect clears the stale connection.
- React rendering MUST update when mutable Colyseus schema state changes without
  copying that state into another authoritative object.
- Direct invite URLs MUST allow a disconnected browser to reserve a seat by room
  code. A browser refresh currently loses its in-memory connection and asks the
  player to join again; do not claim transparent refresh recovery.
- UI commands MUST send only the minimum intent payload defined by the protocol.
  Never send player identity, trusted timestamps, scores, hits, or winners.
- Connection errors MUST leave the page in an honest recoverable state; the UI
  must not keep showing a room as live after its connection has been cleared.

## 8. Forms, loading, errors, and resilience

- Fields MUST use MUI controls with visible labels and show errors beside the
  relevant input. Non-field mutation errors belong at form level with alert
  semantics.
- Submitted values SHOULD remain available after a server error.
- Submission MUST be guarded while the TanStack mutation or form submission is
  pending.
- Async UI MUST render every reachable state: initial/loading, success, empty,
  and recoverable error, plus reconnecting or disconnected where relevant.
- Empty data is a valid result and MUST NOT be presented as a request failure.
- Existing useful content SHOULD remain stable during background or reconnect
  activity where the protocol still makes it trustworthy.
- Error text MUST be safe, concise, and actionable. Recovery controls SHOULD be
  present when retrying or navigating can resolve the state.
- Unknown routes MUST render an explicit not-found screen.

## 9. Accessibility and phone layouts

- Use the correct semantic element for every interaction; all controls MUST be
  keyboard operable.
- Inputs MUST have visible labels. Icon-only controls MUST have accessible names.
- Focus MUST remain visible. Dialogs or overlays MUST manage and restore focus.
- Meaning MUST NOT rely on color alone, and text and controls MUST maintain
  adequate contrast.
- Dynamic player, connection, and game-status updates SHOULD use live-region
  semantics when users need immediate notification without overwhelming
  assistive technology.
- Heading order, landmarks, labels, and form error relationships MUST remain
  coherent on every route.
- QR codes MUST be accompanied by a human-readable room code and invite link;
  the image is never the only join mechanism.
- Every screen MUST work at 320 CSS pixels without page-level horizontal
  scrolling. Wider layouts remain usable but are secondary.
- Interactive targets SHOULD be at least 44 by 44 CSS pixels; application button
  defaults use a 48-pixel minimum height.

## 10. TypeScript and testing

- TypeScript MUST remain strict. External data starts as `unknown`; `any` is not
  an acceptable trust-boundary type.
- Local types SHOULD be inferred when clear. Export only types that form a real
  interface between modules.
- Discriminated unions SHOULD represent reachable async or game-phase variants,
  with exhaustive handling when every variant requires behavior.
- Type assertions MUST NOT substitute for runtime validation.
- Component tests that render Query consumers MUST create an isolated
  `QueryClient` with retries disabled; test caches MUST NOT leak between cases.
- Component tests SHOULD cover user-visible behavior, validation, loading,
  empty/error states, pending submission, and accessibility-sensitive controls.
- Tests MUST prefer role, label, and visible-text queries and MUST NOT depend on
  MUI-generated class names or internal hook details.
- Mock the HTTP or Colyseus boundary in component tests, not TanStack Query or
  component helpers.
- Playwright SHOULD cover each critical room flow through the built application
  and real server, including multiple isolated browser contexts for distinct
  players.
- Every supported mobile flow requires a narrow-viewport assertion. A bug fix
  SHOULD add a proportionate regression test.

## 11. Storybook

Storybook is the isolated visual-state catalogue. Global configuration MUST use
the same exported application provider and theme, with `MemoryRouter` supplying
story navigation context.

- Colocate `*.stories.tsx` with the component or presentational feature it
  exercises.
- Cover reusable components and meaningful loading, empty, error, ready,
  long-content, narrow-width, disabled, and multi-player states as applicable.
- Stories SHOULD use explicit deterministic props rather than real production
  HTTP or WebSocket calls.
- A component that cannot be represented without booting the application SHOULD
  first be examined for mixed presentation and orchestration responsibilities;
  do not contort a well-scoped feature solely for Storybook.
- The a11y addon MUST remain enabled. A successful static build proves stories
  compile; it does not replace browser interaction tests or manual accessibility
  review.
- Run `pnpm storybook:build` after changing providers, theme, Storybook config,
  or covered components. CI builds Storybook independently of the application.

## 12. Prohibited patterns and exceptions

The following patterns are prohibited unless a narrow documented exception
shows why the current architecture cannot meet the requirement:

- client-authoritative gameplay or identity;
- server imports in browser code;
- direct API calls or business state transitions embedded across visual JSX;
- Query results copied into local state or live Colyseus state copied into Query;
- multiple live room owners, giant mutable contexts, or premature global stores;
- a second component/styling system, direct Emotion application styles, or
  pass-through wrappers around MUI primitives;
- universal forms, tables, hooks, or game renderers designed for hypothetical
  consumers;
- real network-dependent stories, silent errors, or fake production fallback
  data.

A MUST rule may be broken only by a narrow, recorded exception that preserves
its underlying invariant where possible. A durable new pattern requires an
update to these standards and the web gatekeep checklist.
