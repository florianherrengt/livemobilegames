"""Capability flags describing what an emulator adapter can actually do.

The framework never *assumes* a capability; it asks the adapter. This prevents
the framework from pretending a feature exists when the emulator cannot provide
it, and lets a future adapter (e.g. a debugger adapter) expose a different
capability set without redesigning anything.
"""

from __future__ import annotations

from enum import Flag, auto


class Capability(Flag):
    NONE = 0

    # Core lifecycle
    LOAD_ROM = auto()
    RESET = auto()

    # Time / execution
    FRAME_STEP = auto()          # advance exactly one frame with input
    ADVANCE_N = auto()           # advance N frames in one call
    FRAME_NUMBER = auto()        # report current frame index
    DETERMINISTIC = auto()       # same seed + inputs -> same result

    # Input
    SINGLE_CONTROLLER = auto()
    MULTI_CONTROLLER = auto()

    # Video
    FRAMEBUFFER = auto()         # raw pixel access
    SCREENSHOT = auto()          # save PNG

    # State
    SAVE_STATE = auto()          # clone state to an in-memory handle
    RESTORE_STATE = auto()       # restore from a cloned handle

    # Memory
    RAM_ACCESS = auto()          # read RAM
    RAM_WRITE = auto()           # write RAM

    # Game-facing signals (only if genuinely exposed by the emulator)
    TERMINAL_STATE = auto()      # can report game-over
    LIVES = auto()               # can report remaining lives
    REWARD = auto()              # can report a numeric per-frame reward
    MODES = auto()               # selectable game modes
    DIFFICULTIES = auto()        # selectable difficulty switches


def describe(capability: Capability) -> list[str]:
    """Return the names of every individual capability flag that is set."""
    names = []
    for flag in Capability:
        if flag is Capability.NONE:
            continue
        if capability & flag:
            names.append(flag.name)
    return names
