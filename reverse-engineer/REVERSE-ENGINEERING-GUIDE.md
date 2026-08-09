# Reverse-Engineering Guide

This document explains how to use game-lab to discover a game's rules through
controlled experimentation. It is written for an AI agent (or a human acting
like one) that has no prior knowledge of the game.

The framework never tells you what things *mean*. It gives you controlled
inputs, exact-frame execution, and structured observations of *what changed*
and *where*. Inferring meaning is your job.

---

## Core principle: the scientific method

Every discovery follows the same loop:

```
1. Observe something change
2. Form a hypothesis about why
3. Design a controlled experiment that isolates one variable
4. Run it (save state -> branch -> compare)
5. Read the structured observation
6. Confirm or reject the hypothesis
7. Repeat
```

game-lab gives you steps 3-5. You provide 1, 2, 6, and 7.

---

## Phase 0: Inspect what you have

Start by loading the ROM and asking the framework what it can do.

```bash
uv run game-lab info roms/surround.bin
```

```json
{
  "console": "atari2600",
  "adapter": "ale-stella",
  "screen_width": 160,
  "screen_height": 210,
  "ram_size": 128,
  "capabilities": ["LOAD_ROM", "RESET", "FRAME_STEP", "FRAMEBUFFER", "RAM_ACCESS", ...]
}
```

What to note:
- **ram_size**: how many bytes of memory you can inspect. Atari 2600 = 128.
- **capabilities**: what experiments are possible. If `RAM_ACCESS` is missing,
  you can only work with the framebuffer. If `MULTI_CONTROLLER` is missing,
  you can only control player 1.
- **screen dimensions**: the framebuffer resolution. Regions are reported in
  (x, y, width, height) within these coordinates.

```bash
uv run game-lab inputs roms/surround.bin
```

```json
{
  "multi_controller": false,
  "ports": { "1": ["UP", "DOWN", "LEFT", "RIGHT", "BUTTON_1"] }
}
```

This tells you the generic buttons you can send. The framework knows nothing
about what they do — that's for you to discover.

---

## Phase 1: Establish a baseline

Reset the game and observe the initial state without pressing anything:

```json
{
  "name": "baseline",
  "rom": "roms/surround.bin",
  "reset": true,
  "steps": [
    { "frames": 1, "inputs": {} },
    { "frames": 30, "inputs": {} },
    { "frames": 60, "inputs": {} }
  ]
}
```

```bash
uv run game-lab run experiments/baseline.json
```

Look at the observations. Key questions:
- Does the framebuffer change without input? (The game may have a demo mode,
  attract screen, or autonomous movement.)
- Does RAM change without input? (A clock or timer is ticking.)
- Is `terminal` true after some frames? (The game may auto-start or auto-end.)

The `change_regions` in each observation tell you *where* pixels changed, with
coordinates and sizes. If a region moves between observations, something on
screen is animating.

---

## Phase 2: Map inputs to effects

For each available button, run a controlled experiment: reset, press nothing
for a baseline, then press that button alone for a fixed number of frames.

```json
{
  "name": "input-right",
  "reset": true,
  "steps": [
    { "frames": 30, "inputs": {}, "observe": false },
    { "frames": 30, "inputs": { "1": ["RIGHT"] }, "observe_per_frame": true }
  ]
}
```

The `observe_per_frame: true` gives you one observation per frame, so you can
watch the effect develop frame by frame. Read the observations and look for:

- **Which region moved** when you pressed RIGHT. If a region at (50, 100) in
  one frame is at (52, 100) in the next, something moved 2 pixels right. That
  is likely the object you control.
- **Which RAM addresses changed**. If address 0x53 changes from 50 to 52 in
  sync with the visual movement, address 0x53 probably stores the X-coordinate
  of that object.
- **How many frames it took** for the effect to appear (some games have input
  lag).

Repeat for LEFT, UP, DOWN, BUTTON_1. For each input, you now have:
- a visual region that responds
- a set of RAM addresses that track it

This is your first piece of reverse-engineered knowledge, and you discovered it
purely from structured observations — no vision required.

---

## Phase 3: Use save/restore for controlled experiments

This is the most powerful technique. You reach a known state, save it, then
branch into multiple experiments that differ by exactly one variable.

### Example: does BUTTON_1 do anything?

```json
{
  "name": "button1-effect",
  "reset": true,
  "setup": [{ "frames": 40, "inputs": { "1": ["RIGHT"] } }],
  "save_state_after_setup": "checkpoint",
  "steps": [
    { "frames": 30, "inputs": {},              "restore_state": "checkpoint" },
    { "frames": 30, "inputs": { "1": ["BUTTON_1"] }, "restore_state": "checkpoint" }
  ]
}
```

Both steps start from the identical saved frame. Step 1 does nothing; step 2
presses BUTTON_1. Compare their observations:
- If the framebuffers differ (different `change_regions`, different `ram`
  hashes), BUTTON_1 has an effect.
- If they are identical, BUTTON_1 does nothing in this context (maybe it only
  works in certain situations, or this game doesn't use it).

### Example: what happens on collision?

Set up a situation where two objects are about to overlap. Save state. Then
run one experiment that avoids the overlap and one that doesn't. Compare the
RAM diffs to find which addresses signal a collision or life loss.

---

## Phase 4: Find the score in RAM

The score is usually stored in RAM as binary-coded decimal (BCD) or a plain
integer. To find it:

1. Run the game until you expect the score to change (e.g., after a collision
   or successful action).
2. Dump RAM before and after.
3. Diff them:

```bash
uv run game-lab memory dump roms/surround.bin --frames 0 -o before.bin
uv run game-lab memory dump roms/surround.bin --frames 30 --inputs RIGHT -o after.bin
uv run game-lab memory diff before.bin after.bin
```

```json
{
  "changed_address_count": 3,
  "changes": [
    { "address": 70, "before": 0, "after": 1 },
    { "address": 71, "before": 0, "after": 0 },
    { "address": 102, "before": 127, "after": 125 }
  ]
}
```

Address 70 went from 0 to 1 — that could be a score digit, a level counter, or
a flag. Confirm by running more experiments: does it keep increasing when you
repeat the action? Does it reset to 0 on game over?

**Never assume** — always confirm with follow-up experiments.

### Verify a candidate by writing it

Correlation is not causation. The decisive test for "address N is the score"
is a **write-back**: poke N to a known value and watch the thing it should
drive. A step-level `ram_writes` list does this inside an experiment:

```json
{
  "name": "ram-poke-score",
  "rom": "roms/surround.bin",
  "ram_watch": [118],
  "glyph_regions": [[0, 0, 160, 24]],
  "steps": [
    { "frames": 60, "inputs": {} },
    { "frames": 60, "inputs": {}, "ram_writes": [{ "address": 118, "value": 5 }] }
  ]
}
```

If the candidate is right, the observation after the poke shows the write in
`ram_changes` (`{address: 118, before: 0, after: 5}`) *and* the driven thing
changes with it — here, the red score digit's glyph fingerprint flips to the
shape of "5". If the address is a red herring, nothing downstream moves.

For quick checks outside an experiment file:

```bash
uv run game-lab memory poke roms/surround.bin 118 5 --frames 30
# {"address": 118, "value": 5, "value_before": 0, "value_after": 5, "survived": true}
```

`survived: true` also tells you the game did not clobber the write during the
follow-up frames — useful when a poke lands on an address the game itself
recomputes every tick.

---

## Phase 5: Map RAM addresses to meanings

Once you have candidate addresses from Phase 2-4, design experiments to
confirm their roles:

| Hypothesis | Experiment | Expected pattern |
|-----------|-----------|-----------------|
| Address X is player Y-coordinate | Press UP for N frames | Address X increases (or decreases) monotonically |
| Address X is a score | Perform scoring action | Address X changes; follows BCD pattern (each byte 0-9) |
| Address X is a life counter | Trigger game-over | Address X decrements by 1 |
| Address X is game state | Press START-equivalent | Address X changes between known values (e.g., 0=menu, 1=playing) |

For each hypothesis, use save/restore to control the starting state and isolate
the variable.

---

## Phase 6: Discover rules by experimentation

Rules (collision, scoring, movement speed, win/loss conditions) emerge from
patterns across many experiments. The workflow:

1. **Reach a state** using setup steps.
2. **Save it** (`save_state_after_setup` or a step's `save_state`).
3. **Branch**: run variations that change one thing.
4. **Compare**: read the observations and look for correlations.

For example, to discover movement speed:
- Save state at frame 0.
- Step RIGHT for 1 frame. Record the player's X-coordinate (the RAM address
  you identified in Phase 2).
- Restore. Step RIGHT for 2 frames. Record X.
- The difference tells you pixels-per-frame.

To discover collision rules:
- Position two objects close together. Save state.
- Step toward the other object in 1-frame increments.
- Watch for the frame where the movement stops, a life decrements, or the
  framebuffer changes dramatically.
- That frame is where collision was detected.

---

## Using screenshots as supplementary evidence

Screenshots are optional. The core workflow works without them. But they can
help confirm hypotheses:

```json
{
  "name": "confirm-with-vision",
  "steps": [
    { "frames": 30, "inputs": { "1": ["RIGHT"] }, "screenshot": "state-a.png" },
    { "frames": 30, "inputs": { "1": ["LEFT"] }, "screenshot": "state-b.png" }
  ]
}
```

Compare two screenshots structurally (without viewing them):

```bash
uv run game-lab frame diff runs/confirm-with-vision/state-a.png runs/confirm-with-vision/state-b.png
```

```json
{
  "changed_pixel_count": 136,
  "change_bounding_box": [44, 98, 72, 27],
  "change_regions": [
    [44, 107, 12, 9],
    [112, 108, 4, 17]
  ]
}
```

Two regions changed. You can now correlate these visual regions with the RAM
addresses that also changed in the same experiment. When a visual region and a
RAM address always move together across experiments, they represent the same
game object.

## Reading the screen as text: color palettes

Observations include `framebuffer_colors`, a top-N palette with pixel counts
and fractions. This lets you "see" the screen as text — no PNG viewer needed:

```json
{
  "rgb": [84, 92, 214],
  "count": 28340,
  "fraction": 0.8435
}
```

Track a color's count across frames to detect when objects are created,
destroyed, or painted over (the classic "trail" mechanic: the block color count
stays constant while the trail color count grows). For any saved PNG:

```bash
uv run game-lab frame colors runs/confirm-with-vision/state-a.png --top 4
```

## Comparing two experiments in one step

The most common RE question is "does input X change anything vs. idle?" Answer
it directly:

```bash
uv run game-lab run exp-idle.json -o idle.json --quiet
uv run game-lab run exp-up.json -o up.json --quiet
uv run game-lab results compare idle.json up.json
```

The output reports the first sample where the framebuffer and/or RAM diverge,
and lists the RAM addresses involved. Two pitfalls this tool exposes:

- **RAM can diverge while the screen does not.** The game may read the joystick
  (direction code stored in RAM) but only apply it on the next game tick. An
  agent that only watches the framebuffer would wrongly conclude "input
  ignored." Check both signals.
- **A direction can match attract-mode autoplay.** If the idle run's demo
  player moves LEFT, an experiment holding LEFT may look identical to idle even
  though input is fully effective. Compare against *multiple* inputs, not just
  one, before concluding that input is ignored.

## Game tick detection

Many games do not simulate every frame: they advance on an internal timer (e.g.
Surround updates the player position once per ~15 frames). Detect the tick by
running `observe_per_frame: true` over a fixed input and reading
`changed_pixel_count`:

```text
frame 17: 152 px   <- tick: block moves
frame 32: 152 px   <- tick
frame 47: 152 px   <- tick
```

Periodic `152 px` rows reveal the tick length and the block's step size
(regions show the old+new position, e.g. 4x9 + 4x9 = 8x9 for a horizontal step,
4x18 for a vertical step). Measure before designing input-hold lengths:
42 idle frames vs. 42 input frames can hide a 15-frame-tick game's response.

## Probing: answer "does input X matter?" in one run

Instead of writing one experiment per input and diffing results, use a probe —
a sweep of input variants, all branched from the same state:

```json
{
  "name": "probe-directions",
  "reset": true,
  "steps": [ { "frames": 14, "inputs": {} } ],
  "probes": [
    {
      "name": "directions",
      "frames": 42,
      "inputs": [ {}, { "1": ["UP"] }, { "1": ["DOWN"] }, { "1": ["LEFT"] }, { "1": ["RIGHT"] } ]
    }
  ]
}
```

The first variant is the baseline; every other variant is compared against it
frame-by-frame. Each variant reports:

- `fb_divergence_frame` — first frame the screen differed (or null)
- `ram_divergence_frame` — first frame RAM differed (or null)
- `ram_divergence_addresses` — `{address, baseline, variant}` at first divergence

Reading a probe result tells you instantly which inputs affect the game and
which are dead. A variant with `ram_divergence_frame: 0` but a null framebuffer
divergence means the game *read* the joystick (direction stored in RAM) but did
not visibly act — keep probing, the tick may be longer than your probe.

## Two-player games: driving port 2

Standard `ale-py` exposes one player port only; two-player games are covered by
the `ale-stella-multi` adapter (Multi-Agent-ALE fork), which drives a joint
action vector with one action per active player:

```bash
uv run game-lab inputs roms/surround.bin --adapter ale-stella-multi
# {"multi_controller": true, "ports": {"1": [...], "2": [...]}}
```

Declare the adapter in the experiment file, or override it per run:

```json
{
  "name": "two-player-ports",
  "adapter": "ale-stella-multi",
  "reset": true,
  "steps": [ { "frames": 30, "inputs": {} } ],
  "probes": [
    { "name": "ports", "frames": 42,
      "inputs": [ {}, { "1": ["UP"] }, { "2": ["UP"] }, { "2": ["DOWN"] } ] }
  ]
}
```

Notes that matter for agents:

- The adapter picks a **two-player mode** when the ROM has one
  (Surround: mode 1). `ram_watch` and probes see both ports in the same RAM.
- Steered input lands in RAM on the first frame, but Surround blocks cannot
  turn in place — the visible turn waits until the block reaches the end of
  its current leg, so a `fb_divergence_frame` of 12-13 (not 0) is normal.
  A null framebuffer divergence with `ram_divergence_frame: 0` means the game
  read the stick but treated that direction as a no-op (each port's "reverse"
  is dead).
- After `restore_state` the fork refreshes its screen buffer only on the next
  `act()` — read the framebuffer after stepping one frame, not immediately.

## Watching the score without vision: glyph fingerprints

`glyph_regions: [[x, y, w, h], ...]` adds a glyph extraction of each region to
every observation. A glyph is a connected group of non-background pixels, each
reported with a tight bbox, pixel count, dominant colors, and a **sha256 shape
fingerprint**. The fingerprint is stable while a glyph keeps its shape, and
changes the moment its shape changes.

That gives a text-only agent vision-free score tracking:

1. Extract the score area once (`game-lab frame glyphs score.png --region ...`
   or the observation's `glyph_groups`), find the digit glyphs' fingerprints.
2. On later observations, a changed fingerprint in the score region = the score
   display changed. Correlate that moment with the RAM diff from the same
   sample to find the score address.

You can even trace moving objects (the player block) by tracking which glyph
bbox contains a known fingerprint each frame — the Surround probe above showed
the block moving through `(120, 89) -> (120, 98) -> ...` while holding UP.

### Worked example: hunting the score address in Surround

Run `experiments/10-score-hunt.json` (2000 idle frames, `ram_watch: [118]`,
glyphs over the score strip), or the per-frame variant used here. The score
strip holds two digit glyphs: red `[32,5,12,17]` (left) and yellow-green
`[112,6,12,16]` (right). Each digit value has its own stable fingerprint:

| red digit | fingerprint | shape |
|-----------|-------------|-------|
| 0         | `97841ad5`  | 12x17, 168 px |
| 1         | `51c599e5`  | 4x17, 68 px (right-aligned in the same 12-px slot) |
| 2         | `cbb67988`  | 12x17, 156 px |
| 3         | `97a34a6f`  | 12x17, 144 px |
| 4         | `173702f0`  | 12x17, 116 px |

At frame 300 the red digit's fingerprint changed (`97841ad5` -> `51c599e5`); the
same observation's `ram_changes` showed address 118 going 0 -> 1. Confirmation:
118 increments exactly at every later digit change (813, 1326, 1839) and
`ram_watch: [118]` reads the value directly (`{'118': 4}` at frame 2000). The
score address was found without ever looking at an image.

**Caveat: blinks are not score changes.** When the red player scores, the
*losing* player's digit flashes green<->pink in 16-frame cycles for ~176 frames.
A flash has the same bbox and pixel count as the normal digit but a different
fingerprint and dominant color. Distinguish real digit changes (bbox/pixel
count change — a "0" is 168 px, a "1" is 68 px) from blinks (same bbox and
pixel count, only the color changed). Correlating the fingerprint change with
`ram_changes` disambiguates either way.

**Honest negative:** the green (port-1, player-controllable) digit never changed
from 0 in 2000 frames — the demo AI loses every point to the patrolling red
block, so no green score address could be found. The framework can only find
addresses for state that actually occurs.

## Tracking specific addresses

`ram_watch: [110, 115]` adds `ram_watch: {110: 7, 115: 16}` (plus
`ram_watch_changed`) to every observation. Once you suspect an address means
something, watch only it — far cheaper than `include_ram_values`' full dump and
less noise than reading every diff.

---

## Tips for an AI agent

1. **Start with RAM, not vision.** RAM is a 128-byte structured space that is
   far easier to reason about than a 33,600-pixel framebuffer. Find the
   addresses first, then use screenshots only to confirm.

2. **Use `observe_per_frame: true` for fine-grained analysis.** It costs more
   output tokens but lets you see frame-by-frame transitions.

3. **Always control your variables.** Never compare two experiments that differ
   in more than one input. Use `restore_state` to guarantee identical starting
   conditions.

4. **Watch for `terminal`.** If `terminal` becomes true, the game is over.
   You need to reset or restore to continue experimenting.

5. **Check determinism.** Run the same experiment twice and compare the
   framebuffer and RAM hashes. If they match, the game is deterministic and
   your findings will generalize. If they don't, there is randomness you need
   to account for.

6. **Document your findings as you go.** For each RAM address you identify,
   note: the address, the hypothesis, the experiment that confirmed it, and the
   observed value range. This builds a map of the game's memory layout that
   accelerates all future experiments.

7. **The framework gives you coordinates, not names.** When you see
   `change_regions: [[44, 107, 12, 9]]`, that means "a 12x9-pixel area at
   x=44, y=107 changed." You must decide whether that region is a wall, a
   player, a projectile, or a score display — by tracking how it behaves across
   many experiments.
