"""Emulator adapters.

Each adapter is a thin translation layer between a specific emulator's API and
game-lab's generic :class:`~game_lab.emulator.EmulatorInterface`.

Available adapters:

* :class:`ALEAdapter` -- Atari 2600 via ALE (Stella), single player port.
* :class:`MultiAgentALEAdapter` -- Atari 2600 via Multi-Agent-ALE (Stella),
  true two-player input through a joint action vector.
"""

from __future__ import annotations

from .ale_adapter import ALEAdapter
from .multi_ale_adapter import MultiAgentALEAdapter

__all__ = ["ALEAdapter", "MultiAgentALEAdapter", "ADAPTER_REGISTRY", "build_adapter"]

ADAPTER_REGISTRY: dict[str, type] = {
    ALEAdapter.adapter_name: ALEAdapter,
    MultiAgentALEAdapter.adapter_name: MultiAgentALEAdapter,
}


def build_adapter(name: str, **kwargs):
    """Construct an adapter by registered name.

    Unknown names raise :class:`ValueError`; construction is otherwise
    delegated to the adapter class (``**kwargs`` are passed through, e.g.
    ``seed=123``).
    """
    try:
        cls = ADAPTER_REGISTRY[name]
    except KeyError:
        raise ValueError(
            f"Unknown adapter {name!r}. Available: {sorted(ADAPTER_REGISTRY)}"
        ) from None
    return cls(**kwargs)
