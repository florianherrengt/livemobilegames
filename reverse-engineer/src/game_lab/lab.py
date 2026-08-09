"""High-level game-lab API.

``GameLab`` is the programmatic entry point that an AI agent (or a test, or a
human) uses to load a ROM, drive the emulator, run experiments, and compare
observations. It wraps any :class:`~game_lab.emulator.EmulatorInterface` and
exposes the framework's full functionality without going through the CLI.

Typical usage::

    from game_lab import GameLab
    from game_lab.adapters import ALEAdapter

    lab = GameLab(ALEAdapter(seed=123))
    lab.load("roms/surround.bin")
    result = lab.run_experiment_file("experiments/01-load-and-reset.json")
    print(result.model_dump_json(indent=2))
"""

from __future__ import annotations

import json
import os
from typing import Optional

import numpy as np

from .controller import ControllerState
from .emulator import EmulatorInterface, RomInfo, StateHandle, StepResult
from .experiment import Experiment, ExperimentResult, ExperimentRunner
from .framebuffer import FrameDiff, diff_frames, describe_frame
from .memory import RamDiff, describe_ram, diff_ram


class GameLab:
    """Convenient facade over an emulator plus the experiment runner."""

    def __init__(self, emulator: EmulatorInterface, *, output_dir: Optional[str] = None) -> None:
        self.emu = emulator
        self._runner = ExperimentRunner(emulator, output_dir=output_dir)

    # -- lifecycle -------------------------------------------------------

    def load(self, rom_path: str) -> RomInfo:
        return self.emu.load(rom_path)

    def reset(self) -> None:
        self.emu.reset()

    # -- introspection ---------------------------------------------------

    def capabilities(self):
        return self.emu.capabilities()

    def inputs(self) -> dict[int, list]:
        return self.emu.inputs()

    def rom_info(self) -> RomInfo:
        return self.emu.rom_info()

    # -- driving ---------------------------------------------------------

    def step(
        self,
        controllers: dict[int, ControllerState] | ControllerState | None = None,
        frames: int = 1,
    ) -> StepResult:
        return self.emu.step(controllers, frames=frames)

    def framebuffer(self) -> np.ndarray:
        return self.emu.framebuffer_rgb()

    def screenshot(self, path: str) -> str:
        return self.emu.screenshot(path)

    def ram(self) -> np.ndarray:
        return self.emu.ram()

    def set_ram(self, address: int, value: int) -> None:
        """Write one byte to RAM. Requires the adapter's RAM_WRITE capability."""
        self.emu.set_ram(address, value)

    # -- state -----------------------------------------------------------

    def save_state(self) -> StateHandle:
        return self.emu.save_state()

    def restore_state(self, handle: StateHandle) -> None:
        self.emu.restore_state(handle)

    # -- experiments -----------------------------------------------------

    def run_experiment(self, experiment: Experiment) -> ExperimentResult:
        return self._runner.run(experiment)

    def run_experiment_file(self, path: str) -> ExperimentResult:
        return self._runner.run(Experiment.from_file(path))

    def run_experiment_json(self, json_str: str) -> ExperimentResult:
        data = json.loads(json_str)
        return self._runner.run(Experiment.model_validate(data))

    # -- comparison utilities -------------------------------------------

    @staticmethod
    def diff_frames(a: np.ndarray, b: np.ndarray, **kwargs) -> FrameDiff:
        return diff_frames(a, b, **kwargs)

    @staticmethod
    def diff_ram(a, b) -> RamDiff:
        return diff_ram(a, b)

    @staticmethod
    def describe_frame(frame: np.ndarray):
        return describe_frame(frame)

    @staticmethod
    def describe_ram(ram):
        return describe_ram(ram)

    # -- result persistence ---------------------------------------------

    @staticmethod
    def save_result(result: ExperimentResult, path: str) -> str:
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(result.model_dump_json(indent=2))
        return path

    @staticmethod
    def compare_results(a: ExperimentResult, b: ExperimentResult) -> dict:
        """Structural diff of two experiment results, aligned by sample index.

        Returns a JSON-friendly dict with:
          - ``summaries``: both run summaries.
          - ``aligned``: whether both runs produced the same number of samples.
          - ``first_framebuffer_divergence``: sample index + frame numbers where
            the screens first differ, or None if never (within sampled frames).
          - ``first_ram_divergence``: sample index + differing addresses
            {address, a, b}, or None if never.
          - ``samples``: per-sample compact rows [sample_index, fb_same, ram_same]
            truncated to the first ``limit`` samples plus the region around the
            first divergence.
        """
        oa, ob = a.observations, b.observations
        aligned = len(oa) == len(ob)
        n = min(len(oa), len(ob))
        limit = 20
        diverged = 0
        rows: list[dict] = []
        fb_first = None
        ram_first = None
        for i in range(n):
            x, y = oa[i], ob[i]
            fb_same = True
            if x.framebuffer is not None and y.framebuffer is not None:
                fb_same = x.framebuffer.sha256 == y.framebuffer.sha256
            ram_same = True
            if x.ram is not None and y.ram is not None:
                ram_same = x.ram.get("sha256") == y.ram.get("sha256")
            if not fb_same and fb_first is None:
                fb_first = {
                    "sample_index": i,
                    "frame_number_a": x.frame_number,
                    "frame_number_b": y.frame_number,
                }
            if not ram_same and ram_first is None:
                ram_first = {
                    "sample_index": i,
                    "frame_number_a": x.frame_number,
                    "frame_number_b": y.frame_number,
                }
            if not (fb_same and ram_same):
                diverged += 1
                if len(rows) < limit:
                    row = {"sample_index": i, "fb_same": fb_same, "ram_same": ram_same}
                    if not fb_same:
                        row["fb_sha_a"] = x.framebuffer.sha256[:12] if x.framebuffer else None
                        row["fb_sha_b"] = y.framebuffer.sha256[:12] if y.framebuffer else None
                    if not ram_same and x.ram_changes and y.ram_changes:
                        row["ram_addresses"] = sorted(
                            {
                                c["address"]
                                for c in (x.ram_changes or []) + (y.ram_changes or [])
                            }
                        )[:12]
                    rows.append(row)
        return {
            "summaries": {
                "a": a.summary.model_dump(),
                "b": b.summary.model_dump(),
            },
            "aligned": aligned,
            "samples_compared": n,
            "samples_diverged": diverged,
            "first_framebuffer_divergence": fb_first,
            "first_ram_divergence": ram_first,
            "samples": rows,
        }
