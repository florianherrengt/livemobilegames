# Build Process

This document records how the game-lab framework was designed and built, so the
decisions and trade-offs are traceable.

## 1. Identify the ROM and choose an emulator

The supplied ROM (`Surround - Chase (Blockade)`, CX2641, 2048 bytes) is an
Atari 2600 cartridge. The filename, size, and catalog number all confirm this.

For programmatically controllable Atari 2600 emulation, **ALE (the Arcade
Learning Environment)** is the canonical choice. It is built on Stella, is
actively maintained by Farama Foundation (v0.12.0 released 2026), and exposes
through a Python/C++ API:

- controller input (single player)
- exact frame stepping
- raw RGB and grayscale framebuffer
- raw 128-byte RAM
- save/restore state (in-memory cloning)
- game-over, lives, reward
- game modes and difficulty switches
- deterministic execution with a random seed

No other Atari 2600 emulator provides this level of programmatic access with
active maintenance. Py65 lacks TIA/video. Standalone Stella requires GUI
automation. ALE is the right tool.

## 2. Verify ALE works with the ROM before designing

Before writing any framework code, the ROM was loaded into ALE and every
needed API was probed directly:

- `loadROM`, `reset_game`, `act`, `game_over` — load, reset, step, terminal
- `getScreenRGB` — 210x160x3 uint8 framebuffer (NTSC)
- `getRAM` — 128 bytes uint8
- `cloneSystemState` / `restoreSystemState` — state save/restore
- Two critical determinism checks:
  1. Two fresh ALE instances with the same seed and same action sequence
     produce byte-identical framebuffer and RAM.
  2. Save state, diverge with different inputs, restore, replay the same
     inputs — produces byte-identical results to the original branch.

Both checks passed, confirming the controlled-experiment workflow is viable.

## 3. Establish the architecture

The design separates four layers, with dependencies pointing strictly inward:

```
AI agent (future)
      |
game-lab CLI / GameLab API (typer / Python)
      |
generic EmulatorInterface + Capability flags
      |
thin adapter (ALEAdapter — the ONLY file that imports ale_py)
      |
ALE / Stella -> ROM
```

The core framework modules know nothing about Atari, ALE, or any specific game:

| Module | Responsibility |
|--------|---------------|
| `controller.py` | Generic `Button` enum, immutable `ControllerState` |
| `capabilities.py` | `Capability` flags + `describe()` helper |
| `emulator.py` | Abstract `EmulatorInterface`, `RomInfo`, `StepResult`, `StateHandle` |
| `framebuffer.py` | Frame hashing, diffing, connected-component regions (numpy + scipy) |
| `memory.py` | RAM hashing and diffing (numpy) |
| `observation.py` | Pydantic models for structured observations and results |
| `experiment.py` | Pydantic experiment schema + `ExperimentRunner` |
| `lab.py` | `GameLab` facade tying it all together |
| `cli.py` | Typer CLI with JSON-first output |
| `adapters/ale_adapter.py` | Thin ALE translation layer |

## 4. Choose libraries (prefer mature, maintained)

Per the guidance to prefer existing libraries over custom code:

| Concern | Library | Why |
|---------|---------|-----|
| Emulator | `ale-py` | The only mature, API-driven Atari 2600 emulator |
| Framebuffer ops | `numpy` | Standard array math; already a transitive dep |
| Region detection | `scipy.ndimage.label` | Mature connected-component labelling |
| Schema validation | `pydantic` v2 | Validation + JSON serialization for experiments and observations |
| CLI | `typer` | Typed, clean `--help`, built on click |
| Screenshots | `pillow` | Standard image I/O |
| Testing | `pytest` | Standard |

No library is pulled in for trivial functionality (hashing uses stdlib
`hashlib`; RAM diffing is ~15 lines of numpy).

## 5. Configure ALE for reverse engineering, not RL

ALE's RL defaults (frame_skip=4, 25% random action repeat) are harmful for
controlled experiments. The adapter sets:

```python
frame_skip = 1                    # one act() = exactly one emulator frame
repeat_action_probability = 0.0   # never stochastically repeat
sound = False, display_screen = False  # headless
```

This guarantees the contract: `one input -> exactly one frame -> one observation`.

## 6. Design the experiment format

Experiments are small JSON recipes with:

- `name`, optional `rom`, `seed`, `reset`
- `setup` steps (run without recording observations, to reach a known state)
- `save_state_after_setup` (checkpoint for branching)
- `steps` with `frames`, `inputs`, `observe`, `observe_per_frame`,
  `screenshot`, `save_state`, `restore_state`

The schema uses pydantic validators to catch invalid experiments before
execution: frames must be >= 1, connectivity must be 4 or 8, and every
`restore_state` must reference a save that happens before it.

## 7. Design observations for text-only agents

Every observation is a JSON record with:
- frame counters
- inputs applied
- framebuffer hash + dimensions
- changed pixel count, bounding box, connected-component regions
- RAM hash, changed address count, changed addresses
- terminal / lives / reward (when exposed)
- links to screenshots and save states

Regions and addresses are **never** labelled. The framework reports "an 8x9
region at (112,116) changed" and "address 0x70 changed 6 -> 2"; the agent
infers what those mean.

## 8. Write smoke experiments

Eight JSON experiments in `experiments/` prove the framework works end-to-end:

1. Load and reset
2. Advance exact frames
3. Controller input (all directions + fire)
4. Per-frame observation of changes
5. Screenshots
6. Save/restore branching (controlled experiment with one variable)
7. Memory inspection (save state, advance, restore, compare)
8. Deterministic replay

These use arbitrary inputs and contain zero knowledge of how Surround works.

## 9. Write tests

117 tests in `tests/`, testing the framework — never the game's rules:

- Controller semantics (equality, ordering, coercion, unknown buttons)
- Framebuffer diffing (identical, blocks, multi-region, grayscale, shape mismatch)
- RAM diffing (identical, changes, size mismatch, numpy input)
- Experiment schema (validation, invalid files, state-ref ordering)
- End-to-end execution (stepping, branching, determinism, per-frame, screenshots)
- CLI (all commands via typer's CliRunner)
- Unsupported capabilities (fake adapter that supports nothing)
- Two-player adapter (port-2 delivery, joint-action determinism, probe
  divergence on both ports, replay contract, registry)
- RAM poke (writes land before frames, setup steps apply them, capability
  gating, schema bounds, determinism, CLI command)

## 10. Issues found and fixed during review

After the initial build, a thorough code review caught:

- **Dead code**: `ALL_CAPABILITIES` constant, `_ACTION_BY_BUTTON` module dict,
  `_supported_codes` attribute, unused imports (`Iterable`, `sys`, `Button`,
  `UnsupportedCapability`, `Experiment`, `ExperimentRunner` in cli.py)
- **Redundant validation**: `ExperimentStep._frames_positive` validator
  duplicated pydantic's `Field(ge=1)` constraint
- **Misplaced imports**: `_CAP_*` constants and `describe` import were at the
  bottom of `experiment.py` with a misleading "avoid cycle" comment; moved to
  the top (no import cycle exists)
- **Dead parameters**: `force` on `sample()`, `record_observations` and
  `sample_fn` on `_apply_step()` — never used
- **Fragile code**: `__contains__` on `ControllerState` only caught
  `ValueError`; broadened to also catch `TypeError`
- **Messy test**: `test_state_round_trip_is_exact` had a `or True` no-op
  assertion and redundant logic; rewritten to clearly test reproduce + diverge

All 73 tests pass after cleanup.

## 10b. Issues found and fixed during second review round

A second thorough pass caught deeper bugs:

- **`observe` / `observe_per_frame` interaction was broken**: per-frame
  observations were recorded even when `observe: false` (the per-frame loop
  didn't check `observe`). When `observe_per_frame: true`, no per-step summary
  was produced (the docstring said "in addition to" but the code skipped it).
  Fixed: `observe` is now the master switch; when both are true, per-frame
  samples plus a per-step summary are recorded; screenshots and save_state are
  now independent of `observe`.
- **Experiment-level `restore_state` didn't reset baselines**: after restoring
  a named state at the experiment level (not the step level), the framebuffer
  and RAM diff baselines were left at the setup-phase values, so the first
  observation reported a spurious large diff. Fixed: reset baselines after
  experiment-level restore, matching the step-level behavior.
- **Contradictory inputs silently became NOOP**: pressing UP+DOWN or LEFT+RIGHT
  (impossible on a real joystick) fell through to a `.get(key, 0)` fallback that
  silently produced NOOP. Fixed: explicit `ValueError` with a clear message.
- **Fragile `__dict__` on dataclasses**: CLI used `obj.__dict__` to serialize
  frozen dataclasses; replaced with `dataclasses.asdict()` for robustness.
- **Inline imports**: `from .capabilities import Capability` in a CLI command
  and `from ..capabilities import describe` in the adapter were inline; moved
  to top-level imports.
- **`observations[-1]` crash risk**: if `save_state` was used without `observe`,
  the code would have crashed on `observations[-1]`; now guarded.

4 new tests added for these fixes. 77 tests pass.

## 10c. Issues found and fixed during the reverse-engineering exercise

A real reverse-engineering attempt against the supplied ROM (Surround) drove
the framework to a third round of improvements. The exercise simulated a
text-only agent doing: baseline observation, input-effect mapping, game-tick
detection, and rule discovery.

- **Observations had no per-address RAM changes**: `diff_ram()` already computed
  `{address, before, after}` but the runner discarded it, keeping only the
  address list. An agent trying to correlate input with RAM had to re-derive
  before/after from separate samples. Fixed: `ram_changes` on every observation
  where RAM changed.
- **No way to select game mode or difficulty**: the adapter supported
  `set_mode`/`set_difficulty` but experiments couldn't express them. Fixed:
  `mode` and `difficulty` fields on the Experiment schema, applied before
  reset. Unsupported values now produce a warning instead of crashing.
- **RAM values were hashed, not readable**: `include_ram_values: true` adds the
  full 128-byte value array to each observation so an agent can watch specific
  addresses (e.g. a direction code) change across samples.
- **No way to see what is on screen without a PNG**: added `framebuffer_colors`
  (top-N palette with counts and fractions) to every observation and a
  `frame colors` CLI command for saved screenshots. This was the single most
  impactful addition: an agent can now read "85% blue, 14% pink, 0.6% red
  block" as text.
- **Comparing two experiments was manual**: `results compare` aligns two result
  JSONs by sample index and reports the first framebuffer and RAM divergence,
  diverged sample count, and the addresses involved. This exposed a pitfall the
  manual workflow had hidden: RAM diverged under LEFT/RIGHT while the screen
  did not (attract-mode autoplay already moved the demo block LEFT, and RIGHT
  is ignored by Surround's no-reversing rule). An agent watching only the
  framebuffer would have concluded "input ignored" — which was in fact the
  wrong conclusion reached during the manual attempt.

RE findings (framework-independent, for the record): Surround starts in an
attract/autoplay state; the port-1 block autoplays LEFT while RAM records the
joystick direction. UP/DOWN visibly steer the block (it moves 4px per game
tick, tick ~15 frames); the color-palette feature confirmed the "trail"
mechanic (block color count constant, trail color count grows). The earlier
manual conclusion that "inputs are ignored" was wrong — it was an artifact of
comparing only RIGHT/LEFT against an autoplay that already moves LEFT.

8 new tests added for these fixes. 85 tests pass.

## 10d. Issues found and fixed during the framework-gap round

The previous RE exercise left three capability gaps that a text-only agent hits
whenever it starts mapping inputs and reading the score. All three were
implemented, tested, and verified end-to-end against the supplied ROM.

- **Probing inputs was manual.** Answering "does holding X change anything?"
  required one experiment file per input plus a `results compare` per pair.
  Added `probes` to the Experiment schema: the runner branches from the
  post-step state once per input variant and reports per-variant
  `fb_divergence_frame`, `ram_divergence_frame`, and the RAM addresses that
  differ at first divergence (with baseline/variant values). First variant is
  the baseline. Requires save-state support; skipped with a warning otherwise.
- **The score was unreadable without vision.** Added `extract_glyphs()` to the
  framebuffer module and `glyph_regions` to the Experiment schema: connected
  non-background components with tight bboxes, pixel counts, dominant colors,
  and a sha256 shape fingerprint. Fingerprints are stable across identical
  shapes and change when a shape changes, so "the score digit changed" is
  detectable as a fingerprint change. Verified against Surround: the score
  area yields the two "0" digit glyphs, and a playfield region tracked the
  player block moving UP through successive bboxes.
- **RAM observation was all-or-nothing.** `include_ram_values` dumps all 128
  bytes per observation; watching 2-3 addresses meant reading 128. Added
  `ram_watch` (address list) → `ram_watch: {addr: value}` plus
  `ram_watch_changed` per observation. Schema-validated (non-empty, addresses
  in range). Verified against Surround: watching [10, 110] showed the UP input
  changing 110 (9 -> 4) and 115 (64 -> 16) across the probe.

Also fixed during the round: `extract_glyphs()` emitted numpy ints in bboxes
(crashed pydantic serialization); glyph group dicts were missing the `region`
key the Observation contract promised.

12 new tests added for these fixes. 97 tests pass.

## 10e. The capstone: finding the score address without vision

With the new features, the framework was used end-to-end as a text-only agent
would use it: hunt the score address on the supplied ROM.

- Ran 2000 idle frames with `glyph_regions` over the score strip and per-frame
  observations. The strip holds two digit glyphs (red left, yellow-green
  right); each digit value 0-4 has a unique, stable sha256 fingerprint.
- At frame 300 the red digit's fingerprint changed; the same observation's
  `ram_changes` showed address 118 going 0->1. Address 118 then incremented at
  exactly every later digit change (frames 813, 1326, 1839), and a re-run with
  `ram_watch: [118]` read `{'118': 4}` at frame 2000. **Score address found
  with zero image viewing.**
- Two findings shaped the guide:
  - A fingerprint change is not always a score change: the losing player's
    digit blinks (green<->pink, 16-frame cycles) after each point — same bbox,
    same pixel count, different color. Real digit changes alter bbox/pixel
    count too (a "0" is 12x17/168 px, a "1" is 4x17/68 px).
  - Honest negative: the green digit never left 0 — the demo AI always loses to
    the patrolling red block, so no green score address exists to find. The
    framework finds only state that actually occurs.
- Also learned: the demo red block patrols (RAM addr 102 toggles 239<->127,
  blips to 191 exactly 46 frames before each score), so the "static red block"
  impression from short probes was wrong — a reminder that short probes only
  sample a slice of behavior.

Two permanent experiment files were added: `experiments/09-probe-directions.json`
(the 5-variant probe sweep) and `experiments/10-score-hunt.json`
(ram_watch + glyph score hunt). Both reproduce their findings via the CLI.

## 10f. Two-player input (the missing capability)

The capstone left one gap: the green player never scores because the demo AI
controls it and always loses. The fix is a second input port, so a real player
can steer green.

- Standard `ale-py` cannot do this: its Python `Action` enum only exposes
  player-A codes 0-17, `act(18)` raises `Invalid Player A Action: 18`, and the
  C++ `ALEInterface::act` hardcodes `PLAYER_B_NOOP` ("single player mode").
  ALE's docs point to the Farama fork
  [Multi-Agent-ALE](https://github.com/Farama-Foundation/Multi-Agent-ALE),
  whose PyPI wheel (`multi-agent-ale-py` 0.1.12) carries a cp313 macOS arm64
  build — a rare case where the fork is more current than the main package.
- Its ctypes `ALEInterface.act()` takes a **joint action vector** with one
  action per active player. Verified on Surround mode 1 (two-player mode):
  `numPlayersActive()==2`; `[0,2]` (P2 UP) vs `[2,0]` (P1 UP) produce
  symmetric, independent framebuffer changes.
- New `MultiAgentALEAdapter` (`ale-stella-multi`): picks a two-player mode when
  the ROM has one, encodes one action per active port, reports both ports from
  `inputs()`, and raises `UnsupportedCapability` for ports beyond the active
  set. Adapters are now registered in `adapters/__init__.py` and built via
  `build_adapter()`; experiments declare `"adapter"` (default `ale-stella`),
  overridable with `--adapter` on the CLI.
- Findings worth keeping:
  - Surround cannot turn in place: steering input writes the direction byte to
    RAM (addr 124) on the very first frame, but the block only visibly turns
    once it reaches the end of its current leg (fb divergence at frame 12-13,
    not 0). The reverse direction for each port is a silent no-op.
  - The fork's `restoreSystemState` restores the emulator but refreshes the
    screen buffer only on the next `act()`. Replay after restore is exact
    (tested), but the framebuffer must be read after stepping one frame.
- `experiments/11-two-player.json` reproduces port-1 vs port-2 steering; the
  suite grew to 110 tests.

## 10g. RAM poke: confirming a finding by writing it

The score address (118) was found by pure observation; the last mile of the
scientific method is a write-back that confirms it drives the score display.

- Added `ram_writes` to experiment steps: byte writes applied at the start of
  the step (after any `restore_state`), gated on the `RAM_WRITE` capability
  with an explicit error otherwise. Works in setup steps too. Schema bounds:
  address >= 0 (adapter enforces size), value 0-255.
- New `game-lab memory poke <rom> <addr> <value>` command: loads, resets,
  writes, steps, and reports `value_before` / `value_after` / `survived`.
- Verified write-back on the ROM: poking 118 = 5 changed the red score digit's
  glyph fingerprint at exactly the poke frame (ram_changes shows
  `{address: 118, before: 0, after: 5}`), the value survived 60+ frames, and
  the game kept running — proving 118 drives the score display, not just
  correlates with it. `experiments/12-ram-poke.json` reproduces this.
- Found a bug in the third-party fork while verifying pokes on the two-player
  adapter: `multi-agent-ale-py` ships a broken ctypes declaration for
  `setRAM` (`[c_size_t, c_int]` instead of `[c_void_p, c_size_t, c_ubyte]`),
  so RAM writes landed at the wrong place — observed as identical garbage
  bytes (0xC0) across all 128 addresses, varying per process. Audited every
  binding: `setRAM` is the only wrong one. The adapter heals it once at load;
  a regression test would otherwise read back garbage. Filed upstream as
  [PR #31](https://github.com/Farama-Foundation/Multi-Agent-ALE/pull/31);
  when a fixed release exists, the heal and its comment can be dropped.
- The `UnsupportedCapability` error gained an optional context string for
  clearer messages ("... while experiment step declares ram_writes").
- Suite grew to 117 tests.

## 11. Final verification

- `uv run pytest -q` — 117 passed
- All 12 experiments run cleanly through the CLI
- The full text-only agent workflow works: `frame diff` reports changed regions
  with coordinates, `memory diff` reports changed addresses with before/after
  values, observations carry color palettes and glyph fingerprints, probes
  answer "does input X matter" in one run, `results compare` detects
  input effectiveness, two-player experiments deliver independent input to
  both ports, and RAM pokes confirm candidate addresses by write-back — no
  image viewing required
