"""Generic controller representation.

This module deliberately knows nothing about specific games or consoles.
A ``ControllerState`` is simply the set of generic :class:`Button` values that
are pressed during a frame. Emulator adapters translate that abstract set into
whatever concrete encoding the underlying emulator uses.
"""

from __future__ import annotations

from enum import Enum
from typing import Iterable, Iterator


class Button(str, Enum):
    """Generic controller buttons.

    Adapters map these onto the underlying emulator. Not every adapter
    supports every button; use :meth:`EmulatorInterface.inputs` to discover
    which buttons a given controller port exposes.
    """

    UP = "UP"
    DOWN = "DOWN"
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    BUTTON_1 = "BUTTON_1"
    BUTTON_2 = "BUTTON_2"
    START = "START"
    SELECT = "SELECT"

    @classmethod
    def coerce(cls, value: "Button | str") -> "Button":
        """Accept either a Button or its string name."""
        if isinstance(value, Button):
            return value
        try:
            return cls(value)
        except ValueError as exc:
            raise ValueError(
                f"Unknown button {value!r}; valid buttons: "
                + ", ".join(b.value for b in cls)
            ) from exc


class ControllerState:
    """Immutable set of pressed buttons for one controller.

    Two states with the same buttons are equal and hashable, which makes them
    safe to use as deterministic experiment inputs and as dictionary keys.
    """

    __slots__ = ("_buttons",)

    def __init__(self, buttons: Iterable[Button | str] | None = None) -> None:
        if buttons is None:
            self._buttons: frozenset[Button] = frozenset()
        else:
            self._buttons = frozenset(Button.coerce(b) for b in buttons)

    @classmethod
    def empty(cls) -> "ControllerState":
        return cls()

    @classmethod
    def from_names(cls, names: Iterable[str]) -> "ControllerState":
        return cls(names)

    @property
    def buttons(self) -> frozenset[Button]:
        return self._buttons

    def pressed(self, button: Button | str) -> bool:
        return Button.coerce(button) in self._buttons

    def is_empty(self) -> bool:
        return not self._buttons

    def to_list(self) -> list[str]:
        # Stable ordering for reproducible serialization.
        order = {
            Button.UP: 0,
            Button.DOWN: 1,
            Button.LEFT: 2,
            Button.RIGHT: 3,
            Button.BUTTON_1: 4,
            Button.BUTTON_2: 5,
            Button.START: 6,
            Button.SELECT: 7,
        }
        return sorted((b.value for b in self._buttons), key=lambda v: order[Button(v)])

    def __iter__(self) -> Iterator[Button]:
        return iter(self._buttons)

    def __len__(self) -> int:
        return len(self._buttons)

    def __contains__(self, item: object) -> bool:
        try:
            return Button.coerce(item) in self._buttons  # type: ignore[arg-type]
        except (ValueError, TypeError):
            return False

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ControllerState):
            return self._buttons == other._buttons
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self._buttons)

    def __repr__(self) -> str:
        return f"ControllerState({self.to_list()})"

    def __str__(self) -> str:
        return "+".join(self.to_list()) if self._buttons else "NONE"
