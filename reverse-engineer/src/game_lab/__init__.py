"""game-lab: a generic experimentation framework for reverse-engineering old
video games through a programmatically controllable emulator.

Public API::

    from game_lab import GameLab
    from game_lab.adapters import ALEAdapter, MultiAgentALEAdapter, build_adapter
    from game_lab.controller import Button, ControllerState
    from game_lab.experiment import Experiment

See ``README.md`` for the full walkthrough.
"""

from .capabilities import Capability, describe
from .controller import Button, ControllerState
from .emulator import (
    EmulatorInterface,
    RomInfo,
    StateHandle,
    StepResult,
    UnsupportedCapability,
)
from .experiment import Experiment, ExperimentResult, ExperimentRunner, ExperimentStep
from .framebuffer import FrameDiff, FramebufferInfo, color_palette, describe_frame, diff_frames, extract_glyphs
from .lab import GameLab
from .memory import RamDiff, RamInfo, describe_ram, diff_ram
from .observation import Observation

__version__ = "0.1.0"

__all__ = [
    "GameLab",
    "EmulatorInterface",
    "RomInfo",
    "StepResult",
    "StateHandle",
    "UnsupportedCapability",
    "Capability",
    "describe",
    "Button",
    "ControllerState",
    "Experiment",
    "ExperimentStep",
    "ExperimentRunner",
    "ExperimentResult",
    "Observation",
    "FrameDiff",
    "FramebufferInfo",
    "color_palette",
    "describe_frame",
    "extract_glyphs",
    "diff_frames",
    "RamDiff",
    "RamInfo",
    "describe_ram",
    "diff_ram",
    "__version__",
]
