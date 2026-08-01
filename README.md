# Falling Platforms

A browser-based, mobile-first multiplayer game. Players stand on a grid of
platforms suspended over a void. Swipe up, down, left or right to hop to the
adjacent platform; platforms progressively warn and disappear; the last
survivor wins.

No joystick, no jump button, no physics, no accounts — just one-finger
swipe-to-hop movement and a short private room code.

## Why swipe-to-hop?

Every movement is a discrete jump from the platform you stand on to an
adjacent platform. A swipe anywhere on the screen expresses a direction — the
client resolves the adjacent platform in that direction and the hop follows
the finger's intent. There is no continuous walking or aiming: your position
is defined by *which platform you are on*, not by free coordinates. That makes
the game instantly readable, playable with one finger, and trivially
server-authoritative — the server stores a platform id, not a physics
simulation, so there is nothing to desynchronise.

## Architecture

The repository is a pnpm workspace:

```text
apps/client    Phaser 4 + Vite + the official Colyseus client SDK (@colyseus/sdk)
apps/server    Colyseus 0.17 server, @colyseus/schema state, pure game logic
packages/shared  Shared constants, types, Zod schemas and grid math
```

The server owns everything that matters:

- Match phase and lobby/host state.
- Platform state (`stable` → `warning` → `gone`) and the removal schedule.
- Hop validation, jump deadlines, landings and eliminations.
- The winner/draw result.

The client only renders authoritative state, starts optimistic animations for
its own swipes, and reconciles when the server disagrees. Colyseus handles
connection management, state patching and reconnection tokens — nothing custom
is layered on top.

The pure game logic (`apps/server/src/game/*`) has no Colyseus dependency, so
it is unit-tested without a server or browser.

## Requirements

- Node.js 20.19+ (Node 22 LTS or newer recommended)
- pnpm 9+ (10.x used in this repo)

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

This builds the shared package, starts the game server (default
`http://0.0.0.0:2567`) and the Vite dev server
(`http://0.0.0.0:5173`). Both bind to `0.0.0.0` so a phone on the same Wi-Fi
can reach them.

The client derives the server URL from the page origin: in dev it connects to
`ws://<hostname>:2567`; in production it connects to the same origin the page
was served from. Override with `VITE_GAME_SERVER_URL` when the server lives
elsewhere.

### Two local browser sessions

1. Open `http://localhost:5173` in one browser, enter a name, tap **Create
   room**.
2. Open a second browser (or a private/incognito window) at the same URL,
   enter a different name and the room code shown on the first screen.
3. The creator (host) taps **Start**.

### Two physical phones on the same Wi-Fi

1. Find your computer's LAN IP (e.g. `192.168.1.20`).
2. Open `http://192.168.1.20:5173` on both phones.
3. Create a room on one phone, join with the code on the other.
4. Portrait orientation only — landscape shows a rotate prompt.

If the phones cannot connect, check the firewall and that the server is
reachable from the phone: `http://192.168.1.20:2567/health`.

## Commands

```bash
pnpm dev         # server + client dev servers
pnpm build       # build shared, server and client
pnpm start       # run the built server (also serves the built client)
pnpm test        # unit + integration tests (Vitest)
pnpm test:e2e    # build + Playwright mobile end-to-end tests (two phones)
pnpm typecheck   # strict TypeScript checks across all packages
pnpm lint        # Biome check
pnpm format      # Biome format
```

`pnpm test:e2e` requires the Playwright Chromium browser
(installed automatically by `pnpm install`; re-run with
`pnpm exec playwright install chromium` if needed).

## Environment variables

```text
PORT=2567               # game server port
HOST=0.0.0.0            # game server bind host
ALLOW_SOLO=false        # allow a 1-player match (development/tests)
E2E_TEST_MODE=false     # deterministic, fast match timings for tests
VITE_GAME_SERVER_URL=   # client override; unset = derive from page origin
```

See `.env.example`.

## Server-authoritative design

- A hop request is `{ sequence, targetPlatformId }`. The client resolves a
  swipe direction into the adjacent target platform; the server validates the
  target against its own state (exists, not gone, adjacent to the player's
  *server-side* platform, not already jumping, sequence newer than the last
  accepted one, within the hop rate limit) and rejects otherwise with a
  machine-readable reason. The server never trusts the client's position or a
  claimed direction — only a concrete target platform is accepted.
- A platform holds at most one player: a hop is rejected with
  `target-occupied` when another participant is standing on the target or has
  already committed an in-flight jump onto it, so two players can never end up
  on the same tile. The client mirrors the rule for instant feedback and
  excludes occupied tiles from the movement hints.
- Jump start/end deadlines are server timestamps. Landing resolves when the
  deadline is reached; if the target disappeared in the same update, the
  player is eliminated. Platform disappearance is processed before landings
  in every update, so landing on a platform that vanishes at the same instant
  is death.
- The client starts an optimistic animation on swipe and reconciles: a
  rejected hop snaps back to the authoritative platform; an airborne swipe is
  buffered as a direction and only sent if it resolves to a valid adjacent
  platform after the authoritative landing.

## Reconnection

On an unexpected disconnect the server keeps the player in the room for 10
seconds, marks them disconnected, and allows a reconnection (Colyseus
reconnection token). During the grace period their match state continues: an
in-progress jump finishes, and a disappearing platform can still eliminate a
grounded player. Reconnecting restores the same player state with no
duplicate. When the grace period expires the player is removed in the lobby or
eliminated mid-match, and the host is reassigned to the oldest remaining
connected player.

The browser client uses the SDK's built-in reconnection flow for transient
network issues (including drops in the first seconds of a room, which the SDK
skips by default). While reconnecting, a "Reconnecting…" indicator appears in
the HUD and queued hop requests are flushed once the connection is restored.
If reconnection fails, the player returns to the home screen with an error.

## Room codes

The room code is the Colyseus room id: five characters from
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous I/O/0/1), unique among live
rooms, case-insensitive on input, and freed when the room is disposed. Codes
are registered in an in-memory registry in the server process.

Every round in a room uses a fresh random match seed (a fixed seed only in
`E2E_TEST_MODE`), so consecutive matches have different spawns and different
platform-removal orders. Players can leave a lobby at any time with the
**Leave room** button.

## Practical scaling limitations

- Room codes live in process memory: horizontal scaling to multiple server
  processes would require a shared presence/code store (Colyseus presence or
  Redis). Not implemented by design.
- The update loop and state patches are designed for one process; very large
  player counts grow the arena quadratically (at least six platforms per
  player, `side = odd(ceil(sqrt(max(49, players*6))))`), so browser rendering
  and patch bandwidth become the practical limits long before any gameplay
  cap — there is intentionally no artificial player limit.
- Colyseus rooms auto-dispose when the last client leaves.

## Known mobile-browser assumptions

- Designed for portrait orientation on modern mobile Safari and Chrome;
  landscape is covered by a rotate prompt, not a layout.
- `touch-action: none` on the canvas, disabled scrolling/overscroll and
  `viewport-fit=cover` with safe-area insets are used to keep taps and layout
  predictable.
- Phaser runs in the WebGL renderer; older browsers that lack WebGL may not
  render.
- Display names are rendered as plain text only (never HTML) and are capped at
  20 characters.
