"""Memory (RAM) inspection utilities.

These operate on raw byte buffers (``bytes`` or ``numpy.uint8`` arrays) and
report *what* changed without ever assigning meaning to addresses. Discovering
which address holds the score, a position, or a flag is the job of the agent.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class RamInfo:
    size: int
    sha256: str


@dataclass(frozen=True)
class RamDiff:
    changed_address_count: int
    total_addresses: int
    changed_fraction: float
    identical: bool
    changed_addresses: list[int] = field(default_factory=list)
    """All addresses whose value differs, in ascending address order."""

    changes: list[dict] = field(default_factory=list)
    """Per-address {address, before, after} entries for changed addresses."""

    def to_dict(self) -> dict:
        return {
            "changed_address_count": self.changed_address_count,
            "total_addresses": self.total_addresses,
            "changed_fraction": round(self.changed_fraction, 6),
            "changed_addresses": self.changed_addresses,
            "changes": self.changes,
            "identical": self.identical,
        }


def ram_sha256(ram: bytes | bytearray | np.ndarray) -> str:
    if isinstance(ram, np.ndarray):
        ram = np.ascontiguousarray(ram).tobytes()
    return hashlib.sha256(bytes(ram)).hexdigest()


def describe_ram(ram: bytes | bytearray | np.ndarray) -> RamInfo:
    if isinstance(ram, np.ndarray):
        size = int(ram.size)
    else:
        size = len(ram)
    return RamInfo(size=size, sha256=ram_sha256(ram))


def _as_uint8(ram: bytes | bytearray | np.ndarray) -> np.ndarray:
    if isinstance(ram, np.ndarray):
        return ram.astype(np.uint8, copy=False).ravel()
    return np.frombuffer(bytes(ram), dtype=np.uint8)


def diff_ram(
    a: bytes | bytearray | np.ndarray,
    b: bytes | bytearray | np.ndarray,
) -> RamDiff:
    """Compute a machine-readable diff between two RAM snapshots."""
    arr_a = _as_uint8(a)
    arr_b = _as_uint8(b)
    if arr_a.size != arr_b.size:
        raise ValueError(
            f"Cannot diff RAM of different sizes: {arr_a.size} vs {arr_b.size}"
        )
    changed_mask = arr_a != arr_b
    changed_indices = np.nonzero(changed_mask)[0]
    total = int(arr_a.size)
    changed = int(changed_indices.size)

    if changed == 0:
        return RamDiff(
            changed_address_count=0,
            total_addresses=total,
            changed_fraction=0.0,
            changed_addresses=[],
            changes=[],
            identical=True,
        )

    addresses = [int(i) for i in changed_indices]
    changes = [
        {"address": int(i), "before": int(arr_a[i]), "after": int(arr_b[i])}
        for i in changed_indices
    ]

    return RamDiff(
        changed_address_count=changed,
        total_addresses=total,
        changed_fraction=changed / total,
        changed_addresses=addresses,
        changes=changes,
        identical=False,
    )
