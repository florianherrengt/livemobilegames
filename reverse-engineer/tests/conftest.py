"""Shared pytest fixtures.

The fixture ROM is the Atari 2600 "Surround" cartridge shipped with this
project. It is used ONLY as a test fixture to prove the framework works; no
test encodes knowledge of the game's rules, scoring, or behaviour.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from game_lab import GameLab
from game_lab.adapters import ALEAdapter

REPO = Path(__file__).resolve().parent.parent
ROM = REPO / "roms" / "surround.bin"


def _ensure_rom() -> Path:
    """Copy the supplied ROM into roms/ if it is not there yet.

    Keeps the test suite self-sufficient regardless of where it runs from.
    """
    if ROM.is_file():
        return ROM
    ROM.parent.mkdir(parents=True, exist_ok=True)
    # Look for the original .bin next to the repo root.
    candidates = list(REPO.glob("*.bin"))
    if not candidates:
        pytest.skip("No .bin ROM fixture found in repo root")
    import shutil
    shutil.copy(candidates[0], ROM)
    return ROM


@pytest.fixture(scope="session")
def rom_path() -> str:
    return str(_ensure_rom())


@pytest.fixture
def lab(rom_path) -> GameLab:
    """A fresh GameLab with the ROM loaded but not reset."""
    g = GameLab(ALEAdapter(seed=123))
    g.load(rom_path)
    return g


@pytest.fixture
def fresh_lab(rom_path):
    """Return a callable that builds a fresh GameLab+adapter (for determinism tests)."""
    def _make(seed: int = 123):
        return GameLab(ALEAdapter(seed=seed))
    return _make


@pytest.fixture
def experiments_dir() -> Path:
    return REPO / "experiments"
