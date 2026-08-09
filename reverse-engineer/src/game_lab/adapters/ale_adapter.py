"""Atari 2600 adapter built on ALE (the Arcade Learning Environment).

ALE (https://ale.farama.org) is a mature, programmatically controllable
emulator for the Atari 2600, built on top of Stella. This adapter is a *thin*
translation layer between ALE's API and game-lab's generic
:class:`~game_lab.emulator.EmulatorInterface`.

Configuration notes
-------------------
For reverse-engineering we deliberately avoid the RL defaults:

* ``frame_skip = 1``        -> one ``act()`` advances exactly one emulator frame
* ``repeat_action_probability = 0.0`` -> never stochastically repeat the previous action
* ``sound = False``, ``display_screen = False`` -> headless

This gives the exact ``input -> one frame -> observation`` contract that
controlled experiments require.

Multi-controller support
------------------------
The standard ``ale-py`` interface exposes a single player port. This adapter
therefore reports input for port 1 only and raises on any other port. For
true two-player input use :class:`MultiAgentALEAdapter` (``ale-stella-multi``),
which is backed by the Multi-Agent-ALE fork and drives a joint action vector.
"""

from __future__ import annotations

import hashlib
import itertools
import os

import numpy as np

from ..capabilities import Capability, describe
from ..controller import Button, ControllerState
from ..emulator import (
    EmulatorInterface,
    RomInfo,
    StateHandle,
    StepResult,
    UnsupportedCapability,
)


def _init_action_map() -> dict[tuple[int, int, int, int, int], int]:
    """Build a lookup from (up, down, left, right, fire) to ALE Action codes."""
    try:
        from ale_py import Action
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(
            "ale-py is required for the ALE adapter. Install it with `pip install ale-py`."
        ) from exc

    # Map a (up, down, left, right, fire) tuple to the ALE Action value.
    combos = {
        (0, 0, 0, 0, 0): Action.NOOP,
        (0, 1, 0, 0, 0): Action.DOWN,
        (0, 0, 1, 0, 0): Action.LEFT,
        (0, 0, 0, 1, 0): Action.RIGHT,
        (1, 0, 0, 0, 0): Action.UP,
        (1, 0, 1, 0, 0): Action.UPLEFT,
        (1, 0, 0, 1, 0): Action.UPRIGHT,
        (0, 1, 1, 0, 0): Action.DOWNLEFT,
        (0, 1, 0, 1, 0): Action.DOWNRIGHT,
        (0, 0, 0, 0, 1): Action.FIRE,
        (1, 0, 0, 0, 1): Action.UPFIRE,
        (0, 1, 0, 0, 1): Action.DOWNFIRE,
        (0, 0, 1, 0, 1): Action.LEFTFIRE,
        (0, 0, 0, 1, 1): Action.RIGHTFIRE,
        (1, 0, 1, 0, 1): Action.UPLEFTFIRE,
        (1, 0, 0, 1, 1): Action.UPRIGHTFIRE,
        (0, 1, 1, 0, 1): Action.DOWNLEFTFIRE,
        (0, 1, 0, 1, 1): Action.DOWNRIGHTFIRE,
    }
    return {k: int(v.value) for k, v in combos.items()}


class ALEAdapter(EmulatorInterface):
    """Atari 2600 adapter backed by ALE / Stella."""

    adapter_name = "ale-stella"
    adapter_version = "0.1.0"
    console = "atari2600"

    # Buttons a single Atari 2600 joystick exposes (1 fire button).
    SUPPORTED_BUTTONS: tuple[Button, ...] = (
        Button.UP,
        Button.DOWN,
        Button.LEFT,
        Button.RIGHT,
        Button.BUTTON_1,
    )

    def __init__(self, *, seed: int | None = 123, frame_skip: int = 1,
                 repeat_action_probability: float = 0.0) -> None:
        self._seed = seed
        self._frame_skip = frame_skip
        self._rap = repeat_action_probability
        self._ale = None
        self._rom_path: str | None = None
        self._rom_info: RomInfo | None = None
        self._combo_to_action = _init_action_map()
        self._state_counter = itertools.count(1)

    # -- lifecycle -------------------------------------------------------

    def load(self, rom_path: str) -> RomInfo:
        try:
            from ale_py import ALEInterface
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "ale-py is required for the ALE adapter. "
                "Install it with `pip install ale-py`."
            ) from exc

        if not os.path.isfile(rom_path):
            raise FileNotFoundError(f"ROM not found: {rom_path}")

        ale = ALEInterface()
        # Reverse-engineering config: exact frames, no stochasticity, headless.
        ale.setBool("display_screen", False)
        ale.setBool("sound", False)
        ale.setInt("frame_skip", self._frame_skip)
        ale.setFloat("repeat_action_probability", self._rap)
        if self._seed is not None:
            ale.setInt("random_seed", self._seed)

        ale.loadROM(rom_path)
        self._ale = ale
        self._rom_path = rom_path
        self._rom_info = self._build_rom_info(rom_path, ale)
        return self._rom_info

    def reset(self) -> None:
        self._require_loaded()
        self._ale.reset_game()

    # -- capabilities ----------------------------------------------------

    def capabilities(self) -> Capability:
        return (
            Capability.LOAD_ROM
            | Capability.RESET
            | Capability.FRAME_STEP
            | Capability.ADVANCE_N
            | Capability.FRAME_NUMBER
            | Capability.DETERMINISTIC
            | Capability.SINGLE_CONTROLLER
            | Capability.FRAMEBUFFER
            | Capability.SCREENSHOT
            | Capability.SAVE_STATE
            | Capability.RESTORE_STATE
            | Capability.RAM_ACCESS
            | Capability.RAM_WRITE
            | Capability.TERMINAL_STATE
            | Capability.LIVES
            | Capability.REWARD
            | Capability.MODES
            | Capability.DIFFICULTIES
        )

    def inputs(self) -> dict[int, list[Button]]:
        # Standard ALE exposes exactly one controller port.
        return {1: list(self.SUPPORTED_BUTTONS)}

    def rom_info(self) -> RomInfo:
        if self._rom_info is None:
            raise RuntimeError("No ROM loaded.")
        return self._rom_info

    # -- time / execution ------------------------------------------------

    def step(
        self,
        controllers: dict[int, ControllerState] | ControllerState | None = None,
        frames: int = 1,
    ) -> StepResult:
        self._require_loaded()
        if frames < 1:
            raise ValueError(f"frames must be >= 1, got {frames}")

        port_state = self._resolve_controller(controllers)
        action = self._encode(port_state)

        ale = self._ale
        reward = 0.0
        for _ in range(frames):
            reward += float(ale.act(action))
            if ale.game_over():
                break
        return StepResult(
            frame_number=int(ale.getFrameNumber()),
            episode_frame_number=int(ale.getEpisodeFrameNumber()),
            reward=reward,
            terminal=bool(ale.game_over()),
            lives=int(ale.lives()),
        )

    def frame_number(self) -> int:
        self._require_loaded()
        return int(self._ale.getFrameNumber())

    def episode_frame_number(self) -> int:
        self._require_loaded()
        return int(self._ale.getEpisodeFrameNumber())

    # -- video -----------------------------------------------------------

    def framebuffer_rgb(self) -> np.ndarray:
        self._require_loaded()
        return self._ale.getScreenRGB()

    def screenshot(self, path: str) -> str:
        self._require_loaded()
        # Write 1:1 from the framebuffer via Pillow so the PNG matches the
        # array returned by framebuffer_rgb() exactly (ALE's native
        # saveScreenPNG doubles the width for display, which would make the
        # screenshot inconsistent with the raw framebuffer and the frame
        # diff utilities).
        self._write_png_via_pillow(path)
        return path

    def _write_png_via_pillow(self, path: str) -> None:
        from PIL import Image
        Image.fromarray(self.framebuffer_rgb(), mode="RGB").save(path)

    # -- state -----------------------------------------------------------

    def save_state(self) -> StateHandle:
        self._require_loaded()
        # cloneSystemState captures RAM + CPU + subsystem state, which is what
        # controlled experiments need (RAM and frame counter must round-trip).
        native = self._ale.cloneSystemState()
        sid = f"ale-state-{next(self._state_counter)}"
        return StateHandle(
            id=sid,
            native=native,
            frame_number=self.episode_frame_number(),
        )

    def restore_state(self, handle: StateHandle) -> None:
        self._require_loaded()
        if not isinstance(handle, StateHandle):
            raise TypeError("restore_state expects a StateHandle from save_state()")
        self._ale.restoreSystemState(handle.native)

    # -- memory ----------------------------------------------------------

    def ram(self) -> np.ndarray:
        self._require_loaded()
        return self._ale.getRAM()

    def set_ram(self, address: int, value: int) -> None:
        self._require_loaded()
        self._ale.setRAM(address, value)

    # -- optional game-facing signals -----------------------------------

    def is_terminal(self) -> bool | None:
        self._require_loaded()
        return bool(self._ale.game_over())

    def lives(self) -> int | None:
        self._require_loaded()
        return int(self._ale.lives())

    def available_modes(self) -> list[int]:
        self._require_loaded()
        return [int(m) for m in self._ale.getAvailableModes()]

    def set_mode(self, mode: int) -> None:
        self._require_loaded()
        self._ale.setMode(mode)

    def available_difficulties(self) -> list[int]:
        self._require_loaded()
        return [int(d) for d in self._ale.getAvailableDifficulties()]

    def set_difficulty(self, difficulty: int) -> None:
        self._require_loaded()
        self._ale.setDifficulty(difficulty)

    # -- internals -------------------------------------------------------

    def _require_loaded(self) -> None:
        if self._ale is None:
            raise RuntimeError("No ROM loaded. Call load(rom_path) first.")

    def _resolve_controller(
        self,
        controllers: dict[int, ControllerState] | ControllerState | None,
    ) -> ControllerState:
        if controllers is None:
            return ControllerState.empty()
        if isinstance(controllers, ControllerState):
            return controllers
        # dict form: only port 1 is supported by standard ALE.
        if len(controllers) > 1 or (len(controllers) == 1 and 1 not in controllers):
            raise UnsupportedCapability(
                Capability.MULTI_CONTROLLER, self.adapter_name
            )
        return controllers.get(1, ControllerState.empty())

    def _encode(self, state: ControllerState) -> int:
        """Translate a generic ControllerState into an ALE action code."""
        buttons = state.buttons
        # Reject buttons this adapter/console cannot represent.
        unsupported = buttons - set(self.SUPPORTED_BUTTONS)
        if unsupported:
            names = ", ".join(sorted(b.value for b in unsupported))
            raise UnsupportedCapability(
                f"BUTTONS[{names}]",
                self.adapter_name,
            )
        # Reject contradictory directions that a real joystick cannot produce.
        if Button.UP in buttons and Button.DOWN in buttons:
            raise ValueError("Cannot press UP and DOWN simultaneously")
        if Button.LEFT in buttons and Button.RIGHT in buttons:
            raise ValueError("Cannot press LEFT and RIGHT simultaneously")

        key = (
            int(Button.UP in buttons),
            int(Button.DOWN in buttons),
            int(Button.LEFT in buttons),
            int(Button.RIGHT in buttons),
            int(Button.BUTTON_1 in buttons),
        )
        return self._combo_to_action[key]

    def _build_rom_info(self, rom_path: str, ale) -> RomInfo:
        # Derive dimensions from the actual framebuffer array rather than from
        # ALE's getScreenDims(), whose axis ordering is ambiguous. The framebuffer
        # is (height, width, channels), so width = shape[1], height = shape[0].
        frame = ale.getScreenRGB()
        height, width = int(frame.shape[0]), int(frame.shape[1])
        with open(rom_path, "rb") as fh:
            md5 = hashlib.md5(fh.read()).hexdigest()
        return RomInfo(
            rom_path=os.path.abspath(rom_path),
            adapter=self.adapter_name,
            adapter_version=self.adapter_version,
            console=self.console,
            internal_name=os.path.basename(rom_path),
            md5=md5,
            screen_width=width,
            screen_height=height,
            ram_size=int(ale.getRAMSize()),
            capabilities=describe(self.capabilities()),
        )
