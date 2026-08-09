"""Tests for the two-player Multi-Agent-ALE adapter.

These drive the real emulator using the supplied ROM purely as a fixture, in
the same spirit as test_lab.py: assertions cover the framework contract (two
ports advertised, port-2 input reaches the game, determinism, capability
gating), never the game's own rules.
"""

from __future__ import annotations

import numpy as np
import pytest

from game_lab import Button, ControllerState
from game_lab.adapters import MultiAgentALEAdapter, build_adapter
from game_lab.capabilities import Capability
from game_lab.emulator import UnsupportedCapability
from game_lab.lab import GameLab


@pytest.fixture
def multi_lab(rom_path) -> GameLab:
    """A fresh GameLab on the two-player adapter with the ROM loaded."""
    g = GameLab(MultiAgentALEAdapter(seed=123))
    g.load(rom_path)
    return g


def _sha(frame: np.ndarray) -> str:
    import hashlib
    return hashlib.sha256(frame.tobytes()).hexdigest()


# -- capabilities & introspection -----------------------------------------


def test_multi_adapter_reports_multi_controller(multi_lab: GameLab):
    caps = multi_lab.capabilities()
    assert caps & Capability.MULTI_CONTROLLER
    assert caps & Capability.SINGLE_CONTROLLER  # 1-player modes still work
    for required in [
        Capability.LOAD_ROM, Capability.RESET, Capability.FRAME_STEP,
        Capability.FRAME_NUMBER, Capability.DETERMINISTIC, Capability.FRAMEBUFFER,
        Capability.SAVE_STATE, Capability.RESTORE_STATE, Capability.RAM_ACCESS,
        Capability.MODES,
    ]:
        assert caps & required, f"missing required capability {required.name}"


def test_multi_inputs_two_ports(multi_lab: GameLab):
    inputs = multi_lab.inputs()
    assert set(inputs) == {1, 2}
    p1, p2 = set(inputs[1]), set(inputs[2])
    assert p1 == p2 == {b for b in inputs[1]}


def test_multi_rom_info_records_adapter(multi_lab: GameLab):
    info = multi_lab.rom_info()
    assert info.adapter == "ale-stella-multi"
    assert info.ram_size == 128
    assert "MULTI_CONTROLLER" in info.capabilities


# -- input delivery -------------------------------------------------------


def test_multi_port2_input_reaches_the_game(rom_path):
    """Port-2 input must change *something* observable in the game.

    Mechanical delivery check only: the two runs differ in exactly one
    variable (port-2 joystick), so any framebuffer difference proves the
    input was delivered to the second player port.
    """
    def run(port2_buttons):
        lab = GameLab(MultiAgentALEAdapter(seed=123))
        lab.load(rom_path)
        lab.reset()
        lab.step({1: ControllerState.empty(), 2: ControllerState(port2_buttons)},
                 frames=30)
        return _sha(lab.framebuffer())

    baseline = run([])
    with_up = run([Button.UP])
    assert with_up != baseline


def test_multi_baseline_is_deterministic(rom_path):
    def run():
        lab = GameLab(MultiAgentALEAdapter(seed=123))
        lab.load(rom_path)
        lab.reset()
        lab.step({1: ControllerState.empty(), 2: ControllerState.empty()}, frames=30)
        return _sha(lab.framebuffer())

    assert run() == run()


def test_multi_invalid_port_raises(multi_lab: GameLab):
    with pytest.raises(UnsupportedCapability):
        multi_lab.step({3: ControllerState.empty()}, frames=1)


def test_multi_bare_state_is_port1(multi_lab: GameLab):
    # A bare ControllerState is shorthand for port 1, like the single adapter.
    before = multi_lab.emu.episode_frame_number()
    multi_lab.step(ControllerState.empty(), frames=5)
    assert multi_lab.emu.episode_frame_number() == before + 5


# -- state & memory -------------------------------------------------------


def test_multi_save_state_replays_exactly(multi_lab: GameLab):
    """Save -> restore -> replay same inputs must reproduce, and different
    inputs must diverge.

    The multi-agent fork restores the emulator state but refreshes its screen
    buffer on the next act(), so replay is compared after stepping -- the
    same contract the single-player save/restore tests assert.
    """
    multi_lab.reset()
    multi_lab.step({1: ControllerState.empty(), 2: ControllerState.empty()}, frames=10)
    handle = multi_lab.save_state()
    branch_frame = multi_lab.emu.episode_frame_number()

    multi_lab.restore_state(handle)
    assert multi_lab.emu.episode_frame_number() == branch_frame
    multi_lab.step({1: ControllerState.empty(), 2: ControllerState([Button.UP])},
                   frames=20)
    ram_a = multi_lab.ram().copy()
    fb_a = _sha(multi_lab.framebuffer())

    multi_lab.restore_state(handle)
    multi_lab.step({1: ControllerState.empty(), 2: ControllerState([Button.UP])},
                   frames=20)
    assert np.array_equal(ram_a, multi_lab.ram())
    assert _sha(multi_lab.framebuffer()) == fb_a

    multi_lab.restore_state(handle)
    multi_lab.step({1: ControllerState.empty(), 2: ControllerState([Button.DOWN])},
                   frames=20)
    assert not np.array_equal(ram_a, multi_lab.ram())


def test_multi_ram_round_trip(multi_lab: GameLab):
    multi_lab.reset()
    ram = multi_lab.ram()
    assert ram.shape == (128,)
    assert ram.dtype == np.uint8


def test_multi_ram_write_applied(rom_path):
    """RAM poke works on the two-player adapter.

    The multi-agent-ale-py wheel ships a broken ctypes declaration for setRAM;
    the adapter heals it. This test would otherwise read back garbage at the
    target address (e.g. identical bytes across all of RAM).
    """
    from game_lab import Experiment
    exp = Experiment(
        name="poke-multi",
        adapter="ale-stella-multi",
        rom=str(rom_path),
        reset=True,
        ram_watch=[118],
        steps=[{"frames": 5, "inputs": {},
                "ram_writes": [{"address": 118, "value": 9}]}],
    )
    r = GameLab(MultiAgentALEAdapter(seed=123)).run_experiment(exp)
    assert r.observations[0].ram_watch == {"118": 9}
    assert {"address": 118, "before": 0, "after": 9} in r.observations[0].ram_changes


# -- experiments & registry -----------------------------------------------


def test_multi_experiment_records_adapter(rom_path):
    from game_lab import Experiment
    exp = Experiment(
        name="multi-smoke",
        adapter="ale-stella-multi",
        rom=str(rom_path),
        reset=True,
        steps=[{"frames": 5, "inputs": {"2": ["UP"]}}],
    )
    lab = GameLab(MultiAgentALEAdapter(seed=123))
    result = lab.run_experiment(exp)
    assert result.adapter == "ale-stella-multi"
    assert result.summary.frames_advanced == 5
    # The experiment definition round-trips its adapter declaration.
    assert result.experiment["adapter"] == "ale-stella-multi"


def test_experiment_adapter_field_defaults_to_single():
    from game_lab import Experiment
    assert Experiment(name="x").adapter == "ale-stella"
    assert Experiment(name="x", adapter="ale-stella-multi").adapter == "ale-stella-multi"


def test_build_adapter_registry():
    emu = build_adapter("ale-stella-multi", seed=7)
    assert isinstance(emu, MultiAgentALEAdapter)
    with pytest.raises(ValueError):
        build_adapter("no-such-adapter")


def test_multi_probe_reports_port2_divergence(rom_path):
    """Probes branch per variant and must report port-2 divergence."""
    from game_lab import Experiment
    exp = Experiment(
        name="probe-multi",
        adapter="ale-stella-multi",
        rom=str(rom_path),
        reset=True,
        steps=[{"frames": 14, "inputs": {}}],
        probes=[
            {
                "name": "p2",
                "frames": 20,
                "inputs": [{}, {"2": ["UP"]}],
            }
        ],
    )
    lab = GameLab(MultiAgentALEAdapter(seed=123))
    result = lab.run_experiment(exp)
    probe = result.probes[0]
    assert probe.variants[0].is_baseline
    variant = probe.variants[1]
    assert variant.inputs == {"2": ["UP"]}
    # The input lands in RAM immediately, but Surround blocks can only turn
    # once they reach the end of their current leg, so the first *visible*
    # framebuffer change trails the RAM write. Both divergences must exist.
    assert variant.ram_divergence_frame == 0
    assert variant.fb_divergence_frame is not None
    assert variant.ram_divergence_addresses
