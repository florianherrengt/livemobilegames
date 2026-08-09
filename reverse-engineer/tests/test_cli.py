"""Tests for the CLI surface and unsupported-capability handling.

CLI tests use typer's CliRunner so they do not require a real subprocess.
Unsupported-capability tests use a tiny in-memory fake adapter so they run
without the emulator at all.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from typer.testing import CliRunner

from game_lab import __version__
from game_lab.capabilities import Capability
from game_lab.cli import app
from game_lab.controller import Button, ControllerState
from game_lab.emulator import (
    EmulatorInterface,
    RomInfo,
    StateHandle,
    StepResult,
    UnsupportedCapability,
)

runner = CliRunner()


# -- unsupported-capability fake adapter -----------------------------------


class _MinimalAdapter(EmulatorInterface):
    """An adapter that supports almost nothing, to exercise capability gates."""

    adapter_name = "fake"
    adapter_version = "0.0.1"
    console = "fake"

    def load(self, rom_path):
        return RomInfo(rom_path=rom_path, adapter=self.adapter_name,
                       adapter_version=self.adapter_version, console=self.console,
                       internal_name=None, md5=None,
                       screen_width=None, screen_height=None, ram_size=None,
                       capabilities=[])

    def reset(self):
        raise UnsupportedCapability(Capability.RESET, self.adapter_name)

    def capabilities(self):
        return Capability.NONE

    def inputs(self):
        return {}

    def rom_info(self):
        return self.load("(none)")

    def step(self, controllers=None, frames=1):
        raise UnsupportedCapability(Capability.FRAME_STEP, self.adapter_name)

    def frame_number(self):
        return 0

    def episode_frame_number(self):
        return 0

    def framebuffer_rgb(self):
        raise UnsupportedCapability(Capability.FRAMEBUFFER, self.adapter_name)

    def screenshot(self, path):
        raise UnsupportedCapability(Capability.SCREENSHOT, self.adapter_name)

    def save_state(self):
        raise UnsupportedCapability(Capability.SAVE_STATE, self.adapter_name)

    def restore_state(self, handle):
        raise UnsupportedCapability(Capability.RESTORE_STATE, self.adapter_name)

    def ram(self):
        raise UnsupportedCapability(Capability.RAM_ACCESS, self.adapter_name)


def test_fake_adapter_admits_no_capabilities():
    a = _MinimalAdapter()
    assert a.capabilities() == Capability.NONE
    assert not a.supports(Capability.FRAME_STEP)


def test_unsupported_step_raises():
    with pytest.raises(UnsupportedCapability):
        _MinimalAdapter().step()


def test_require_helper_raises():
    from game_lab.emulator import EmulatorInterface
    # _require is on the abstract base; exercise via the fake.
    a = _MinimalAdapter()
    with pytest.raises(UnsupportedCapability):
        a._require(Capability.RAM_ACCESS)


# -- CLI tests -------------------------------------------------------------


def test_version_flag():
    res = runner.invoke(app, ["--version"])
    assert res.exit_code == 0
    assert __version__ in res.output


def test_help_lists_commands():
    res = runner.invoke(app, ["--help"])
    assert res.exit_code == 0
    for cmd in ["info", "inputs", "run", "step", "screenshot", "frame", "memory", "state"]:
        assert cmd in res.output


def test_cli_info_emits_json(rom_path):
    res = runner.invoke(app, ["info", rom_path])
    assert res.exit_code == 0, res.output
    data = json.loads(res.output)
    assert data["console"] == "atari2600"
    assert data["ram_size"] == 128
    assert "capabilities" in data
    assert data["inputs"]["1"]


def test_cli_inputs(rom_path):
    res = runner.invoke(app, ["inputs", rom_path])
    assert res.exit_code == 0
    data = json.loads(res.output)
    assert data["ports"]["1"]


def test_cli_run_experiment(tmp_path, experiments_dir):
    exp = experiments_dir / "01-load-and-reset.json"
    out = tmp_path / "result.json"
    res = runner.invoke(app, ["run", str(exp), "--output", str(out), "--quiet"])
    assert res.exit_code == 0, res.output
    assert out.is_file()
    data = json.loads(out.read_text())
    assert data["summary"]["frames_advanced"] >= 1


def test_cli_step(rom_path):
    res = runner.invoke(app, ["step", rom_path, "--frames", "5", "--inputs", "RIGHT"])
    assert res.exit_code == 0, res.output
    data = json.loads(res.output)
    assert data["ram"]["size"] == 128
    assert "sha256" in data["framebuffer"]


def test_cli_screenshot(rom_path, tmp_path):
    out = tmp_path / "shot.png"
    res = runner.invoke(app, ["screenshot", rom_path, "-o", str(out), "--frames", "5"])
    assert res.exit_code == 0, res.output
    assert out.is_file() and out.stat().st_size > 0


def test_cli_memory_dump_and_diff(rom_path, tmp_path):
    a = tmp_path / "ramA.bin"
    b = tmp_path / "ramB.bin"
    res = runner.invoke(app, ["memory", "dump", rom_path, "--frames", "5", "-o", str(a)])
    assert res.exit_code == 0, res.output
    data = json.loads(res.output)
    assert data["size"] == 128
    assert a.is_file()
    # Same dump again -> diff is identical.
    res2 = runner.invoke(app, ["memory", "dump", rom_path, "--frames", "5", "-o", str(b)])
    assert res2.exit_code == 0
    res3 = runner.invoke(app, ["memory", "diff", str(a), str(b)])
    assert res3.exit_code == 0
    assert json.loads(res3.output)["identical"] is True


def test_cli_memory_poke(rom_path):
    res = runner.invoke(app, ["memory", "poke", rom_path, "118", "5", "--frames", "0"])
    assert res.exit_code == 0, res.output
    data = json.loads(res.output)
    assert data["address"] == 118
    assert data["value"] == 5
    assert data["value_before"] == 0
    assert data["value_after"] == 5
    assert data["survived"] is True
    # After 30 frames the value still holds (the game does not clobber it).
    res2 = runner.invoke(app, ["memory", "poke", rom_path, "118", "5", "--frames", "30"])
    assert res2.exit_code == 0, res2.output
    assert json.loads(res2.output)["survived"] is True


def test_cli_frame_diff(tmp_path):
    from PIL import Image
    black = np.zeros((4, 4, 3), dtype=np.uint8)
    white = np.full((4, 4, 3), 255, dtype=np.uint8)
    a = tmp_path / "a.png"; b = tmp_path / "b.png"
    Image.fromarray(black).save(a)
    Image.fromarray(white).save(b)
    res = runner.invoke(app, ["frame", "diff", str(a), str(b)])
    assert res.exit_code == 0, res.output
    data = json.loads(res.output)
    assert data["changed_pixel_count"] == 16
    assert data["identical"] is False
