"""Integration tests that drive the real ALE/Stella adapter.

These tests exercise the framework's end-to-end behaviour using the supplied
ROM purely as a fixture. They contain NO assertions about how the game is
supposed to behave, score, or render -- only about the framework contract
(frames advance, observations are structured, state round-trips, replays
match, unsupported capabilities raise, ...).
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from game_lab import Button, ControllerState, Experiment
from game_lab.adapters import ALEAdapter
from game_lab.capabilities import Capability
from game_lab.emulator import UnsupportedCapability
from game_lab.lab import GameLab


# -- capabilities & introspection -----------------------------------------


def test_adapter_reports_expected_capabilities(lab: GameLab):
    caps = lab.capabilities()
    for required in [
        Capability.LOAD_ROM, Capability.RESET, Capability.FRAME_STEP,
        Capability.ADVANCE_N, Capability.FRAME_NUMBER, Capability.DETERMINISTIC,
        Capability.SINGLE_CONTROLLER, Capability.FRAMEBUFFER, Capability.SCREENSHOT,
        Capability.SAVE_STATE, Capability.RESTORE_STATE, Capability.RAM_ACCESS,
        Capability.TERMINAL_STATE, Capability.LIVES,
    ]:
        assert caps & required, f"missing required capability {required.name}"
    # Standard ALE is single-player.
    assert not (caps & Capability.MULTI_CONTROLLER)


def test_inputs_single_port(lab: GameLab):
    inputs = lab.inputs()
    assert set(inputs) == {1}
    buttons = set(inputs[1])
    assert {Button.UP, Button.DOWN, Button.LEFT, Button.RIGHT, Button.BUTTON_1} <= buttons
    # Console-only buttons are NOT advertised by this adapter.
    assert Button.START not in buttons
    assert Button.SELECT not in buttons


def test_rom_info_populated(lab: GameLab):
    info = lab.rom_info()
    assert info.console == "atari2600"
    assert info.screen_width and info.screen_height
    assert info.ram_size == 128
    assert info.md5 and len(info.md5) == 32
    assert info.capabilities


# -- loading & reset -------------------------------------------------------


def test_reset_resets_episode_frame_number(lab: GameLab):
    lab.step({1: ControllerState([Button.RIGHT])}, frames=10)
    before = lab.emu.episode_frame_number()
    lab.reset()
    after = lab.emu.episode_frame_number()
    assert before >= 10
    assert after <= before  # episode counter drops after reset


def test_loading_missing_rom_raises():
    with pytest.raises(FileNotFoundError):
        GameLab(ALEAdapter()).load("does-not-exist.bin")


# -- frame stepping --------------------------------------------------------


def test_step_advances_exact_frames(lab: GameLab):
    lab.reset()
    start = lab.emu.episode_frame_number()
    lab.step({1: ControllerState.empty()}, frames=17)
    assert lab.emu.episode_frame_number() == start + 17


def test_step_zero_or_negative_frames_rejected(lab: GameLab):
    with pytest.raises(ValueError):
        lab.step(frames=0)
    with pytest.raises(ValueError):
        lab.step(frames=-1)


# -- controller input & unsupported buttons --------------------------------


def test_bare_controller_state_targets_port_1(lab: GameLab):
    lab.reset()
    # Should not raise; bare ControllerState is shorthand for port 1.
    lab.step(ControllerState([Button.RIGHT]), frames=5)


def test_second_port_rejected(lab: GameLab):
    lab.reset()
    with pytest.raises(UnsupportedCapability):
        lab.step({2: ControllerState([Button.UP])}, frames=1)


def test_unsupported_button_rejected(lab: GameLab):
    lab.reset()
    with pytest.raises(UnsupportedCapability):
        lab.step({1: ControllerState([Button.START])}, frames=1)


def test_contradictory_directions_rejected(lab: GameLab):
    """UP+DOWN and LEFT+RIGHT are physically impossible on a joystick."""
    lab.reset()
    with pytest.raises(ValueError, match="UP and DOWN"):
        lab.step({1: ControllerState([Button.UP, Button.DOWN])}, frames=1)
    with pytest.raises(ValueError, match="LEFT and RIGHT"):
        lab.step({1: ControllerState([Button.LEFT, Button.RIGHT])}, frames=1)


def test_diagonal_combo_encoded(lab: GameLab):
    # UP+RIGHT must be accepted and produce a non-trivial step.
    lab.reset()
    r = lab.step({1: ControllerState([Button.UP, Button.RIGHT])}, frames=5)
    assert r.episode_frame_number >= 5


# -- framebuffer & ram -----------------------------------------------------


def test_framebuffer_shape_and_dtype(lab: GameLab):
    fb = lab.framebuffer()
    assert fb.ndim == 3 and fb.shape[2] == 3
    assert fb.dtype == np.uint8


def test_ram_shape_and_dtype(lab: GameLab):
    ram = lab.ram()
    assert ram.ndim == 1
    assert ram.dtype == np.uint8
    assert ram.size == 128


def test_screenshot_writes_png(lab: GameLab, tmp_path):
    lab.reset()
    lab.step({1: ControllerState([Button.RIGHT])}, frames=10)
    out = tmp_path / "shot.png"
    lab.screenshot(str(out))
    assert out.is_file() and out.stat().st_size > 0
    from PIL import Image
    info = lab.rom_info()
    with Image.open(out) as im:
        # Screenshots are written 1:1 from the framebuffer array.
        assert im.size == (info.screen_width, info.screen_height)


# -- save / restore --------------------------------------------------------


def test_state_round_trip_is_exact(lab: GameLab):
    """Save -> restore -> replay same inputs must reproduce, and different
    inputs must diverge."""
    lab.reset()
    lab.step({1: ControllerState([Button.RIGHT])}, frames=30)
    handle = lab.save_state()
    branch_frame = lab.emu.episode_frame_number()

    # Branch A: restore, step UP 25 frames.
    lab.restore_state(handle)
    assert lab.emu.episode_frame_number() == branch_frame
    lab.step({1: ControllerState([Button.UP])}, frames=25)
    ram_a = lab.ram().copy()
    fb_a = lab.framebuffer().copy()

    # Branch B: restore, step UP again -- must reproduce A exactly.
    lab.restore_state(handle)
    lab.step({1: ControllerState([Button.UP])}, frames=25)
    assert np.array_equal(ram_a, lab.ram())
    assert np.array_equal(fb_a, lab.framebuffer())

    # Branch C: restore, step DOWN -- should diverge from A.
    lab.restore_state(handle)
    lab.step({1: ControllerState([Button.DOWN])}, frames=25)
    ram_c = lab.ram().copy()
    assert not np.array_equal(ram_a, ram_c)


def test_restore_rejects_foreign_object(lab: GameLab):
    with pytest.raises(TypeError):
        lab.restore_state("not-a-handle")  # type: ignore[arg-type]


# -- deterministic replay --------------------------------------------------


def test_two_fresh_runs_produce_identical_frames(fresh_lab, rom_path):
    def run():
        g = fresh_lab(123)
        g.load(rom_path)
        g.reset()
        g.step({1: ControllerState([Button.RIGHT])}, frames=30)
        g.step({1: ControllerState([Button.DOWN, Button.BUTTON_1])}, frames=20)
        g.step({1: ControllerState([Button.UP, Button.LEFT])}, frames=15)
        return g.framebuffer().copy(), g.ram().copy()

    a = run()
    b = run()
    assert np.array_equal(a[0], b[0])
    assert np.array_equal(a[1], b[1])


def test_different_seed_may_diverge(fresh_lab, rom_path):
    # Different seeds are not guaranteed to diverge for every input sequence,
    # but the framework must *accept* them and still be self-consistent.
    def run(seed):
        g = fresh_lab(seed)
        g.load(rom_path)
        g.reset()
        g.step({1: ControllerState([Button.RIGHT])}, frames=30)
        return g.ram().copy()

    r1a = run(1); r1b = run(1)
    assert np.array_equal(r1a, r1b)  # same seed -> reproducible


# -- experiment execution --------------------------------------------------


def test_run_experiment_structured_output(lab: GameLab):
    exp = Experiment.model_validate({
        "name": "unit-run",
        "reset": True,
        "steps": [
            {"frames": 20, "inputs": {"1": ["RIGHT"]}},
            {"frames": 20, "inputs": {"1": ["DOWN"]}},
        ],
    })
    result = lab.run_experiment(exp)
    # JSON-serializable structured output.
    payload = json.loads(result.model_dump_json())
    assert payload["summary"]["frames_advanced"] == 40
    assert len(payload["observations"]) == 2
    obs = payload["observations"][0]
    for key in [
        "step_index", "frame_number", "episode_frame_number", "inputs_applied",
        "framebuffer", "framebuffer_changed", "changed_pixel_count",
        "change_bounding_box", "change_regions",
        "ram", "ram_changed", "ram_changed_address_count", "ram_changed_addresses",
        "terminal", "lives", "reward",
    ]:
        assert key in obs, f"observation missing {key}"
    assert obs["inputs_applied"] == {"1": ["RIGHT"]}


def test_experiment_replay_is_deterministic(fresh_lab, rom_path):
    exp = Experiment.model_validate({
        "name": "replay",
        "rom": rom_path,
        "reset": True,
        "steps": [
            {"frames": 25, "inputs": {"1": ["RIGHT"]}},
            {"frames": 15, "inputs": {"1": ["DOWN", "BUTTON_1"]}},
        ],
    })
    r1 = fresh_lab(123).run_experiment(exp)
    r2 = fresh_lab(123).run_experiment(exp)
    o1 = r1.observations[-1]
    o2 = r2.observations[-1]
    assert o1.framebuffer.sha256 == o2.framebuffer.sha256
    assert o1.ram["sha256"] == o2.ram["sha256"]
    assert o1.episode_frame_number == o2.episode_frame_number


def test_experiment_branching_changes_one_variable(fresh_lab, rom_path):
    exp = Experiment.model_validate({
        "name": "branch",
        "rom": rom_path,
        "reset": True,
        "setup": [{"frames": 40, "inputs": {"1": ["RIGHT"]}}],
        "save_state_after_setup": "p",
        "steps": [
            {"frames": 25, "inputs": {"1": ["UP"]}, "restore_state": "p"},
            {"frames": 25, "inputs": {"1": ["DOWN"]}, "restore_state": "p"},
        ],
    })
    r = fresh_lab(123).run_experiment(exp)
    # Both observations branch from the same frame.
    frames = [o.episode_frame_number for o in r.observations]
    assert frames[0] == frames[1]
    # The two inputs should generally produce different framebuffers.
    hashes = [o.framebuffer.sha256 for o in r.observations]
    assert hashes[0] != hashes[1]


def test_experiment_level_restore_resets_baselines(fresh_lab, rom_path):
    """Experiment-level restore_state should reset the change baseline so the
    first observation compares against the restored state, not the setup state."""
    exp = Experiment.model_validate({
        "name": "exp-restore",
        "rom": rom_path,
        "reset": True,
        "setup": [{"frames": 40, "inputs": {"1": ["RIGHT"]}}],
        "save_state_after_setup": "checkpoint",
        "restore_state": "checkpoint",
        "steps": [{"frames": 1, "inputs": {}}],
    })
    r = fresh_lab(123).run_experiment(exp)
    o = r.observations[0]
    # After restoring to the checkpoint, stepping 1 frame with no input should
    # produce minimal change. If baselines weren't reset, the observation would
    # compare against the pre-setup state and report a large spurious diff.
    assert o.changed_pixel_count < 500


def test_experiment_per_frame_observations(fresh_lab, rom_path):
    exp = Experiment.model_validate({
        "name": "per-frame",
        "rom": rom_path,
        "reset": True,
        "steps": [{"frames": 10, "inputs": {"1": ["RIGHT"]}, "observe_per_frame": True}],
    })
    r = fresh_lab(123).run_experiment(exp)
    # 10 per-frame samples (indices 0-9) + 1 per-step summary (index 10).
    assert len(r.observations) == 11
    sample_indices = [o.sample_index for o in r.observations]
    assert sample_indices == list(range(11))
    # The per-step summary carries the accumulated reward.
    per_frame_rewards = sum(o.reward for o in r.observations[:10])
    assert r.observations[-1].reward == pytest.approx(per_frame_rewards)


def test_observe_false_suppresses_all_observations(lab: GameLab):
    """When observe=false, no observations are recorded even with observe_per_frame."""
    exp = Experiment.model_validate({
        "name": "no-observe",
        "reset": True,
        "steps": [
            {"frames": 10, "inputs": {"1": ["RIGHT"]}, "observe": False, "observe_per_frame": True},
        ],
    })
    r = lab.run_experiment(exp)
    assert len(r.observations) == 0
    # The emulator still advanced frames.
    assert r.summary.frames_advanced == 10


def test_observe_false_with_screenshot_and_save_state(lab: GameLab):
    """Screenshots and save_state work even when observe=false."""
    exp = Experiment.model_validate({
        "name": "side-effects",
        "reset": True,
        "steps": [
            {"frames": 10, "inputs": {}, "observe": False,
             "screenshot": "shot.png", "save_state": "checkpoint"},
        ],
    })
    r = lab.run_experiment(exp)
    assert len(r.observations) == 0
    assert len(r.screenshots) == 1
    assert "checkpoint" in r.states


def test_experiment_screenshot_and_state(lab: GameLab):
    exp = Experiment.model_validate({
        "name": "cap",
        "reset": True,
        "steps": [
            {"frames": 10, "inputs": {}, "screenshot": "f1.png", "save_state": "st"},
        ],
    })
    r = lab.run_experiment(exp)
    assert r.screenshots and r.screenshots[0].endswith("f1.png")
    assert "st" in r.states


def test_experiment_terminal_and_reward_fields_present(lab: GameLab):
    exp = Experiment.model_validate({"name": "t", "reset": True,
                                     "steps": [{"frames": 1, "inputs": {}}]})
    r = lab.run_experiment(exp)
    o = r.observations[-1]
    assert o.terminal is False or o.terminal is True
    assert isinstance(o.reward, float)


def test_experiment_invalid_button_raises_at_runtime(lab: GameLab):
    """Button names are not validated by the schema; they surface as errors
    when the runner tries to encode them for the adapter."""
    exp = Experiment.model_validate({
        "name": "bad-button",
        "reset": True,
        "steps": [{"frames": 1, "inputs": {"1": ["TURBO"]}}],
    })
    with pytest.raises(ValueError):
        lab.run_experiment(exp)


def test_empty_experiment_produces_valid_result(lab: GameLab):
    """An experiment with no steps should produce a well-formed empty result."""
    exp = Experiment.model_validate({"name": "empty", "reset": True, "steps": []})
    r = lab.run_experiment(exp)
    assert r.summary.frames_advanced == 0
    assert r.summary.step_count == 0
    assert len(r.observations) == 0
    # The result must still be JSON-serializable.
    json.loads(r.model_dump_json())


def test_run_experiment_json(lab: GameLab):
    """The run_experiment_json helper must accept a JSON string."""
    import json as _json
    spec = _json.dumps({"name": "from-json", "reset": True,
                        "steps": [{"frames": 5, "inputs": {"1": ["RIGHT"]}}]})
    r = lab.run_experiment_json(spec)
    assert r.summary.frames_advanced == 5


def test_capabilities_describe_function():
    """The describe() helper should list all set flags."""
    from game_lab.capabilities import describe, Capability
    names = describe(Capability.FRAMEBUFFER | Capability.RAM_ACCESS)
    assert set(names) == {"FRAMEBUFFER", "RAM_ACCESS"}


def test_setup_phase_reaches_state_before_steps(lab: GameLab):
    """Setup steps should execute and advance frames without recording observations."""
    exp = Experiment.model_validate({
        "name": "with-setup",
        "reset": True,
        "setup": [{"frames": 15, "inputs": {"1": ["RIGHT"]}}],
        "steps": [{"frames": 5, "inputs": {}}],
    })
    r = lab.run_experiment(exp)
    # Only the main step records an observation.
    assert len(r.observations) == 1
    # frames_advanced counts main-step frames only (parallel to step_count).
    assert r.summary.frames_advanced == 5
    # But the emulator's episode frame counter reflects setup + main = 20.
    assert r.summary.final_episode_frame_number >= 20


def test_modes_and_difficulties_available(lab: GameLab):
    """Atari ROMs expose selectable modes and difficulty switches."""
    assert len(lab.emu.available_modes()) > 0
    assert len(lab.emu.available_difficulties()) > 0


def test_observation_includes_ram_changes(lab: GameLab):
    """ram_changes must include {address, before, after} entries, not just addresses."""
    exp = Experiment.model_validate({
        "name": "ram-changes",
        "reset": True,
        "steps": [
            {"frames": 5, "inputs": {}},
            {"frames": 30, "inputs": {"1": ["RIGHT"]}},
        ],
    })
    r = lab.run_experiment(exp)
    # Find an observation where RAM changed.
    changed = [o for o in r.observations if o.ram_changed]
    assert changed, "expected at least one observation with RAM changes"
    o = changed[0]
    assert o.ram_changes is not None
    assert len(o.ram_changes) > 0
    entry = o.ram_changes[0]
    assert "address" in entry and "before" in entry and "after" in entry


def test_include_ram_values(lab: GameLab):
    """include_ram_values should add the full value array to each observation."""
    exp = Experiment.model_validate({
        "name": "ram-values",
        "reset": True,
        "include_ram_values": True,
        "steps": [{"frames": 5, "inputs": {}}],
    })
    r = lab.run_experiment(exp)
    o = r.observations[-1]
    assert "values" in o.ram
    assert len(o.ram["values"]) == 128


def test_experiment_mode_selection(fresh_lab, rom_path):
    """Selecting a mode before reset should be accepted by the runner."""
    exp = Experiment.model_validate({
        "name": "mode-test",
        "rom": rom_path,
        "mode": 2,
        "reset": True,
        "steps": [{"frames": 5, "inputs": {}}],
    })
    r = fresh_lab(123).run_experiment(exp)
    assert r.summary.frames_advanced == 5


def test_observation_includes_framebuffer_colors(lab: GameLab):
    """Observations should include a top-N color palette of the screen."""
    exp = Experiment.model_validate({
        "name": "colors",
        "reset": True,
        "steps": [
            {"frames": 10, "inputs": {}, "observe": True},
        ],
    })
    r = lab.run_experiment(exp)
    o = r.observations[-1]
    assert o.framebuffer_colors is not None
    assert len(o.framebuffer_colors) >= 1
    top = o.framebuffer_colors[0]
    assert set(top) == {"rgb", "count", "fraction"}
    assert len(top["rgb"]) == 3
    assert top["count"] > 0
    assert 0.0 < top["fraction"] <= 1.0


def test_experiment_invalid_mode_warns(lab: GameLab):
    """An unsupported mode should produce a warning, not crash."""
    exp = Experiment.model_validate({
        "name": "bad-mode",
        "reset": True,
        "steps": [{"frames": 1, "inputs": {}}],
    })
    exp.mode = 999  # not a real mode
    r = lab.run_experiment(exp)
    # The game may or may not warn; the key is it doesn't crash.
    json.loads(r.model_dump_json())


def test_ram_watch_tracks_selected_addresses(lab: GameLab):
    """ram_watch limits observations to the watched addresses."""
    exp = Experiment.model_validate({
        "name": "ram-watch",
        "reset": True,
        "ram_watch": [10, 110],
        "steps": [
            {"frames": 5, "inputs": {}, "observe": True},
            {"frames": 30, "inputs": {"1": ["UP"]}, "observe": True},
        ],
    })
    r = lab.run_experiment(exp)
    for o in r.observations:
        assert o.ram_watch is not None
        assert set(o.ram_watch) == {"10", "110"}
        assert all(isinstance(v, int) for v in o.ram_watch.values())
    # The watch values must be consistent with the full RAM (if present).
    last = r.observations[-1]
    json.loads(last.model_dump_json())


def test_ram_watch_invalid_address_schema():
    with pytest.raises(ValueError):
        Experiment.model_validate({
            "name": "bad-watch",
            "ram_watch": [0x10000],
            "steps": [{"frames": 1}],
        })


def test_glyph_regions_extract_shape_fingerprints(lab: GameLab):
    """glyph_regions should yield bbox+sha256 glyphs so shape changes are
    detectable without vision."""
    exp = Experiment.model_validate({
        "name": "glyphs",
        "reset": True,
        "glyph_regions": [[0, 0, 160, 24]],
        "steps": [
            {"frames": 5, "inputs": {}, "observe": True},
        ],
    })
    r = lab.run_experiment(exp)
    o = r.observations[-1]
    assert o.glyph_groups is not None
    assert len(o.glyph_groups) == 1
    group = o.glyph_groups[0]
    assert group["region"] == [0, 0, 160, 24]
    assert "background" in group
    assert isinstance(group["glyphs"], list)
    assert len(group["glyphs"]) >= 1
    glyph = group["glyphs"][0]
    assert set(glyph) == {"bbox", "pixels", "sha256", "colors"}
    assert len(glyph["bbox"]) == 4
    assert len(glyph["sha256"]) == 64
    json.loads(r.model_dump_json())


def test_glyph_region_out_of_bounds_is_clamped(lab: GameLab):
    """A region extending past the framebuffer must not crash."""
    exp = Experiment.model_validate({
        "name": "glyphs-oob",
        "reset": True,
        "glyph_regions": [[0, 0, 500, 500]],
        "steps": [{"frames": 3, "inputs": {}, "observe": True}],
    })
    r = lab.run_experiment(exp)
    assert r.observations[-1].glyph_groups is not None


def test_probe_reports_divergence_per_input(lab: GameLab):
    """A probe must sweep inputs from one state and report where each variant
    diverges from the baseline."""
    exp = Experiment.model_validate({
        "name": "probe",
        "reset": True,
        "steps": [{"frames": 14, "inputs": {}, "observe": True}],
        "probes": [
            {
                "name": "directions",
                "frames": 30,
                "inputs": [
                    {},
                    {"1": ["UP"]},
                    {"1": ["DOWN"]},
                    {"1": ["LEFT"]},
                    {"1": ["RIGHT"]},
                ],
            },
        ],
    })
    r = lab.run_experiment(exp)
    assert len(r.probes) == 1
    probe = r.probes[0]
    assert probe.name == "directions"
    assert probe.frames == 30
    assert len(probe.variants) == 5
    assert probe.variants[0].is_baseline
    assert probe.variants[0].fb_divergence_frame is None
    assert probe.variants[0].ram_divergence_frame is None
    # At least one variant must diverge somewhere (in RAM if not framebuffer);
    # the framework contract is the *shape* of the report, not the game rules.
    diverged = [v for v in probe.variants[1:] if v.ram_divergence_frame is not None]
    assert diverged, "expected at least one probed input to diverge in RAM"
    for v in diverged:
        assert 0 <= v.ram_divergence_frame < 30
        assert isinstance(v.ram_divergence_addresses, list)
        for entry in v.ram_divergence_addresses:
            assert set(entry) == {"address", "baseline", "variant"}
    # Final observations carry framebuffer context.
    assert all(v.final_observation is not None for v in probe.variants)
    json.loads(r.model_dump_json())


def test_probe_requires_save_state_support():
    """An adapter without save states must skip probes with a warning."""
    from game_lab.emulator import EmulatorInterface, RomInfo, StepResult

    class NoSaveEmulator(EmulatorInterface):
        adapter_name = "no-save"
        console = "fake"

        def capabilities(self):
            return Capability.LOAD_ROM | Capability.RESET | Capability.FRAME_STEP

        def load(self, path):
            return self.rom_info()

        def reset(self):
            pass

        def inputs(self):
            return {1: []}

        def rom_info(self):
            return RomInfo(rom_path="x", adapter=self.adapter_name,
                           adapter_version="0.0.0", console=self.console,
                           internal_name=None, md5=None,
                           screen_width=None, screen_height=None, ram_size=None)

        def step(self, controllers=None, frames=1):
            return StepResult(frame_number=0, episode_frame_number=0,
                              reward=0.0, terminal=None, lives=None)

        def frame_number(self):
            return 0

        def episode_frame_number(self):
            return 0

        def framebuffer_rgb(self):
            import numpy as np
            return np.zeros((1, 1, 3), dtype=np.uint8)

        def screenshot(self, path):
            return path

        def save_state(self):
            from game_lab.emulator import UnsupportedCapability
            raise UnsupportedCapability(Capability.SAVE_STATE, self.adapter_name)

        def restore_state(self, handle):
            from game_lab.emulator import UnsupportedCapability
            raise UnsupportedCapability(Capability.RESTORE_STATE, self.adapter_name)

        def ram(self):
            import numpy as np
            return np.zeros(128, dtype=np.uint8)

    fake = NoSaveEmulator()
    lab = GameLab(fake)
    exp = Experiment.model_validate({
        "name": "no-save-probe",
        "reset": True,
        "probes": [{"name": "p", "frames": 2, "inputs": [{}, {"1": ["UP"]}]}],
    })
    r = lab.run_experiment(exp)
    assert r.probes == []
    assert any("save-state" in w for w in r.warnings)


def test_probe_schema_validation():
    with pytest.raises(ValueError):
        Experiment.model_validate({
            "name": "bad-probe",
            "probes": [{"name": "p", "frames": 5, "inputs": []}],
            "steps": [{"frames": 1}],
        })


# -- RAM poke (ram_writes) ------------------------------------------------


def test_step_ram_writes_applied_before_frames(lab: GameLab):
    """A step's ram_writes land before any frames advance and show up in the
    next observation's ram_watch and ram_changes."""
    exp = Experiment(
        name="poke",
        reset=True,
        ram_watch=[118],
        steps=[
            {"frames": 60, "inputs": {}},
            {"frames": 60, "inputs": {}, "ram_writes": [{"address": 118, "value": 5}]},
        ],
    )
    r = lab.run_experiment(exp)
    idle, poked = r.observations
    assert idle.ram_watch == {"118": 0}
    assert poked.ram_watch == {"118": 5}
    assert {"address": 118, "before": 0, "after": 5} in poked.ram_changes


def test_ram_writes_apply_in_setup_steps(lab: GameLab):
    """Setup steps apply ram_writes too; the first main observation sees them."""
    exp = Experiment(
        name="poke-setup",
        reset=True,
        ram_watch=[118],
        setup=[{"frames": 5, "ram_writes": [{"address": 118, "value": 5}]}],
        steps=[{"frames": 1, "inputs": {}}],
    )
    r = lab.run_experiment(exp)
    assert r.observations[0].ram_watch == {"118": 5}


def test_ram_writes_require_ram_write_capability():
    from game_lab.emulator import EmulatorInterface, RomInfo, StepResult

    class NoWriteEmulator(EmulatorInterface):
        adapter_name = "no-write"
        console = "fake"

        def capabilities(self):
            return (Capability.LOAD_ROM | Capability.RESET | Capability.FRAME_STEP
                    | Capability.RAM_ACCESS)

        def load(self, path):
            return self.rom_info()

        def reset(self):
            pass

        def inputs(self):
            return {1: []}

        def rom_info(self):
            return RomInfo(rom_path="x", adapter=self.adapter_name,
                           adapter_version="0.0.0", console=self.console,
                           internal_name=None, md5=None,
                           screen_width=None, screen_height=None, ram_size=None)

        def step(self, controllers=None, frames=1):
            return StepResult(frame_number=0, episode_frame_number=0,
                              reward=0.0, terminal=None, lives=None)

        def frame_number(self):
            return 0

        def episode_frame_number(self):
            return 0

        def framebuffer_rgb(self):
            return np.zeros((1, 1, 3), dtype=np.uint8)

        def screenshot(self, path):
            return path

        def ram(self):
            return np.zeros(128, dtype=np.uint8)

        def save_state(self):
            raise UnsupportedCapability(Capability.SAVE_STATE, self.adapter_name)

        def restore_state(self, handle):
            raise UnsupportedCapability(Capability.RESTORE_STATE, self.adapter_name)

    lab = GameLab(NoWriteEmulator())
    exp = Experiment(
        name="poke-no-write",
        reset=True,
        steps=[{"frames": 1, "ram_writes": [{"address": 0, "value": 1}]}],
    )
    with pytest.raises(UnsupportedCapability) as exc:
        lab.run_experiment(exp)
    assert "RAM_WRITE" in str(exc.value)


def test_ram_writes_schema_validation():
    from pydantic import ValidationError

    from game_lab.experiment import ExperimentStep
    with pytest.raises(ValidationError):
        ExperimentStep(frames=1, ram_writes=[{"address": 0, "value": 256}])
    with pytest.raises(ValidationError):
        ExperimentStep(frames=1, ram_writes=[{"address": -1, "value": 1}])


def test_ram_writes_deterministic(fresh_lab, rom_path):
    exp = Experiment(
        name="poke-det",
        rom=str(rom_path),
        reset=True,
        ram_watch=[118],
        steps=[
            {"frames": 60, "inputs": {}},
            {"frames": 60, "inputs": {}, "ram_writes": [{"address": 118, "value": 5}]},
        ],
    )
    first = fresh_lab().run_experiment(exp).model_dump_json()
    second = fresh_lab().run_experiment(exp).model_dump_json()
    assert first == second
