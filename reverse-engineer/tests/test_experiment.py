"""Tests for experiment schema parsing and validation."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from game_lab.experiment import Experiment, ExperimentStep


def _minimal(**overrides):
    base = {"name": "t", "steps": [{"frames": 1, "inputs": {}}]}
    base.update(overrides)
    return base


def test_minimal_experiment_parses():
    exp = Experiment.model_validate(_minimal())
    assert exp.reset is True  # default
    assert exp.seed == 123
    assert len(exp.steps) == 1


def test_frames_must_be_positive():
    with pytest.raises(ValidationError):
        ExperimentStep.model_validate({"frames": 0, "inputs": {}})
    with pytest.raises(ValidationError):
        ExperimentStep.model_validate({"frames": -3, "inputs": {}})


def test_restore_before_save_is_rejected():
    with pytest.raises(ValidationError):
        Experiment.model_validate(
            _minimal(steps=[
                {"frames": 5, "inputs": {}, "restore_state": "never_saved"},
            ])
        )


def test_step_save_enables_later_restore():
    exp = Experiment.model_validate(
        _minimal(steps=[
            {"frames": 5, "inputs": {}, "save_state": "s1"},
            {"frames": 5, "inputs": {}, "restore_state": "s1"},
        ])
    )
    assert exp.steps[1].restore_state == "s1"


def test_setup_save_enables_restore_in_steps():
    exp = Experiment.model_validate(
        _minimal(
            setup=[{"frames": 5, "inputs": {}}],
            save_state_after_setup="setup_state",
            steps=[{"frames": 5, "inputs": {}, "restore_state": "setup_state"}],
        )
    )
    assert exp.save_state_after_setup == "setup_state"


def test_connectivity_bounded():
    with pytest.raises(ValidationError):
        Experiment.model_validate(_minimal(framebuffer_connectivity=5))


def test_from_file(tmp_path: Path):
    p = tmp_path / "exp.json"
    p.write_text(json.dumps(_minimal()))
    exp = Experiment.from_file(str(p))
    assert exp.name == "t"


def test_from_file_missing(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        Experiment.from_file(str(tmp_path / "nope.json"))


def test_from_file_not_object(tmp_path: Path):
    p = tmp_path / "arr.json"
    p.write_text("[1, 2, 3]")
    with pytest.raises(ValueError):
        Experiment.from_file(str(p))


def test_invalid_port_name_rejected_in_runner():
    # Port must be an integer string; this surfaces when inputs are parsed
    # by the runner, not at schema validation (schema accepts arbitrary strings).
    from game_lab.experiment import _parse_inputs
    with pytest.raises(ValueError):
        _parse_inputs({"player1": ["UP"]})


def test_shipped_experiment_fixtures_parse(experiments_dir: Path):
    files = sorted(experiments_dir.glob("*.json"))
    assert files, "expected shipped experiment fixtures"
    for f in files:
        exp = Experiment.from_file(str(f))
        assert exp.name and exp.steps
