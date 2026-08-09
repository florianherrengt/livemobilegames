# game-lab

A small, generic framework for **experimentally reverse-engineering old video
games** through a programmatically controllable emulator.

It is *not* an AI agent and contains no game-specific knowledge. It is the
reusable experimentation layer that sits between a ROM and a future AI
reverse-engineering agent:

```
ROM  ->  emulator  ->  controlled inputs  ->  exact-frame execution
      ->  structured observations  ->  future AI agent
```

An agent (text-only or vision-capable) drives the framework, forms hypotheses,
and runs controlled experiments. The framework keeps inputs deterministic,
steps the emulator by exact frames, and reports *what* changed and *where* —
but never assigns semantic meaning (no "player", "enemy", "score"). Inferring
meaning is the agent's job.

## Status

This version ships two emulator adapters:

| Adapter | Console | Backend | Multi-controller |
|---------|---------|---------|------------------|
| `ALEAdapter` | Atari 2600 | [ALE](https://ale.farama.org) (built on Stella) | no (single player) |
| `MultiAgentALEAdapter` | Atari 2600 | [Multi-Agent-ALE](https://github.com/Farama-Foundation/Multi-Agent-ALE) (built on Stella) | yes (two player) |

The framework core is console-agnostic. Adding another adapter (NES, Game Boy,
a debugger adapter) does not require redesigning anything.

## Quick start

```bash
uv sync --extra dev                 # install runtime + dev deps

# Inspect the supplied ROM and the adapter's capabilities.
uv run game-lab info roms/surround.bin
uv run game-lab inputs roms/surround.bin

# Run a shipped smoke experiment; print the structured result as JSON.
uv run game-lab run experiments/03-controller-input.json

# Run the whole test suite.
uv run pytest -q
```

The supplied ROM (`roms/surround.bin`, Atari 2600 *Surround*, 1977) is used
**only as a test fixture**. Nothing in the framework encodes its rules.

## Architecture

```
                  AI agent (text-only or vision)
                           |
                  game-lab CLI  /  GameLab API (Python)
                           |
            generic EmulatorInterface  (Capability-driven, console-agnostic)
                           |
                 thin adapter  ──  ALEAdapter  (Atari 2600 / Stella)
                           |
                     ALE / Stella  ──  ROM
```

The dependency direction is strictly inward:

- `controller.py`, `capabilities.py`, `emulator.py`, `framebuffer.py`,
  `memory.py`, `observation.py`, `experiment.py`, `lab.py` know nothing about
  Atari or ALE.
- `adapters/ale_adapter.py` is the **only** place that imports `ale_py`. It
  translates the generic contract into ALE's API.

### Capability-driven, not assumed

Every optional feature is gated behind a `Capability` flag. Adapters declare
what they *actually* support, and the framework raises
`UnsupportedCapability` rather than silently faking behaviour:

```python
from game_lab.capabilities import Capability

caps = lab.capabilities()
if caps & Capability.RAM_ACCESS:
    ram = lab.ram()
if not (caps & Capability.MULTI_CONTROLLER):
    ...  # don't try to drive port 2
```

The ALE adapter supports: load, reset, exact frame stepping, deterministic
replay, single controller, framebuffer, screenshots, save/restore state, RAM
read+write, terminal state, lives, reward, game modes and difficulties. It does
**not** support multi-controller (standard `ale-py` exposes one player port).

For two-player games, the `MultiAgentALEAdapter` (`ale-stella-multi`) is backed
by the Multi-Agent-ALE fork of ALE and drives a joint action vector, so inputs
can target port 1 and port 2 simultaneously:

```bash
uv run game-lab inputs roms/surround.bin --adapter ale-stella-multi
uv run game-lab run experiments/11-two-player.json
```

It automatically selects a two-player game mode when the ROM has one and
advertises `MULTI_CONTROLLER` in its capabilities. Standard single-player
experiments keep working unchanged: pick the adapter per experiment via the
`adapter` field, or override it on the CLI with `--adapter`.

```json
{
  "name": "two-player-ports",
  "adapter": "ale-stella-multi",
  "rom": "roms/surround.bin",
  "steps": [ { "frames": 30, "inputs": { "2": ["UP"] } } ]
}
```

## Inputs (generic, not game-specific)

Inputs are generic buttons, not game actions:

```
UP  DOWN  LEFT  RIGHT  BUTTON_1  BUTTON_2  START  SELECT
```

`ControllerState` is an immutable set of pressed buttons. Adapters map these
onto the real controller. For Atari, `BUTTON_1` is the joystick fire button and
diagonals are expressed as combinations (e.g. `UP` + `RIGHT`). Advertise the
available buttons with `game-lab inputs <rom>`.

## Experiments

An experiment is a small JSON recipe: reset (or not), optionally run `setup`
steps to reach a known state, save a checkpoint, then run `steps` that apply
inputs for exact frame counts and record structured observations.

```json
{
  "name": "input-test",
  "rom": "roms/surround.bin",
  "reset": true,
  "steps": [
    { "frames": 30, "inputs": { "1": ["RIGHT"] } },
    { "frames": 20, "inputs": { "1": ["DOWN"] }, "screenshot": "after-down.png" }
  ]
}
```

Run it:

```bash
uv run game-lab run experiments/my-experiment.json -o result.json
```

### Step fields

| field | meaning |
|-------|---------|
| `adapter` | registered adapter name (`ale-stella` default, `ale-stella-multi` for two-player); the CLI builds the adapter from it unless `--adapter` overrides |
| `frames` | number of emulator frames to advance (>= 1) |
| `inputs` | `{ "port": ["BUTTON", ...] }`; omit a port to release it |
| `ram_writes` | `[{ "address": N, "value": N }]` applied at the start of the step (after any `restore_state` of the same step), before frames advance |
| `observe` | record a structured observation after the step (default true) |
| `observe_per_frame` | also record one observation per emulator frame |
| `screenshot` | save a 1:1 PNG (relative paths go under the run's output dir) |
| `save_state` | save the emulator state under this name for later restore |
| `restore_state` | restore a previously-saved named state before this step |

### Reaching a state and branching

This is the core of controlled experimentation — change only one variable:

```json
{
  "name": "branch",
  "reset": true,
  "setup": [ { "frames": 40, "inputs": { "1": ["RIGHT"] } } ],
  "save_state_after_setup": "branch_point",
  "steps": [
    { "frames": 25, "inputs": { "1": ["UP"]   }, "restore_state": "branch_point" },
    { "frames": 25, "inputs": { "1": ["DOWN"] }, "restore_state": "branch_point" }
  ]
}
```

Both steps branch from the identical frame; their observations describe the
effect of that single input difference. See `experiments/06-save-restore-branch.json`.
Ready-made experiments: `experiments/09-probe-directions.json` runs the full
input-effectiveness sweep below; `experiments/10-score-hunt.json` reproduces
the score-address hunt from the RE guide (glyph fingerprints + ram_watch).

### Probing inputs automatically

The most common reverse-engineering question — "does holding this input change
anything?" — is answered by a **probe**: run the same state once per input
variant and report where each variant first diverges from the baseline.

```json
{
  "name": "probe-directions",
  "rom": "roms/surround.bin",
  "reset": true,
  "ram_watch": [110, 115],
  "steps": [ { "frames": 14, "inputs": {} } ],
  "probes": [
    {
      "name": "directions",
      "frames": 42,
      "inputs": [
        {},
        { "1": ["UP"] },
        { "1": ["DOWN"] },
        { "1": ["LEFT"] },
        { "1": ["RIGHT"] },
        { "1": ["BUTTON_1"] }
      ]
    }
  ]
}
```

Each variant is re-run from the post-step state and compared frame-by-frame
against the first (baseline) variant. The result lists, per variant:
`fb_divergence_frame` / `ram_divergence_frame` (or null if never) and the RAM
addresses that differ at the first divergence. Requires save-state support;
without it, probes are skipped with a warning.

### Watching a few addresses

`ram_watch: [10, 110]` adds `{address: value}` plus `ram_watch_changed` to every
observation — tracking a handful of addresses without dumping all RAM.
`glyph_regions: [[x, y, w, h]]` adds a glyph extraction of each region: connected
non-background components with a shape fingerprint (sha256), so score digits and
other changing text are trackable without vision.

### Writing RAM ("poke")

Reading RAM tells you which address *is* a thing; writing RAM tells you whether
your candidate address actually *drives* that thing. Any step can apply RAM
writes before its frames advance:

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

The write appears in the next observation's `ram_changes` and `ram_watch`, and
any game state driven by that address changes with it. In the shipped
`experiments/12-ram-poke.json`, writing 5 to address 118 flips the red score
digit's glyph fingerprint — the write-back that confirms the score address
found by pure observation. Requires the adapter's `RAM_WRITE` capability
(`game-lab info <rom>` shows it); adapters without it raise an explicit error.
For quick checks: `game-lab memory poke roms/surround.bin 118 5 --frames 30`
reports `value_before` / `value_after` and whether the value survived.

## Observations

Every observation is a JSON-serializable record. A text-only agent can
reverse-engineer entirely from these fields without ever viewing a PNG:

| field | meaning |
|-------|---------|
| `frame_number`, `episode_frame_number` | absolute and per-episode frame counters |
| `inputs_applied` | the controller state for this sample |
| `framebuffer` | `{width, height, channels, sha256}` |
| `framebuffer_colors` | top-N palette: `[{rgb, count, fraction}, ...]` for reading the screen as text |
| `framebuffer_changed` | true if this frame differs from the previous sample |
| `changed_pixel_count` | how many pixels differ |
| `change_bounding_box` | `[x, y, w, h]` enclosing all changed pixels (or null) |
| `change_regions` | connected-component bounding boxes of changes, largest first |
| `ram` | `{size, sha256}` (plus `{values: [...]}` when `include_ram_values` is set) |
| `ram_changed`, `ram_changed_address_count`, `ram_changed_addresses` | RAM diff vs previous sample |
| `ram_changes` | per-address changes: `[{address, before, after}, ...]` |
| `ram_watch`, `ram_watch_changed` | watched addresses `{addr: value}` (via the experiment's `ram_watch`) + which ones changed |
| `glyph_groups` | per-requested-region glyph extraction (bbox, pixel count, colors, shape fingerprint) for tracking score digits without vision |
| `terminal`, `lives`, `reward` | emulator-facing signals (when supported) |
| `save_state_id`, `screenshot_path` | links to captured artifacts |

Experiments can select game settings before the run via `mode` and
`difficulty`; unsupported values produce a warning rather than a crash.

Regions and addresses are **never** labelled. The framework says "a 8x9 region
at (112,116) changed" and "address 0x70 changed 6 -> 2"; the agent decides what
those mean.

## Frame and memory comparison

Comparison utilities are exposed both programmatically and on the CLI, and work
on standalone files (PNGs / raw RAM dumps) so an agent can compare anything:

```bash
# Compare two screenshots; emits changed pixels, bounding box and regions.
uv run game-lab frame diff a.png b.png

# Read a screenshot's palette as text (top 4 colors + pixel counts).
uv run game-lab frame colors a.png --top 4

# Dump 128 bytes of RAM after 30 frames of RIGHT.
uv run game-lab memory dump roms/surround.bin --frames 30 --inputs RIGHT -o ram_a.bin

# Diff two RAM dumps; emits per-address {address, before, after}.
uv run game-lab memory diff ram_a.bin ram_b.bin

# Diff two experiment results; reports first framebuffer/RAM divergence.
uv run game-lab results compare result-a.json result-b.json
```

Region detection uses `scipy.ndimage.label` (connected components); all pixel
and memory math uses `numpy`.

## Save states

Save/restore is supported via ALE's `cloneSystemState` / `restoreSystemState`,
which capture RAM + CPU + subsystem state. After a restore, stepping the same
inputs reproduces the original run exactly (verified by tests). Branching only
works **within a single running process** — ALE state handles are in-memory and
cannot be serialised to disk. Use an experiment file's `save_state` /
`restore_state` fields to branch within one run.

Note: the Multi-Agent-ALE fork refreshes its screen buffer on the next
`act()`, so after `restore_state` the framebuffer only matches the branch
point once the next frame has been stepped.

## Python API

Everything the CLI does is also a library call:

```python
from game_lab import GameLab, Experiment, ControllerState, Button
from game_lab.adapters import ALEAdapter

lab = GameLab(ALEAdapter(seed=123))
lab.load("roms/surround.bin")
lab.reset()

# Drive directly.
lab.step({1: ControllerState([Button.RIGHT])}, frames=30)
frame = lab.framebuffer()
ram = lab.ram()

# Branch.
handle = lab.save_state()
lab.step({1: ControllerState([Button.UP])}, frames=20)
lab.restore_state(handle)

# Or run a whole experiment.
result = lab.run_experiment(Experiment.from_file("experiments/03-controller-input.json"))
print(result.summary)
print(result.observations[-1].model_dump_json(indent=2))
```

## CLI reference

```text
game-lab info <rom> [--adapter A]    adapter capabilities + ROM metadata (JSON)
game-lab inputs <rom> [--adapter A]  available buttons per controller port (JSON)
game-lab run <experiment.json> [--adapter A]  run an experiment (defaults to the experiment's `adapter` field)
game-lab step <rom> [--frames N]    advance frames, emit one observation (JSON)
game-lab screenshot <rom> -o f.png  capture a 1:1 framebuffer PNG
game-lab frame diff <a.png> <b.png> machine-readable frame diff (JSON)
game-lab frame colors <a.png>       top-N color palette of an image (JSON)
game-lab frame glyphs <a.png>       connected glyphs with shape fingerprints (JSON)
game-lab memory dump <rom> [-o f]   dump RAM as raw bytes + JSON description
game-lab memory poke <rom> <addr> <value> [--frames N]  write RAM, step, report
game-lab memory diff <a.bin> <b.bin> per-address RAM diff (JSON)
game-lab state save <rom>           save a state and emit a descriptor (JSON)
game-lab results compare <a.json> <b.json> first divergence between two runs (JSON)
```

Data commands emit JSON by default so agents can consume them reliably. Run
`game-lab --help` or `game-lab <command> --help` for full options.

## Testing

```bash
uv run pytest -q          # 117 tests, ~5s
```

The suite tests the **framework**, never the game's rules: controller semantics,
framebuffer/memory comparison, experiment schema validation (valid and invalid),
end-to-end execution against the real adapter, deterministic replay, state
branching, CLI commands, and unsupported-capability handling (via a fake adapter
that supports nothing).

## Adding another emulator adapter

Implement `EmulatorInterface` (in `src/game_lab/emulator.py`) and return an
honest `Capability` set + `inputs()` map. That is the entire contract. The
framework, CLI, experiment runner and observation format work unchanged.

Concretely:

1. Create `src/game_lab/adapters/my_adapter.py` with a class subclassing
   `EmulatorInterface`.
2. Implement the abstract methods (`load`, `reset`, `capabilities`, `inputs`,
   `rom_info`, `step`, `frame_number`, `episode_frame_number`,
   `framebuffer_rgb`, `screenshot`, `save_state`, `restore_state`, `ram`).
3. Only claim capabilities you genuinely provide. For unsupported optional
   methods (`is_terminal`, `lives`, modes, ...) the base class already returns
   `None` / raises `UnsupportedCapability`.
4. Wire it into the CLI's `_make_lab` helper (or expose a second entry point).

Two realistic future adapters:

- A **multi-agent ALE** adapter to expose a second controller port (Surround is
  a two-player game). Same interface, additional `MULTI_CONTROLLER` capability.
- A **debug adapter** (e.g. driving standalone Stella's debugger) to add
  6502 instruction stepping, breakpoints and watchpoints — capabilities ALE
  deliberately does not expose.

## Limitations

- ALE is not a debugger: no instruction stepping, breakpoints, or ROM
  disassembly. That would require a separate adapter (e.g. standalone Stella).
- State handles are in-memory only; cross-process state serialisation is not
  supported by ALE.
- Standard `ale-py` is single-player; multi-controller requires a future
  multi-agent adapter.

## Configuration for reverse engineering

The ALE adapter deliberately avoids the reinforcement-learning defaults that
would corrupt controlled experiments:

```python
ALEAdapter(frame_skip=1, repeat_action_probability=0.0)
```

This guarantees the contract `one input -> exactly one emulator frame -> one
observation`, with no stochastic action repetition.
