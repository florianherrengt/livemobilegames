"""Generic emulator interface.

The framework talks only to :class:`EmulatorInterface`. Each concrete adapter
(see :mod:`game_lab.adapters.ale_adapter`) implements this contract for a
particular emulator/console, translating generic calls into the emulator's own
API.

The interface is deliberately capability-driven: callers must check
:meth:`capabilities` (and :meth:`inputs`) before using optional features, and
adapters must raise :class:`UnsupportedCapability` rather than silently faking
behaviour they cannot provide.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .capabilities import Capability
from .controller import Button, ControllerState


class UnsupportedCapability(RuntimeError):
    """Raised when a caller uses a feature the adapter does not provide."""

    def __init__(self, capability: Capability | str, adapter: str | None = None,
                 context: str | None = None) -> None:
        name = capability.name if isinstance(capability, Capability) else str(capability)
        where = f" while {context}" if context else ""
        msg = f"Adapter {adapter!r} does not support capability {name}{where}" if adapter else (
            f"This adapter does not support capability {name}{where}"
        )
        super().__init__(msg)
        self.capability = capability


@dataclass(frozen=True)
class RomInfo:
    """Static metadata about a loaded ROM and its adapter."""

    rom_path: str
    adapter: str
    adapter_version: str
    console: str
    internal_name: str | None
    md5: str | None
    screen_width: int | None
    screen_height: int | None
    ram_size: int | None
    capabilities: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class StepResult:
    """Result of advancing the emulator by one or more frames."""

    frame_number: int
    episode_frame_number: int
    reward: float
    terminal: bool | None
    lives: int | None


@dataclass(frozen=True)
class StateHandle:
    """Opaque handle to a saved emulator state.

    The underlying object is emulator-specific; callers should treat the handle
    as an opaque token and only pass it back to :meth:`EmulatorInterface.restore_state`.
    """

    id: str
    native: Any
    frame_number: int


class EmulatorInterface(abc.ABC):
    """Abstract contract every emulator adapter implements."""

    #: short identifier used in observations and CLI output, e.g. ``"ale-stella"``
    adapter_name: str = "abstract"
    adapter_version: str = "0.0.0"
    #: console this adapter targets, e.g. ``"atari2600"``
    console: str = "unknown"

    # -- lifecycle -------------------------------------------------------

    @abc.abstractmethod
    def load(self, rom_path: str) -> RomInfo:
        """Load a ROM. Must be called exactly once before any other method."""

    @abc.abstractmethod
    def reset(self) -> None:
        """Reset the emulator to the start of a game (soft reset)."""

    # -- capabilities ----------------------------------------------------

    @abc.abstractmethod
    def capabilities(self) -> Capability:
        """Return the set of capabilities this adapter actually supports."""

    def supports(self, capability: Capability) -> bool:
        return bool(self.capabilities() & capability)

    def _require(self, capability: Capability) -> None:
        if not self.supports(capability):
            raise UnsupportedCapability(capability, self.adapter_name)

    @abc.abstractmethod
    def inputs(self) -> dict[int, list[Button]]:
        """Return, per controller port (1-indexed), the buttons it supports."""

    @abc.abstractmethod
    def rom_info(self) -> RomInfo:
        """Return metadata for the currently loaded ROM."""

    # -- time / execution ------------------------------------------------

    @abc.abstractmethod
    def step(
        self,
        controllers: dict[int, ControllerState] | ControllerState | None = None,
        frames: int = 1,
    ) -> StepResult:
        """Apply controller input and advance exactly ``frames`` emulator frames.

        ``controllers`` maps 1-indexed port numbers to states. A bare
        :class:`ControllerState` is shorthand for port 1. ``None`` means all
        ports released.
        """

    @abc.abstractmethod
    def frame_number(self) -> int:
        """Total frames elapsed since the emulator was created."""

    @abc.abstractmethod
    def episode_frame_number(self) -> int:
        """Frames elapsed since the most recent reset."""

    # -- video -----------------------------------------------------------

    @abc.abstractmethod
    def framebuffer_rgb(self) -> np.ndarray:
        """Return the current framebuffer as an ``H x W x 3`` uint8 array."""

    @abc.abstractmethod
    def screenshot(self, path: str) -> str:
        """Save the current framebuffer to ``path`` as a PNG. Returns the path."""

    # -- state -----------------------------------------------------------

    @abc.abstractmethod
    def save_state(self) -> StateHandle:
        """Clone the current emulator state and return an opaque handle."""

    @abc.abstractmethod
    def restore_state(self, handle: StateHandle) -> None:
        """Restore a previously saved state."""

    # -- memory ----------------------------------------------------------

    @abc.abstractmethod
    def ram(self) -> np.ndarray:
        """Return the current RAM as a 1-D uint8 array."""

    # -- optional game-facing signals -----------------------------------

    def is_terminal(self) -> bool | None:
        """Return whether the game is over, or None if the adapter cannot tell."""
        return None

    def lives(self) -> int | None:
        """Return remaining lives, or None if not exposed."""
        return None

    # -- optional configuration -----------------------------------------

    def available_modes(self) -> list[int]:
        """Selectable game modes. Empty if unsupported."""
        return []

    def set_mode(self, mode: int) -> None:
        raise UnsupportedCapability("MODES", self.adapter_name)

    def available_difficulties(self) -> list[int]:
        return []

    def set_difficulty(self, difficulty: int) -> None:
        raise UnsupportedCapability("DIFFICULTIES", self.adapter_name)
