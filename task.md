# Build a Mobile Multiplayer Game: Falling Platforms

You are responsible for implementing the complete game described below.

Act as the execution layer. The product and technical decisions in this specification are intentional. Do not redesign the game into a conventional platformer, add unnecessary systems, or stop after producing scaffolding.

When implementation details are not specified, choose the simplest reliable option consistent with this document.

Do not ask questions unless a genuinely blocking requirement cannot be resolved from the specification or the current codebase.

## Objective

Build a browser-based multiplayer game called **Falling Platforms**.

Players join a private room using a short code. Every player stands on a grid of platforms suspended over a void.

Players move by tapping another platform. Their character automatically jumps to that platform.

Platforms progressively warn and disappear. Players must keep hopping between the remaining platforms. A player is eliminated if:

* The platform beneath them disappears while they are standing on it.
* They land on a platform that disappeared while they were in the air.

The last surviving player wins.

The game must be designed specifically for mobile phones in portrait orientation.

## Product principles

The game should be:

* Immediately understandable.
* Playable with one finger.
* Fast to join.
* Fast to restart.
* Visually clear.
* Technically simple.
* Server authoritative.
* Usable on normal mobile browsers.
* Fun with two players but capable of supporting more.

Do not turn this into:

* A 3D game.
* A physics-heavy platformer.
* A virtual joystick game.
* A twin-stick game.
* A desktop game.
* A native mobile application.
* A game requiring accounts.
* A game requiring installation.
* A game with weapons or power-ups.

## Required technology

Use TypeScript throughout.

### Client

Use:

* Phaser for game rendering, scenes, cameras, tweens and touch input.
* Vite for development and production builds.
* The official Colyseus client SDK.
* Plain HTML and CSS for menus and lightweight overlays.

Do not use:

* React.
* Vue.
* Svelte.
* Redux.
* Canvas libraries on top of Phaser.
* A separate animation library.
* A virtual joystick library.
* A physics engine.

### Server

Use:

* Node.js.
* Colyseus.
* `@colyseus/schema`.
* The current recommended Colyseus server bootstrap from the official documentation.

Do not manually build:

* WebSocket connection management.
* Room discovery.
* Room lifecycle management.
* State patching.
* Reconnection handling.
* A custom multiplayer protocol where Colyseus already provides the solution.

### Shared libraries

Use established libraries where useful:

* Zod for validating external input.
* Nano ID for short room-code generation.
* A small deterministic random-number library such as `seedrandom` or `pure-rand`.
* Vitest for unit and integration tests.
* Playwright for mobile browser end-to-end tests.
* Biome for formatting and linting.
* pnpm workspaces for the repository.

Use current stable, mutually compatible library versions and commit the lockfile.

Consult current official documentation before using framework APIs. Do not copy obsolete Phaser or Colyseus patterns from old tutorials.

## Repository structure

Use a small workspace:

```text
falling-platforms/
  apps/
    client/
      src/
        game/
          config.ts
          createGame.ts
        scenes/
          BootScene.ts
          GameScene.ts
        rendering/
          ArenaRenderer.ts
          PlayerRenderer.ts
        input/
          TapController.ts
        ui/
          screens.ts
          styles.css
        networking/
          GameClient.ts
        main.ts

    server/
      src/
        rooms/
          FallingPlatformsRoom.ts
        state/
          GameState.ts
          PlayerState.ts
          PlatformState.ts
        game/
          match.ts
          hopping.ts
          platforms.ts
          spawning.ts
        validation/
          messages.ts
        index.ts

  packages/
    shared/
      src/
        constants.ts
        ids.ts
        messages.ts
        types.ts
        grid.ts
        index.ts

  package.json
  pnpm-workspace.yaml
  biome.json
  README.md
```

Keep the number of files reasonable. Do not create interfaces, repositories, managers, factories or service layers unless they solve a concrete problem.

## Fundamental control model

The game must use **tap-to-hop controls**.

There is:

* No joystick.
* No directional pad.
* No movement stick.
* No jump button.
* No drag-to-move.
* No tap-and-hold movement.
* No continuous walking.
* No pathfinding.
* No keyboard controls.

Every movement is a discrete jump from one platform to another.

### Grounded state

When grounded, a player occupies exactly one platform.

The player is positioned at the centre of that platform.

The server stores the platform ID rather than continuously storing arbitrary world coordinates.

### Choosing a target

The player taps another platform on the screen.

A target is valid when:

* The player is alive.
* The match is in the `playing` phase.
* The player is currently grounded.
* The target platform exists.
* The target platform is not already gone.
* The target is adjacent to the player’s current platform.
* The target is not the same platform the player currently occupies.

Allow all eight neighbouring positions:

```text
↖ ↑ ↗
← ● →
↙ ↓ ↘
```

Use Chebyshev distance:

```ts
const isAdjacent =
  Math.max(
    Math.abs(target.gridX - source.gridX),
    Math.abs(target.gridY - source.gridY),
  ) === 1;
```

This allows horizontal, vertical and diagonal hops.

Do not allow jumping over multiple platforms.

Do not automatically calculate a route to a distant platform.

### Touch handling

Use Phaser pointer input.

On `pointerdown`:

1. Convert the screen coordinate to a world coordinate using the camera.
2. Convert the world coordinate to a grid coordinate.
3. Find the corresponding platform.
4. Check whether it is a valid target.
5. Immediately provide visual feedback.
6. Send the hop request to the server.

Do not attach a separate interactive listener to every platform.

Use grid mathematics to identify the touched platform. This is simpler and scales better.

Example:

```ts
const gridX = Math.floor((worldX - arenaOriginX) / TILE_PITCH);
const gridY = Math.floor((worldY - arenaOriginY) / TILE_PITCH);
```

Account for the visible gap between platforms.

A tap close to a platform edge should resolve to the nearest platform centre within a small configurable tap tolerance.

Do not make the player tap an extremely precise region.

### Touch feedback

Valid adjacent platforms should have a subtle outline while the player is grounded.

When the player taps a valid target:

* Highlight it immediately.
* Begin an optimistic local jump animation immediately.
* Send the request to the server.

When the player taps an invalid target:

* Do not move.
* Briefly pulse that platform or position with a muted invalid indicator.
* Do not display a modal error.
* Do not vibrate the whole interface.

### Input while airborne

A player cannot change direction during a jump.

However, support a single buffered tap to make rapid play feel responsive.

While the local player is airborne:

* If they tap a platform, store only the most recent valid-looking target locally.
* Display a small outline around the buffered target.
* Do not send it immediately.
* When the authoritative server state confirms the player has landed, validate it against the new position.
* If it is still adjacent and not gone, send the buffered hop.
* Otherwise discard it.

The server must still validate the buffered hop normally.

The client-side buffer must not create authoritative movement.

Keep only one buffered target. New taps replace the previous buffered target.

Clear the buffered target when:

* The player is eliminated.
* The match ends.
* The player disconnects.
* The target platform disappears.
* The server rejects the previous movement.
* The player returns to the lobby.

## Jump behaviour

A jump is a short animation between two platform centres.

Suggested duration:

```ts
const HOP_DURATION_MS = 360;
```

Keep it configurable.

The server stores:

* Source platform ID.
* Target platform ID.
* Jump start time.
* Jump end time.
* Whether the player is currently jumping.

The client derives the visual position between the source and target.

Use interpolation:

```ts
const progress = clamp(elapsed / duration, 0, 1);
const eased = easeInOut(progress);

const worldX = lerp(sourceX, targetX, eased);
const worldY = lerp(sourceY, targetY, eased);
const visualHeight = Math.sin(Math.PI * progress) * JUMP_VISUAL_HEIGHT;
```

The height is purely visual.

Render the jump by:

* Moving the player container between platform centres.
* Raising the player sprite visually along an arc.
* Shrinking and fading the shadow slightly near the top of the jump.
* Returning the shadow to normal at landing.

Do not implement rigid-body physics.

Do not implement gravity.

Do not implement velocity integration.

Do not use Phaser Arcade Physics or Matter.js.

The server only needs timestamp-based jump state.

## Authoritative movement protocol

The client sends a hop request:

```ts
type HopRequest = {
  sequence: number;
  targetPlatformId: string;
};
```

The server must not trust:

* The client’s current platform.
* Client coordinates.
* Client timing.
* Client jump completion.
* Client claims about platform state.

The server validates the request using its own state.

A hop is accepted only when:

* The sequence number is newer than the last processed sequence.
* The player is alive.
* The player is participating in the current match.
* The player is grounded.
* The match phase is `playing`.
* The target platform exists.
* The target platform is `stable` or `warning`.
* The target is adjacent to the authoritative source platform.

On acceptance:

1. Record the accepted sequence.
2. Set `fromPlatformId`.
3. Set `targetPlatformId`.
4. Set `jumping = true`.
5. Set the authoritative jump deadline.
6. Broadcast the updated state through Colyseus.

On rejection:

* Do not modify player position.
* Send a small rejection message containing the rejected sequence and a machine-readable reason.
* Do not expose internal errors.

Suggested rejection reasons:

```ts
type HopRejectionReason =
  | "not-playing"
  | "not-alive"
  | "already-jumping"
  | "invalid-target"
  | "target-gone"
  | "not-adjacent"
  | "stale-sequence"
  | "rate-limited";
```

The client should reconcile to the authoritative state if it started an optimistic animation for a rejected move.

## Landing rules

When the jump deadline is reached, the server resolves the landing.

Process the landing using server state only.

If the target platform is still `stable` or `warning`:

* Set the player’s current platform to the target.
* Clear the source and target jump fields.
* Set `jumping = false`.

If the target platform is `gone`:

* Eliminate the player.
* Do not briefly place them safely on the target.
* Play the falling animation on clients.

If a platform disappears at exactly the same server update as a player’s landing, process platform disappearance before landing resolution.

Therefore, landing on a platform at the exact moment it disappears results in elimination.

This ordering must be deterministic and covered by tests.

## Falling and elimination

Players do not continuously fall through space.

Elimination is event-based.

A player is eliminated when:

### Case 1: Platform disappears beneath them

When a platform becomes `gone`, eliminate every grounded player whose `currentPlatformId` matches that platform.

Players who have already started a jump from that platform are safe from the source platform disappearing.

### Case 2: Target disappears before landing

When a jump completes, eliminate the player if the target platform is gone.

### Elimination animation

When eliminated:

* Mark the player dead immediately on the server.
* Disable local input.
* Clear any buffered tap.
* Animate the character shrinking and dropping into the void.
* Fade the player out.
* Switch the client into spectator mode.

The animation is cosmetic. The authoritative elimination must not wait for it.

## Arena

The arena is a square grid of platforms.

Each platform contains:

```ts
type PlatformStateValue = "stable" | "warning" | "gone";

type Platform = {
  id: string;
  gridX: number;
  gridY: number;
  state: PlatformStateValue;
};
```

Use deterministic IDs based on coordinates:

```ts
const platformId = `${gridX}:${gridY}`;
```

Do not generate random platform IDs.

### Platform dimensions

Use a mobile-friendly size.

Suggested logical dimensions:

```ts
const TILE_SIZE = 52;
const TILE_GAP = 6;
const TILE_PITCH = TILE_SIZE + TILE_GAP;
```

The exact values may be tuned, but:

* Platforms must be comfortably tappable.
* Several neighbouring platforms must remain visible.
* The local player must not obscure the whole target.
* Taps must not require pixel-perfect accuracy.

### Arena size

Do not impose a gameplay player limit such as:

```ts
MAX_PLAYERS = 8;
```

Calculate arena size from the number of participating players.

Use a simple formula:

```ts
const desiredPlatformCount = Math.max(49, playerCount * 6);
const arenaSide = Math.ceil(Math.sqrt(desiredPlatformCount));
```

Make the side length odd where practical so the arena has a clear centre.

Example utility:

```ts
const makeOdd = (value: number) =>
  value % 2 === 0 ? value + 1 : value;
```

Do not attempt to fit the entire arena on screen.

The camera follows the local player.

“Unlimited players” means there is no arbitrary gameplay cap. It does not mean infinite server or browser capacity. Document practical limitations honestly.

## Spawning

At the beginning of each match:

1. Reset every platform to `stable`.
2. Select unique spawn platforms.
3. Place each participating player on one platform.
4. Set every player as alive and grounded.
5. Clear previous movement state.

Use deterministic seeded randomness.

Distribute spawn platforms across the arena.

A simple acceptable approach is:

1. Build the list of all platform coordinates.
2. Divide the arena into broad regions.
3. Shuffle candidates using the match seed.
4. Assign unique positions while preferring distance from already chosen spawns.

Do not build a complex spatial optimiser.

Players must never spawn on the same platform.

Players joining during an active match are spectators and are not assigned a spawn until the next match.

## Platform lifecycle

Platforms have three authoritative states:

```ts
type PlatformStateValue = "stable" | "warning" | "gone";
```

### Stable

The platform is normal and usable.

### Warning

The platform remains usable but is about to disappear.

Suggested duration:

```ts
const PLATFORM_WARNING_MS = 900;
```

The client should:

* Change its colour clearly.
* Pulse it using a Phaser tween.
* Keep it visible.
* Avoid relying only on a subtle colour distinction.

Players may:

* Stand on a warning platform.
* Jump away from it.
* Jump toward it.

Jumping toward a warning platform is intentionally risky.

### Gone

The platform no longer exists for gameplay.

When the server changes a platform to `gone`:

* Eliminate grounded players on it.
* Prevent new hops toward it.
* Cause players already jumping toward it to fall when they reach it.

The client should animate it:

* Shrinking slightly.
* Dropping downward.
* Fading out.

The client animation must not delay the authoritative state change.

## Platform disappearance schedule

After the countdown, give players a short initial safety period.

Suggested timings:

```ts
const INITIAL_SAFE_PERIOD_MS = 2_000;
const PLATFORM_WARNING_MS = 900;
```

Use a simple difficulty schedule:

```text
0–10 seconds:
    Warn 1 platform every 1,400 ms

10–25 seconds:
    Warn 1 platform every 950 ms

25–40 seconds:
    Warn 2 platforms every 900 ms

40–60 seconds:
    Warn 2 platforms every 650 ms

60+ seconds:
    Warn 3 platforms every 500 ms
```

Keep all timings in one shared constants file.

The schedule may be tuned after testing, but do not replace it with a complicated dynamic difficulty system.

### Selecting platforms

Use the match’s seeded random generator.

On each removal cycle:

1. Collect all `stable` platforms.
2. Shuffle or select from them deterministically.
3. Select the required batch size.
4. Change selected platforms to `warning`.
5. Schedule them to become `gone`.

Selection rules:

* Never select an already warning platform.
* Never select a gone platform.
* Never select the same platform twice in one batch.
* Occupied platforms are allowed to be selected.
* Target platforms of airborne players are allowed to be selected.
* Do not guarantee that a safe route always exists.
* Do not run graph pathfinding.
* Do not calculate connected components every cycle.

However, while more than one player remains alive, do not warn every surviving grounded player’s current platform in the same batch.

At least one surviving grounded player should be left without their current platform being selected in a single cycle.

This prevents cheap simultaneous elimination while still allowing occupied platforms to disappear.

This protection applies only to a single selection batch. It does not make players permanently safe.

## Match lifecycle

Use explicit phases:

```ts
type MatchPhase =
  | "lobby"
  | "countdown"
  | "playing"
  | "results";
```

Valid transitions:

```text
lobby → countdown
countdown → playing
playing → results
results → lobby
```

Reject invalid transitions.

### Lobby

Players can:

* See the room code.
* See the player list.
* See who is host.
* Wait for the host.
* Copy the room code.

Only the host sees an enabled start button.

Require at least two participating players in production.

Allow a solo match only when:

```text
ALLOW_SOLO=true
```

This exists for development and tests.

### Countdown

Use a three-second countdown:

```text
3
2
1
GO
```

Do not allow movement during the countdown.

Display valid neighbouring platform outlines only after the match begins.

### Playing

Start the platform schedule after the initial safe period.

Determine eliminations and match completion on the server.

### Results

When one player remains after all events for a server update have been processed:

* Declare that player the winner.

When no players remain after processing all same-update events:

* Declare a draw.

Do not declare a winner immediately after processing the first elimination in an update. Process all platform transitions and landing events due in that update, then evaluate survivors.

Display results for approximately five seconds, then return everyone to the same lobby.

Reset all transient round state.

Do not require players to rejoin the room.

## Player state

Use compact Colyseus schema state.

A player should contain approximately:

```ts
class PlayerState extends Schema {
  @type("string") name = "";
  @type("boolean") connected = true;
  @type("boolean") participating = false;
  @type("boolean") alive = false;
  @type("boolean") jumping = false;

  @type("string") currentPlatformId = "";
  @type("string") fromPlatformId = "";
  @type("string") targetPlatformId = "";

  @type("number") jumpStartedAt = 0;
  @type("number") jumpEndsAt = 0;
  @type("number") lastAcceptedSequence = 0;
  @type("number") joinedOrder = 0;
}
```

Adjust the exact syntax to current `@colyseus/schema` requirements.

Do not synchronise:

* Phaser objects.
* Tweens.
* Sprite coordinates every frame.
* Input buffers.
* Validation schemas.
* Client UI state.
* Full message histories.
* Arbitrary physics velocities.

World positions are derived from platform coordinates and jump state.

## Room state

The room state should include approximately:

```ts
class GameState extends Schema {
  @type("string") phase = "lobby";
  @type("string") hostSessionId = "";
  @type("string") roomCode = "";
  @type("string") winnerSessionId = "";
  @type("boolean") draw = false;

  @type("number") roundNumber = 0;
  @type("number") aliveCount = 0;
  @type("number") arenaSide = 0;
  @type("number") matchStartedAt = 0;

  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @type({ map: PlatformState })
  platforms = new MapSchema<PlatformState>();
}
```

Use only state clients need.

## Server update loop

This game does not need a high-frequency physics simulation.

Use a modest fixed server update interval, such as:

```ts
const SERVER_UPDATE_MS = 50;
```

Twenty updates per second is sufficient.

On each update:

1. Determine the authoritative current time.
2. Transition due warning platforms to `gone`.
3. Eliminate grounded players standing on newly gone platforms.
4. Resolve jumps whose end time has been reached.
5. Resolve landing success or elimination.
6. Process any scheduled platform-warning cycle.
7. Recalculate the alive-player count.
8. Determine whether the match has ended.
9. Apply any due phase transitions.

Keep this code deterministic and independently testable.

Use Colyseus room timing utilities rather than scattered unmanaged `setTimeout` calls.

Do not create one JavaScript timer per platform or per player.

Use deadlines stored in state or internal room data and process them in the room update loop.

## Optimistic rendering

The local player should react immediately to taps.

When the client determines that a tap appears valid:

1. Start the local jump animation immediately.
2. Send the authoritative hop request.
3. Track the sequence number.

When the server state confirms the jump:

* Continue using the authoritative source and target.

When the server rejects it:

* Cancel the optimistic movement.
* Quickly animate or snap the player back to the authoritative platform.
* Clear any invalid buffered target.

Keep reconciliation simple.

Do not implement:

* Rollback netcode.
* Input replay.
* Frame-by-frame simulation reconciliation.
* Lag compensation.
* Client-owned positions.
* Peer-to-peer networking.

Because movement is discrete, the client only needs to reconcile platform IDs and jump state.

## Remote-player animation

When another player’s state changes from grounded to jumping:

* Read their authoritative source and target platform IDs.
* Animate them between those platforms.
* Use the configured hop duration.
* Do not snap them immediately to the target.

When the authoritative landing patch arrives:

* Ensure they end at the target platform centre.
* Correct small animation drift silently.

When they are eliminated:

* Stop the hop animation if necessary.
* Play the fall animation.

Do not synchronise animation frames over the network.

## Clock handling

Do not build an elaborate network clock-synchronisation subsystem.

The server is authoritative about:

* Whether a jump is active.
* Whether a platform is warning or gone.
* Whether a player is alive.
* Whether the match has ended.

Client animations are cosmetic.

Use authoritative state transitions to correct visual timing.

It is acceptable for two clients’ warning pulse animation to begin a few milliseconds apart.

Correctness matters more than frame-identical animation.

## Room codes

Players use a short private room code.

Use a readable alphabet without ambiguous characters:

```text
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

Use four or five characters.

Room codes must be:

* Case-insensitive on input.
* Normalised to uppercase.
* Unique among active rooms.
* Removed when the room is disposed.
* Easy to copy.

Use Nano ID’s custom alphabet generation.

Use the simplest officially supported Colyseus approach for associating a private code with a room.

Acceptable approaches include:

* A custom Colyseus room ID, when supported by the current API.
* Colyseus room metadata and filtered matching.
* A small in-memory code-to-room mapping integrated into the same server process.

Do not add:

* Redis.
* A database.
* A separate matchmaking microservice.
* A second WebSocket server.

If an in-memory mapping is used, keep it in the same server and remove entries on room disposal.

Document that horizontal server scaling would require shared presence or shared code storage, but do not implement that for this project.

## Joining flow

### Home screen

Show:

* Game title.
* Display-name input.
* Create room button.
* Room-code input.
* Join room button.
* Small connection-error area.

Display-name requirements:

* Trim whitespace.
* Minimum 1 character.
* Maximum 20 characters.
* Render only as text.
* Never inject it as HTML.

Persist the last display name in local storage.

Do not persist room membership as an account.

### Creating a room

When the player taps **Create room**:

1. Validate the display name.
2. Create a private room.
3. Generate or receive the room code.
4. Join the room.
5. Enter the lobby.
6. Make the creator the initial host.

### Joining a room

When the player taps **Join room**:

1. Validate the display name.
2. Normalise the code.
3. Attempt to join the existing room.
4. Show a clear error if it does not exist or cannot be joined.
5. Do not silently create a new room when a code is invalid.

Players joining during `countdown`, `playing` or `results` become spectators until the next lobby.

## Host behaviour

The first connected player is host.

Only the host may start a match.

When the host permanently leaves:

* Assign the oldest remaining connected player as host.
* Update the room state.
* Continue an active match.
* Do not cancel the match solely because the host left.

Do not give the host gameplay advantages.

## Disconnection and reconnection

Use Colyseus reconnection support.

Allow approximately ten seconds for reconnection.

During the grace period:

* Keep the player in the room state.
* Mark them disconnected.
* Stop accepting input from their old connection.
* Let an in-progress jump finish normally.
* If grounded during a match, normal platform disappearance can still eliminate them.

If they reconnect:

* Restore the same player state.
* Do not create a duplicate player.
* Restore control if they remain alive.

If the grace period expires:

* Remove them from the lobby, or
* Eliminate them during an active match.

A disconnected player must not block the match from ending.

When the host’s grace period expires, reassign the host.

Use framework reconnection tokens. Do not invent authentication.

## Spectator mode

When eliminated or joining an active match:

* Hide all valid-target outlines.
* Disable movement input.
* Display `Spectating`.
* Automatically follow a surviving player.

If the followed player dies:

* Follow another survivor.

Allow a spectator to tap a visible living player to follow them.

Do not add:

* Free-camera controls.
* Spectator chat.
* Rewind.
* Multiple camera modes.

When no living player remains, keep the camera where it is and show the result overlay.

## Camera

Use a Phaser camera following the local player.

Requirements:

* Smoothly follow the local player during hops.
* Keep enough neighbouring platforms visible to make decisions.
* Avoid extreme zoom changes.
* Do not show the whole arena for large matches.
* Clamp the camera to arena bounds where appropriate.

Aim to display approximately seven platforms across the portrait screen.

When spectating, follow the selected surviving player.

## Mobile layout

Target modern mobile Safari and Chrome.

Use a portrait logical resolution around:

```ts
const GAME_WIDTH = 390;
const GAME_HEIGHT = 844;
```

Use Phaser scaling so the game fits different phone sizes.

Implement:

* Responsive canvas sizing.
* `viewport-fit=cover`.
* Safe-area insets.
* `touch-action: none`.
* Disabled text selection.
* Disabled page scrolling during gameplay.
* Disabled overscroll and pull-to-refresh where CSS allows.
* No accidental double-tap zoom.
* Large buttons.
* Sufficient spacing between room-code and start controls.

In landscape orientation:

* Pause or cover gameplay input.
* Display a clear overlay asking the player to rotate the phone.
* Resume when portrait orientation returns.

Do not build a landscape layout.

## Visual style

Use only generated shapes and text.

Do not source art assets.

### Arena

* Dark void background.
* Stable platforms with strong contrast.
* Warning platforms in a clearly distinct colour and pulsing state.
* Gone platforms invisible, leaving visible gaps.
* Small spacing between platforms.

### Players

Represent each player with:

* A coloured circle or simple rounded character.
* A deterministic colour derived from session ID.
* A small shadow.
* Their display name above them.
* A white outline for the local player.

Do not render HTML name labels over the canvas. Use Phaser text objects.

### Local movement hints

While grounded, render a subtle outline around valid adjacent platforms.

Do not use arrows or instructional text after the player has started playing.

### Countdown and status

Display:

* Countdown.
* Alive-player count.
* Room code.
* Spectating status.
* Winner or draw result.

Keep overlays away from the main tapping area.

## Screens

Implement only four primary states.

### Home

* Name input.
* Create button.
* Room-code input.
* Join button.
* Error message.

### Lobby

* Room code.
* Copy button.
* Player list.
* Host marker.
* Start button.
* Waiting message.

### Game

* Phaser canvas.
* Alive count.
* Room code.
* Countdown.
* Spectating label when relevant.

There are no on-screen movement buttons.

### Results

* Winner name or draw.
* Short automatic return-to-lobby countdown.

Do not add:

* Settings.
* Accounts.
* Avatars.
* Chat.
* Leaderboards.
* Match history.
* Achievements.
* Shop.
* Cosmetics.
* Tutorial pages.

## Validation and abuse protection

Validate all external messages with Zod before using them.

Validate:

* Display names.
* Room codes.
* Hop requests.
* Start-match requests.
* Any reconnect information not already handled by Colyseus.

For hop requests:

* Require finite numeric sequence values.
* Require integer sequence values.
* Require a valid platform ID format.
* Ignore duplicate or stale sequences.
* Rate-limit excessive hop messages.
* Never accept a source platform from the client.

A normal player cannot legitimately complete more than a few jumps per second.

A generous hop-message limit such as 12 per second is sufficient.

Do not disconnect a user for one malformed message. Ignore or reject it safely.

Do not expose stack traces or internal exception messages to clients.

## Test architecture

Design the pure game logic so it can be tested without starting a browser or WebSocket server.

Pure or mostly pure functions should cover:

* Grid adjacency.
* Arena generation.
* Spawn selection.
* Platform selection.
* Hop validation.
* Hop start.
* Hop completion.
* Platform disappearance.
* Elimination.
* Survivor calculation.
* Winner calculation.
* Host reassignment.

Keep Colyseus-specific code thin around these functions.

## Unit tests

Use Vitest.

Test at minimum:

### Grid and input

* Orthogonal neighbours are valid.
* Diagonal neighbours are valid.
* A platform two spaces away is invalid.
* The current platform is invalid as a target.
* A malformed platform ID is rejected.
* A gone target is rejected.
* A warning target is accepted.
* A stale sequence is rejected.
* Duplicate sequences are rejected.

### Jump lifecycle

* A valid hop starts correctly.
* A grounded player becomes airborne.
* A player cannot start another authoritative hop while airborne.
* A jump remains active before its deadline.
* A jump completes at its deadline.
* Landing on a stable platform succeeds.
* Landing on a warning platform succeeds.
* Landing on a gone platform eliminates the player.
* Source disappearance after takeoff does not eliminate the airborne player.

### Platform disappearance

* Stable becomes warning.
* Warning becomes gone.
* Grounded players on a newly gone platform are eliminated.
* Airborne players leaving that platform are not eliminated.
* The same platform is not selected twice.
* Seeded selection is reproducible.
* A batch does not select every grounded survivor’s platform when more than one survivor remains.

### Match result

* One survivor produces a winner.
* Zero survivors produces a draw.
* Same-update eliminations are all processed before winner calculation.
* Results return to the lobby correctly.
* Round state resets correctly.

### Rooms

* The first player becomes host.
* Only the host may start.
* The host is reassigned when they leave.
* A player joining during a match becomes a spectator.
* A reconnected player does not create a duplicate.
* A disconnected player is removed or eliminated after the grace period.

## Integration tests

Use Colyseus’s official testing utilities where available.

Test real room and client behaviour:

* Create a room.
* Join through its private code.
* Join with two clients.
* Confirm both receive the same platform state.
* Confirm only the host can start.
* Start the countdown.
* Confirm hop requests update authoritative state.
* Confirm invalid hops are rejected.
* Confirm platform disappearance reaches all clients.
* Confirm elimination reaches all clients.
* Confirm winner state reaches all clients.
* Confirm all clients return to the lobby.
* Confirm reconnection restores the same player.
* Confirm host reassignment works.

Do not mock the complete networking layer.

## End-to-end tests

Use Playwright with mobile device emulation and touch input.

Use at least two separate browser contexts.

Test the complete flow:

1. Open two emulated phones.
2. Enter two different display names.
3. Create a room on phone one.
4. Read the room code.
5. Join using phone two.
6. Confirm both players appear in the lobby.
7. Start from the host phone.
8. Confirm both phones display the countdown.
9. Confirm the arena appears.
10. Tap an adjacent platform using touchscreen input.
11. Confirm the local player begins moving immediately.
12. Confirm the second phone sees that player move.
13. Confirm warning platforms visibly pulse.
14. Produce a deterministic elimination.
15. Confirm the eliminated player enters spectator mode.
16. Confirm the surviving player is declared winner.
17. Confirm both clients return to the same lobby.
18. Start another round.

### Deterministic test mode

Add a test-only mode guarded by an environment variable:

```text
E2E_TEST_MODE=true
```

In test mode:

* Use a fixed match seed.
* Use shorter countdown and platform timings.
* Use a known spawn layout.
* Use a deterministic first platform-removal sequence.

Do not include test controls in production builds.

A suitable deterministic scenario is:

* Player one and player two spawn on known tiles.
* Player two’s platform is the first occupied platform to warn.
* Player one’s platform is not selected in the same batch.
* If player two does not move, they are eliminated.
* Player one wins.

This allows the end-to-end test to verify elimination without relying on random timing.

## Developer commands

Provide working root commands:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm format
pnpm start
```

`pnpm dev` must start both server and client.

The client development server must be reachable from another phone on the local network.

Bind development services to an appropriate host and document configuration.

Use environment variables for server URL and ports.

Example:

```text
PORT=2567
VITE_GAME_SERVER_URL=ws://localhost:2567
ALLOW_SOLO=false
E2E_TEST_MODE=false
```

Do not hard-code production hostnames.

## README

Write a useful README containing:

* Game description.
* Architecture.
* Why movement is tap-to-hop.
* Required Node and pnpm versions.
* Installation.
* Development commands.
* Test commands.
* Environment variables.
* How to open two local browser sessions.
* How to test using two physical phones on the same Wi-Fi.
* Production build instructions.
* Server-authoritative design.
* Reconnection behaviour.
* Room-code behaviour.
* Practical scaling limitations.
* Known mobile-browser assumptions.

Do not describe incomplete features as finished.

## Code quality

Use strict TypeScript.

Avoid:

* `any`.
* Large mutable global state.
* Generic event buses.
* Dependency injection containers.
* Entity-component systems.
* Abstract repositories.
* Deep inheritance.
* Custom reactive frameworks.
* Custom WebSocket wrappers.
* Custom state-diff protocols.
* Premature performance systems.

Prefer:

* Small pure functions.
* Explicit state transitions.
* Discriminated unions.
* Readonly data where practical.
* Named constants.
* Library APIs over custom implementations.
* Direct code over speculative abstractions.

A small amount of mutation inside the authoritative room state is acceptable because Colyseus schema state is mutable by design.

Keep gameplay logic separate from rendering and transport.

## Implementation order

Implement in this order:

1. Create the pnpm workspace.
2. Configure strict TypeScript and Biome.
3. Implement shared grid and platform types.
4. Implement pure adjacency and hop validation.
5. Implement jump lifecycle logic.
6. Implement platform warning and disappearance logic.
7. Implement match-result logic.
8. Add comprehensive unit tests for the pure game logic.
9. Implement Colyseus state classes.
10. Implement the authoritative room update loop.
11. Implement room creation and private code joining.
12. Implement host and lobby behaviour.
13. Implement the Phaser arena renderer.
14. Implement tap-to-platform hit testing.
15. Implement local optimistic jump animation.
16. Implement authoritative correction.
17. Implement remote-player animation.
18. Implement platform warning and disappearance animations.
19. Implement elimination and spectator mode.
20. Implement reconnection.
21. Implement mobile portrait styling.
22. Add integration tests.
23. Add mobile Playwright tests.
24. Run every validation command.
25. Fix every failure.
26. Test manually with two browser sessions.
27. Test manually on at least one mobile-sized viewport.
28. Finish the README.

Do not begin with visual polish before the multiplayer game loop works.

## Completion criteria

The task is complete only when all of the following are true:

* The application runs in a mobile browser.
* The game is designed for portrait orientation.
* The game does not use a joystick.
* The game does not use a jump button.
* A player moves by tapping an adjacent platform.
* A tap starts immediate local visual movement.
* The server validates every hop.
* The server owns platform state.
* The server owns player survival state.
* The server owns the winner result.
* Two players can join through a private room code.
* The host can start the match.
* All clients see the same authoritative arena.
* Platforms clearly warn before disappearing.
* Players can jump away from warning platforms.
* Players can choose to risk landing on warning platforms.
* Grounded players fall when their platform disappears.
* Airborne players fall when their target disappears before landing.
* Eliminated players spectate.
* The last surviving player wins.
* Simultaneous final elimination creates a draw.
* Players return to the same lobby.
* Another round can be started.
* Reconnection works.
* Host reassignment works.
* There is no arbitrary gameplay player cap.
* Production builds succeed.
* Type checking passes.
* Linting passes.
* Unit tests pass.
* Integration tests pass.
* Mobile end-to-end tests pass.

Do not stop with TODO comments, skipped tests, knowingly failing commands or features described only in documentation.

Before finishing, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Fix every failure before declaring the task complete.

