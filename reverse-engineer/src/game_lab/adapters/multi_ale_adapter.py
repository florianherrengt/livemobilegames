"""Two-player Atari 2600 adapter built on Multi-Agent-ALE.

The standard :mod:`game_lab.adapters.ale_adapter` is backed by ``ale-py``,
whose public interface only ever acts for player 1 (the C++ layer hardcodes
``PLAYER_B_NOOP``). Two-player games therefore cannot be steered through it.

This adapter is backed by ``multi-agent-ale-py`` (the Farama
Multi-Agent-ALE fork), which exposes a ctypes ``ALEInterface`` whose
``act()`` takes a *joint* action array — one action per active player. Games
like Surround advertise separate modes for 1 and 2 active players; this
adapter selects a 2-player mode by default (or the mode requested by the
experiment) and maps port 1 / port 2 inputs onto the joint action vector.

Everything else (RAM, framebuffer, save states, determinism) works exactly
like the standard adapter, because the underlying emulator is the same
Stella core.
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
from .ale_adapter import _init_action_map


class MultiAgentALEAdapter(EmulatorInterface):
    """Atari 2600 adapter with true two-player input via Multi-Agent-ALE."""

    adapter_name = "ale-stella-multi"
    adapter_version = "0.1.0"
    console = "atari2600"

    # Both joystick ports expose the same button set.
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
        #: ports reported by the loaded game (1, or 1 and 2); set at load time
        self._active_ports: list[int] = [1]

    # -- lifecycle -------------------------------------------------------

    def load(self, rom_path: str) -> RomInfo:
        try:
            from multi_agent_ale_py import ALEInterface
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "multi-agent-ale-py is required for the multi-controller ALE "
                "adapter. Install it with `pip install multi-agent-ale-py`."
            ) from exc

        if not os.path.isfile(rom_path):
            raise FileNotFoundError(f"ROM not found: {rom_path}")

        # The multi-agent-ale-py wheel ships a broken ctypes declaration for
        # setRAM ([c_size_t, c_int] instead of [c_void_p, c_size_t, c_ubyte]).
        # The mismatch makes RAM writes land at the wrong place (observed:
        # identical garbage bytes across all addresses, varying per process).
        # Declaring the true signature once heals the binding for this process.
        # Upstream PR: https://github.com/Farama-Foundation/Multi-Agent-ALE/pull/31
        from ctypes import c_size_t, c_ubyte, c_void_p

        from multi_agent_ale_py.ale_python_interface import ale_lib

        ale_lib.setRAM.argtypes = [c_void_p, c_size_t, c_ubyte]

        ale = ALEInterface()
        # Same reverse-engineering config as the standard adapter.
        ale.setBool("display_screen", False)
        ale.setBool("sound", False)
        ale.setInt("frame_skip", self._frame_skip)
        ale.setFloat("repeat_action_probability", self._rap)
        if self._seed is not None:
            ale.setInt("random_seed", self._seed)

        ale.loadROM(rom_path)
        # Prefer a two-player mode by default: that is this adapter's purpose.
        two_player = [int(m) for m in ale.getAvailableModes(2)]
        one_player = [int(m) for m in ale.getAvailableModes(1)]
        if two_player:
            ale.setMode(two_player[0])
        elif one_player:
            ale.setMode(one_player[0])

        self._ale = ale
        self._rom_path = rom_path
        self._refresh_active_ports()
        self._rom_info = self._build_rom_info(rom_path, ale)
        return self._rom_info

    def reset(self) -> None:
        self._require_loaded()
        self._ale.reset_game()
        self._refresh_active_ports()

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
            | Capability.MULTI_CONTROLLER
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
        return {port: list(self.SUPPORTED_BUTTONS) for port in self._active_ports}

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

        per_port = self._resolve_controllers(controllers)
        # Encode exactly one action per active player.
        actions = np.array(
            [self._encode(per_port.get(port, ControllerState.empty()))
             for port in self._active_ports],
            dtype=np.intc,
        )

        ale = self._ale
        reward = 0.0
        for _ in range(frames):
            rewards = ale.act(actions)
            reward += float(np.sum(rewards))
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
        from PIL import Image
        Image.fromarray(self.framebuffer_rgb(), mode="RGB").save(path)
        return path

    # -- state -----------------------------------------------------------

    def save_state(self) -> StateHandle:
        self._require_loaded()
        native = self._ale.cloneSystemState()
        sid = f"ale-multi-state-{next(self._state_counter)}"
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
        modes = set()
        for players in (1, 2):
            modes.update(int(m) for m in self._ale.getAvailableModes(players))
        return sorted(modes)

    def set_mode(self, mode: int) -> None:
        self._require_loaded()
        self._ale.setMode(mode)
        self._refresh_active_ports()

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

    def _refresh_active_ports(self) -> None:
        n = int(self._ale.numPlayersActive()) if self._ale is not None else 1
        self._active_ports = list(range(1, max(1, n) + 1))

    def _resolve_controllers(
        self,
        controllers: dict[int, ControllerState] | ControllerState | None,
    ) -> dict[int, ControllerState]:
        if controllers is None:
            return {}
        if isinstance(controllers, ControllerState):
            return {1: controllers}
        unknown = set(controllers) - set(self._active_ports)
        if unknown:
            raise UnsupportedCapability(
                Capability.MULTI_CONTROLLER, self.adapter_name
            )
        return dict(controllers)

    def _encode(self, state: ControllerState) -> int:
        """Translate a generic ControllerState into an ALE action code."""
        buttons = state.buttons
        unsupported = buttons - set(self.SUPPORTED_BUTTONS)
        if unsupported:
            names = ", ".join(sorted(b.value for b in unsupported))
            raise UnsupportedCapability(
                f"BUTTONS[{names}]",
                self.adapter_name,
            )
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
