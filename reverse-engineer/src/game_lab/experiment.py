"""Experiment schema and runner.

An *experiment* is a small, deterministic, JSON-describable recipe that tells
the framework how to drive the emulator. The runner executes it against an
:class:`~game_lab.emulator.EmulatorInterface` and returns a fully structured
:class:`~game_lab.observation.ExperimentResult`.

The schema is intentionally tiny and game-agnostic: it speaks only of frames,
controller ports, generic buttons, save/restore checkpoints, and observations.
"""

from __future__ import annotations

import json
import os
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .capabilities import Capability, describe
from .controller import ControllerState
from .emulator import UnsupportedCapability
from .framebuffer import color_palette, describe_frame, diff_frames, extract_glyphs
from .memory import describe_ram, diff_ram
from .observation import (
    ExperimentResult,
    ExperimentSummary,
    FramebufferSummary,
    Observation,
    ProbeResult,
    ProbeVariant,
)

# Capability flags checked by the runner, pre-extracted for readability.
_CAP_FB = Capability.FRAMEBUFFER
_CAP_RAM = Capability.RAM_ACCESS
_CAP_FN = Capability.FRAME_NUMBER
_CAP_RESET = Capability.RESET
_CAP_TERM = Capability.TERMINAL_STATE
_CAP_LIVES = Capability.LIVES
_CAP_REWARD = Capability.REWARD
_CAP_SAVE = Capability.SAVE_STATE
_CAP_SCREENSHOT = Capability.SCREENSHOT
_CAP_MODES = Capability.MODES
_CAP_DIFF = Capability.DIFFICULTIES
_CAP_RAM_WRITE = Capability.RAM_WRITE


class RamWrite(BaseModel):
    """A single RAM write ("poke") applied at the start of a step."""

    address: int = Field(..., ge=0, description="Byte address to write. "
                          "Bounds are enforced by the adapter's RAM size.")
    value: int = Field(..., ge=0, le=255, description="Byte value to write.")


class ExperimentStep(BaseModel):
    """One segment of an experiment: hold some inputs for some frames."""

    frames: int = Field(..., ge=1, description="Number of emulator frames to advance.")
    inputs: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Controller port (as string, e.g. '1') -> list of generic "
        "buttons held for the whole step. Omit a port to release it.",
    )
    ram_writes: list[RamWrite] = Field(
        default_factory=list,
        description="RAM writes applied at the start of the step, before any "
        "frames advance (and after any restore_state of the same step). "
        "Requires the adapter's RAM_WRITE capability.",
    )
    observe: bool = Field(
        default=True,
        description="If true, record a structured observation after this step.",
    )
    observe_per_frame: bool = Field(
        default=False,
        description="If true, also record one observation per emulator frame "
        "in addition to the per-step observation.",
    )
    screenshot: Optional[str] = Field(
        default=None,
        description="If set, save a PNG to this path after the step. "
        "Relative paths are resolved under the run's output directory.",
    )
    save_state: Optional[str] = Field(
        default=None,
        description="If set, save the emulator state and remember it under this name.",
    )
    restore_state: Optional[str] = Field(
        default=None,
        description="If set, restore a previously-saved named state before this step.",
    )


class Experiment(BaseModel):
    """A complete, runnable experiment."""

    name: str = Field(..., description="Human/agent-readable experiment name.")
    adapter: str = Field(
        default="ale-stella",
        description="Adapter to run this experiment on, by registered name "
        "(e.g. 'ale-stella' single-player, 'ale-stella-multi' two-player). "
        "The CLI constructs the adapter from this field unless overridden.",
    )
    rom: Optional[str] = Field(
        default=None,
        description="Optional ROM path. If omitted, the runner uses the ROM "
        "already loaded on the provided emulator.",
    )
    seed: Optional[int] = Field(
        default=123,
        description="Random seed passed to the adapter (when supported). "
        "Set to null to disable seeding.",
    )
    reset: bool = Field(
        default=True,
        description="If true, reset the emulator before running the steps.",
    )
    setup: list[ExperimentStep] = Field(
        default_factory=list,
        description="Optional steps executed before the main steps, with "
        "observations suppressed. Useful to reach a known state, then branch.",
    )
    save_state_after_setup: Optional[str] = Field(
        default=None,
        description="Save the post-setup state under this name for later restore.",
    )
    restore_state: Optional[str] = Field(
        default=None,
        description="Restore a named state before running the main steps.",
    )
    steps: list[ExperimentStep] = Field(
        default_factory=list,
        description="The main experiment steps, executed in order.",
    )
    framebuffer_connectivity: int = Field(
        default=4,
        description="Connected-component connectivity for change regions: "
        "4 (edge-adjacent) or 8 (also diagonal).",
    )
    mode: Optional[int] = Field(
        default=None,
        description="Game mode to select before running (if the adapter supports modes). "
        "Use game-lab info to list available modes.",
    )
    difficulty: Optional[int] = Field(
        default=None,
        description="Difficulty to select before running (if the adapter supports it).",
    )
    include_ram_values: bool = Field(
        default=False,
        description="If true, include the full RAM value array (not just the hash) "
        "in every observation. Increases output size but lets a text-only agent "
        "read all memory values without a separate dump.",
    )
    ram_watch: Optional[list[int]] = Field(
        default=None,
        description="Addresses to include as {address: value} in every observation "
        "(under ram_watch). Lets an agent track a few addresses without dumping "
        "all RAM. Addresses outside emulated RAM are ignored with a warning.",
    )
    glyph_regions: Optional[list[list[int]]] = Field(
        default=None,
        description="Screen regions [[x, y, w, h], ...] to extract glyphs from in "
        "every observation (under glyph_groups). Glyphs are connected non-"
        "background pixel groups with a shape fingerprint, so score digits and "
        "other changing text are trackable without vision. Regions are clamped "
        "to the framebuffer.",
    )
    probes: list["ProbeSpec"] = Field(
        default_factory=list,
        description="Input sweeps run after the main steps. Each probe re-"
        "branches from the post-step state, runs one variant per input set for "
        "``frames`` frames, and reports when each variant first diverges from "
        "the baseline (empty-input) variant. Requires save-state support.",
    )

    @field_validator("framebuffer_connectivity")
    @classmethod
    def _connectivity_in_4_or_8(cls, v: int) -> int:
        if v not in (4, 8):
            raise ValueError("framebuffer_connectivity must be 4 or 8")
        return v

    @field_validator("ram_watch")
    @classmethod
    def _ram_watch_valid(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        if v is None:
            return None
        if not v:
            raise ValueError("ram_watch must contain at least one address")
        for addr in v:
            if not 0 <= addr <= 0xFFFF:
                raise ValueError(f"ram_watch address {addr} out of range")
        return sorted(set(v))

    @field_validator("glyph_regions")
    @classmethod
    def _glyph_regions_valid(cls, v: Optional[list[list[int]]]) -> Optional[list[list[int]]]:
        if v is None:
            return None
        if not v:
            raise ValueError("glyph_regions must contain at least one region")
        for region in v:
            if len(region) != 4:
                raise ValueError(f"glyph_region must be [x, y, w, h], got {region!r}")
            if any(c < 0 for c in region):
                raise ValueError(f"glyph_region coordinates must be non-negative: {region!r}")
        return v

    @model_validator(mode="after")
    def _check_state_refs(self) -> "Experiment":
        # Validate that every restore_state references a save that happens
        # *before* it. States can be produced by setup steps, by
        # save_state_after_setup, or by an earlier main step's save_state.
        known: set[str] = {s.save_state for s in self.setup if s.save_state}
        if self.save_state_after_setup:
            known.add(self.save_state_after_setup)
        if self.restore_state and self.restore_state not in known:
            raise ValueError(
                f"restore_state {self.restore_state!r} is never saved by "
                f"setup/save_state_after_setup."
            )
        for i, st in enumerate(self.steps):
            if st.save_state:
                known.add(st.save_state)
            if st.restore_state and st.restore_state not in known:
                raise ValueError(
                    f"Step {i} references restore_state {st.restore_state!r} "
                    f"before it is saved (save it in setup, save_state_after_setup, "
                    f"or an earlier step)."
                )
        return self

    @classmethod
    def from_file(cls, path: str) -> "Experiment":
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Experiment file not found: {path}")
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            raise ValueError(f"Experiment file must contain a JSON object, got {type(data).__name__}")
        return cls.model_validate(data)


# ---------------------------------------------------------------------------


class ProbeSpec(BaseModel):
    """A probe: sweep several input sets from one state, branching per variant."""

    name: str = Field(..., description="Probe name; appears in the result.")
    frames: int = Field(..., ge=1, description="Frames to run per variant.")
    inputs: list[dict[str, list[str]]] = Field(
        ...,
        description="One controller-state per variant, e.g. "
        "[{\"1\": [\"UP\"]}, {\"1\": [\"DOWN\"]}]. The first variant is the "
        "baseline; all others are compared against it.",
    )
    include_ram_values: bool = Field(
        default=False,
        description="Include the full RAM value array in each variant's final "
        "observation.",
    )

    @field_validator("inputs")
    @classmethod
    def _inputs_nonempty(cls, v: list[dict[str, list[str]]]) -> list[dict[str, list[str]]]:
        if not v:
            raise ValueError("probe inputs must contain at least one variant")
        return v


class ExperimentRunner:
    """Executes an :class:`Experiment` against an emulator.

    The runner is stateless across runs (it does not cache observations), which
    keeps determinism obvious: same adapter + same seed + same experiment file
    always yields the same structured result (whenever the emulator is itself
    deterministic).
    """

    def __init__(self, emulator, output_dir: Optional[str] = None) -> None:
        self.emu = emulator
        self.output_dir = output_dir

    def run(self, experiment: Experiment) -> ExperimentResult:
        emu = self.emu
        warnings: list[str] = []
        out_dir = self._resolve_output_dir(experiment)

        # Load ROM if specified and not yet loaded, or if a different ROM is requested.
        if experiment.rom:
            emu.load(experiment.rom)

        # Select game mode and difficulty before reset (when the adapter supports it).
        if experiment.mode is not None:
            if emu.supports(_CAP_MODES):
                try:
                    emu.set_mode(experiment.mode)
                except Exception as exc:
                    warnings.append(f"Could not set mode {experiment.mode}: {exc}")
            else:
                warnings.append(f"Adapter does not support mode selection; ignoring mode={experiment.mode}")
        if experiment.difficulty is not None:
            if emu.supports(_CAP_DIFF):
                try:
                    emu.set_difficulty(experiment.difficulty)
                except Exception as exc:
                    warnings.append(f"Could not set difficulty {experiment.difficulty}: {exc}")
            else:
                warnings.append(f"Adapter does not support difficulty selection; ignoring difficulty={experiment.difficulty}")

        if experiment.seed is not None and hasattr(emu, "_seed"):
            # Seed only takes effect at load time for ALE; warn if changed post-load.
            if getattr(emu, "_seed", None) != experiment.seed:
                warnings.append(
                    f"Experiment requests seed {experiment.seed} but adapter was "
                    f"constructed with seed {emu._seed}. Re-load the ROM with the "
                    f"desired seed for full determinism."
                )

        named_states: dict[str, dict] = {}
        screenshots: list[str] = []
        observations: list[Observation] = []
        prev_frame = None
        prev_ram = None
        sample_seq = 0
        def sample(step_index: int, sample_index: int, inputs: dict[int, ControllerState],
                   reward: float, terminal, lives) -> None:
            nonlocal prev_frame, prev_ram, sample_seq
            frame = emu.framebuffer_rgb() if emu.supports(_CAP_FB) else None
            ram = emu.ram() if emu.supports(_CAP_RAM) else None

            fb_summary = None
            fb_colors = None
            fb_changed = False
            changed_px = 0
            bbox = None
            regions: list[list[int]] = []
            if frame is not None:
                fb_summary = _frame_summary(frame)
                fb_colors = color_palette(frame)
                if prev_frame is not None:
                    d = diff_frames(prev_frame, frame,
                                    connectivity=experiment.framebuffer_connectivity)
                    fb_changed = not d.identical
                    changed_px = d.changed_pixel_count
                    bbox = list(d.bounding_box) if d.bounding_box else None
                    regions = [list(r) for r in d.regions]

            ram_summary = None
            ram_changed = None
            ram_changed_count = None
            ram_changed_addrs = None
            ram_changes = None
            ram_watch = None
            ram_watch_changed = None
            if ram is not None:
                info = describe_ram(ram)
                ram_summary = {"size": info.size, "sha256": info.sha256}
                if experiment.include_ram_values:
                    ram_summary["values"] = [int(x) for x in ram]
                if experiment.ram_watch is not None:
                    ram_watch = {str(a): int(ram[a]) for a in experiment.ram_watch}
                if prev_ram is not None:
                    rd = diff_ram(prev_ram, ram)
                    ram_changed = not rd.identical
                    ram_changed_count = rd.changed_address_count
                    ram_changed_addrs = rd.changed_addresses
                    ram_changes = rd.changes
                    if ram_watch is not None:
                        ram_watch_changed = [
                            a for a in experiment.ram_watch
                            if int(ram_watch[str(a)]) != int(prev_ram[a])
                        ] or None

            glyph_groups = None
            if frame is not None and experiment.glyph_regions:
                glyph_groups = []
                for region in experiment.glyph_regions:
                    x, y, w, h = region
                    sub = frame[y : y + h, x : x + w]
                    if sub.size:
                        extracted = extract_glyphs(frame, region=region)
                        extracted["region"] = list(region)
                        glyph_groups.append(extracted)

            obs = Observation(
                step_index=step_index,
                sample_index=sample_index,
                frame_number=emu.frame_number() if emu.supports(_CAP_FN) else sample_seq,
                episode_frame_number=emu.episode_frame_number() if emu.supports(_CAP_FN) else sample_seq,
                inputs_applied=_inputs_to_json(inputs),
                framebuffer=fb_summary,
                framebuffer_colors=fb_colors,
                glyph_groups=glyph_groups,
                framebuffer_changed=fb_changed,
                changed_pixel_count=changed_px,
                change_bounding_box=bbox,
                change_regions=regions,
                ram=ram_summary,
                ram_changed=ram_changed,
                ram_changed_address_count=ram_changed_count,
                ram_changed_addresses=ram_changed_addrs,
                ram_changes=ram_changes,
                ram_watch=ram_watch,
                ram_watch_changed=ram_watch_changed,
                terminal=terminal if emu.supports(_CAP_TERM) else None,
                lives=lives if emu.supports(_CAP_LIVES) else None,
                reward=reward if emu.supports(_CAP_REWARD) else None,
            )
            observations.append(obs)
            sample_seq += 1
            prev_frame = frame.copy() if frame is not None else None
            prev_ram = ram.copy() if ram is not None else None

        # Reset.
        if experiment.reset and emu.supports(_CAP_RESET):
            emu.reset()
            # Establish a baseline frame/RAM *after* reset so the first real
            # sample is compared against the post-reset state.
            if emu.supports(_CAP_FB):
                prev_frame = emu.framebuffer_rgb().copy()
            if emu.supports(_CAP_RAM):
                prev_ram = emu.ram().copy()

        # Setup phase (no observations recorded).
        for st in experiment.setup:
            self._apply_step(emu, st, out_dir, named_states, screenshots)

        if experiment.save_state_after_setup:
            handle = emu.save_state()
            named_states[experiment.save_state_after_setup] = {
                "frame_number": emu.episode_frame_number(),
                "save_state_id": handle.id,
                "handle": handle,
            }

        if experiment.restore_state:
            entry = named_states.get(experiment.restore_state)
            if entry is None:
                raise KeyError(f"restore_state {experiment.restore_state!r} not found")
            emu.restore_state(entry["handle"])
            # Reset change baselines so the first main-step observation is
            # compared against the restored state, not the setup state.
            if emu.supports(_CAP_FB):
                prev_frame = emu.framebuffer_rgb().copy()
            if emu.supports(_CAP_RAM):
                prev_ram = emu.ram().copy()

        # Main steps.
        frames_advanced = 0
        for idx, st in enumerate(experiment.steps):
            if st.restore_state:
                entry = named_states.get(st.restore_state)
                if entry is None:
                    raise KeyError(f"restore_state {st.restore_state!r} not found")
                emu.restore_state(entry["handle"])
                # Reset change baselines to the restored state so the next
                # observation describes the effect of THIS step's inputs only.
                if emu.supports(_CAP_FB):
                    prev_frame = emu.framebuffer_rgb().copy()
                if emu.supports(_CAP_RAM):
                    prev_ram = emu.ram().copy()

            self._apply_ram_writes(emu, st)

            inputs = _parse_inputs(st.inputs)
            reward = 0.0
            terminal = emu.is_terminal() if emu.supports(_CAP_TERM) else None
            lives = emu.lives() if emu.supports(_CAP_LIVES) else None

            # --- Execute the step, recording observations if requested ---
            if st.observe and st.observe_per_frame:
                for f in range(st.frames):
                    r = emu.step(inputs, frames=1)
                    reward += r.reward
                    terminal, lives = r.terminal, r.lives
                    frames_advanced += 1
                    sample(idx, f, inputs, r.reward, terminal, lives)
                # Per-step summary after the per-frame samples, with a distinct
                # sample_index so it doesn't collide with per-frame indices.
                sample(idx, st.frames, inputs, reward, terminal, lives)
            else:
                r = emu.step(inputs, frames=st.frames)
                reward = r.reward
                terminal, lives = r.terminal, r.lives
                frames_advanced += st.frames
                if st.observe:
                    sample(idx, 0, inputs, reward, terminal, lives)

            # --- Side effects: screenshots and save states (independent of observe) ---
            if st.screenshot and emu.supports(_CAP_SCREENSHOT):
                path = os.path.join(out_dir, st.screenshot) if not os.path.isabs(st.screenshot) else st.screenshot
                screenshots.append(emu.screenshot(path))
            if st.save_state and emu.supports(_CAP_SAVE):
                handle = emu.save_state()
                named_states[st.save_state] = {
                    "frame_number": emu.episode_frame_number(),
                    "save_state_id": handle.id,
                    "handle": handle,
                }
                if observations:
                    observations[-1].save_state_id = handle.id

        # --- Probes: sweep inputs from the post-step state -----------------
        probe_results: list[ProbeResult] = []
        if experiment.probes:
            if not emu.supports(_CAP_SAVE):
                warnings.append(
                    "Probes require save-state support; skipping probes."
                )
            else:
                probe_state = emu.save_state()
                for pspec in experiment.probes:
                    probe_results.append(
                        self._run_probe(emu, pspec, experiment, probe_state, warnings)
                    )
                # Restore the post-step state so the summary reflects the
                # main steps, not the last probe variant.
                emu.restore_state(probe_state)

        fb_ever_changed = any(o.framebuffer_changed for o in observations)
        ram_ever_changed = (
            any(o.ram_changed for o in observations if o.ram_changed is not None)
            if emu.supports(_CAP_RAM) else None
        )

        caps = describe(emu.capabilities())
        last = observations[-1] if observations else None

        summary = ExperimentSummary(
            name=experiment.name,
            rom=experiment.rom,
            seed=experiment.seed,
            reset=experiment.reset,
            step_count=len(experiment.steps),
            frames_advanced=frames_advanced,
            final_frame_number=emu.frame_number() if emu.supports(_CAP_FN) else frames_advanced,
            final_episode_frame_number=emu.episode_frame_number() if emu.supports(_CAP_FN) else frames_advanced,
            final_terminal=last.terminal if last else None,
            final_lives=last.lives if last else None,
            framebuffer_ever_changed=fb_ever_changed,
            ram_ever_changed=ram_ever_changed,
        )

        # Strip native handles from the serializable states dict.
        serial_states = {
            name: {"frame_number": v["frame_number"], "save_state_id": v["save_state_id"]}
            for name, v in named_states.items()
        }

        return ExperimentResult(
            experiment=experiment.model_dump(),
            adapter=emu.adapter_name,
            console=emu.console,
            rom=emu.rom_info().rom_path,
            capabilities=caps,
            inputs={str(k): [b.value for b in v] for k, v in emu.inputs().items()},
            summary=summary,
            observations=observations,
            states=serial_states,
            screenshots=screenshots,
            warnings=warnings,
            probes=probe_results,
        )

    # -- helpers --------------------------------------------------------

    def _resolve_output_dir(self, experiment: Experiment) -> str:
        if self.output_dir:
            os.makedirs(self.output_dir, exist_ok=True)
            return self.output_dir
        # Default: a sanitized per-experiment dir under ./runs.
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in experiment.name) or "experiment"
        path = os.path.abspath(os.path.join("runs", safe))
        os.makedirs(path, exist_ok=True)
        return path

    def _apply_ram_writes(self, emu, st: ExperimentStep) -> None:
        """Apply the step's RAM writes, gated on the RAM_WRITE capability."""
        if not st.ram_writes:
            return
        if not emu.supports(_CAP_RAM_WRITE):
            raise UnsupportedCapability(
                _CAP_RAM_WRITE,
                emu.adapter_name,
                "experiment step declares ram_writes",
            )
        for poke in st.ram_writes:
            emu.set_ram(poke.address, poke.value)

    def _apply_step(self, emu, st: ExperimentStep, out_dir: str,
                    named_states: dict, screenshots: list) -> None:
        """Execute a setup step (no observations recorded)."""
        if st.restore_state:
            entry = named_states.get(st.restore_state)
            if entry is None:
                raise KeyError(f"restore_state {st.restore_state!r} not found")
            emu.restore_state(entry["handle"])
        self._apply_ram_writes(emu, st)
        inputs = _parse_inputs(st.inputs)
        emu.step(inputs, frames=st.frames)
        if st.save_state and emu.supports(_CAP_SAVE):
            handle = emu.save_state()
            named_states[st.save_state] = {
                "frame_number": emu.episode_frame_number(),
                "save_state_id": handle.id,
                "handle": handle,
            }
        if st.screenshot and emu.supports(_CAP_SCREENSHOT):
            path = os.path.join(out_dir, st.screenshot) if not os.path.isabs(st.screenshot) else st.screenshot
            screenshots.append(emu.screenshot(path))

    def _run_probe(self, emu, pspec: "ProbeSpec", experiment: Experiment,
                   state_handle, warnings: list[str]) -> ProbeResult:
        """Run a probe: branch from ``state_handle`` once per variant and
        compare each variant's per-frame framebuffer/RAM against the baseline
        (first) variant."""
        fb_ok = emu.supports(_CAP_FB)
        ram_ok = emu.supports(_CAP_RAM)
        variants: list[ProbeVariant] = []
        baselines: dict[str, list] = {"fb": [], "ram": []}

        def _collect_fingerprints(inputs, frames: int) -> tuple[list, list]:
            fb_seq, ram_seq = [], []
            for _ in range(frames):
                emu.step(inputs, frames=1)
                if fb_ok:
                    fb_seq.append(describe_frame(emu.framebuffer_rgb()).sha256)
                if ram_ok:
                    ram_seq.append(describe_ram(emu.ram()).sha256)
            return fb_seq, ram_seq

        for vi, raw_inputs in enumerate(pspec.inputs):
            emu.restore_state(state_handle)
            inputs = _parse_inputs(raw_inputs)
            fb_seq, ram_seq = _collect_fingerprints(inputs, pspec.frames)

            is_baseline = vi == 0
            variant = ProbeVariant(
                inputs={str(k): state.to_list() for k, state in inputs.items()},
                is_baseline=is_baseline,
            )
            if is_baseline:
                baselines["fb"] = fb_seq
                baselines["ram"] = ram_seq
                baseline_inputs = inputs
            else:
                if fb_ok:
                    for fi, (a, b) in enumerate(zip(baselines["fb"], fb_seq)):
                        if a != b:
                            variant.fb_divergence_frame = fi
                            break
                if ram_ok:
                    for fi, (a, b) in enumerate(zip(baselines["ram"], ram_seq)):
                        if a != b:
                            variant.ram_divergence_frame = fi
                            break
                    # Capture the diverging addresses at the first RAM difference.
                    if variant.ram_divergence_frame is not None and ram_ok:
                        emu.restore_state(state_handle)
                        for _ in range(variant.ram_divergence_frame + 1):
                            emu.step(inputs, frames=1)
                        ram_here = emu.ram()
                        emu.restore_state(state_handle)
                        for _ in range(variant.ram_divergence_frame + 1):
                            emu.step(baseline_inputs, frames=1)
                        ram_base = emu.ram()
                        if ram_here is not None and ram_base is not None:
                            rd = diff_ram(ram_base, ram_here)
                            variant.ram_divergence_addresses = [
                                {"address": c["address"], "baseline": c["before"],
                                 "variant": c["after"]}
                                for c in rd.changes
                            ]

            # Final observation for this variant (for palette/glyph context).
            emu.restore_state(state_handle)
            inputs = _parse_inputs(raw_inputs)
            emu.step(inputs, frames=pspec.frames)
            frame = emu.framebuffer_rgb() if fb_ok else None
            ram = emu.ram() if ram_ok else None
            ram_summary = None
            if ram is not None:
                info = describe_ram(ram)
                ram_summary = {"size": info.size, "sha256": info.sha256}
                if pspec.include_ram_values or experiment.include_ram_values:
                    ram_summary["values"] = [int(x) for x in ram]
            variant.final_observation = Observation(
                step_index=0,
                sample_index=0,
                frame_number=emu.frame_number() if emu.supports(_CAP_FN) else vi,
                episode_frame_number=emu.episode_frame_number() if emu.supports(_CAP_FN) else vi,
                inputs_applied={str(k): state.to_list() for k, state in inputs.items()},
                framebuffer=_frame_summary(frame) if frame is not None else None,
                framebuffer_colors=color_palette(frame) if frame is not None else None,
                ram=ram_summary,
                terminal=emu.is_terminal() if emu.supports(_CAP_TERM) else None,
                lives=emu.lives() if emu.supports(_CAP_LIVES) else None,
            )
            variants.append(variant)

        return ProbeResult(name=pspec.name, frames=pspec.frames, variants=variants,
                           warnings=list(warnings))


def _parse_inputs(raw: dict[str, list[str]]) -> dict[int, ControllerState]:
    out: dict[int, ControllerState] = {}
    for port_str, buttons in raw.items():
        try:
            port = int(port_str)
        except ValueError as exc:
            raise ValueError(f"Controller port must be an integer, got {port_str!r}") from exc
        out[port] = ControllerState.from_names(buttons)
    return out


def _inputs_to_json(inputs: dict[int, ControllerState]) -> dict[str, list[str]]:
    return {str(port): state.to_list() for port, state in inputs.items()}


def _frame_summary(frame) -> FramebufferSummary:
    info = describe_frame(frame)
    return FramebufferSummary(
        width=info.width, height=info.height, channels=info.channels, sha256=info.sha256
    )
