"""Tests for the generic controller representation (no emulator needed)."""

from game_lab.controller import Button, ControllerState


def test_empty_state():
    s = ControllerState.empty()
    assert s.is_empty()
    assert s.to_list() == []
    assert len(s) == 0
    assert s == ControllerState([])


def test_from_names_and_equality():
    a = ControllerState.from_names(["UP", "RIGHT"])
    b = ControllerState([Button.UP, Button.RIGHT])
    assert a == b
    assert hash(a) == hash(b)
    assert set(a) == {Button.UP, Button.RIGHT}
    assert not a.is_empty()


def test_stable_serialization_order():
    s = ControllerState.from_names(["BUTTON_1", "DOWN", "UP", "LEFT"])
    assert s.to_list() == ["UP", "DOWN", "LEFT", "BUTTON_1"]


def test_contains_and_pressed():
    s = ControllerState.from_names(["RIGHT"])
    assert "RIGHT" in s
    assert Button.RIGHT in s
    assert s.pressed("RIGHT")
    assert not s.pressed("LEFT")
    assert "NONSENSE" not in s


def test_unknown_button_raises():
    import pytest
    with pytest.raises(ValueError):
        ControllerState(["FIRE"])


def test_str_repr():
    assert str(ControllerState.empty()) == "NONE"
    assert str(ControllerState.from_names(["UP", "RIGHT"])) == "UP+RIGHT"
    assert "ControllerState" in repr(ControllerState.empty())
