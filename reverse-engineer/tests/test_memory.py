"""Tests for memory (RAM) comparison utilities."""

import numpy as np
import pytest

from game_lab.memory import describe_ram, diff_ram, ram_sha256


def test_identical_ram():
    a = bytes([0, 1, 2, 3])
    d = diff_ram(a, a)
    assert d.identical
    assert d.changed_addresses == []


def test_size_mismatch_raises():
    with pytest.raises(ValueError):
        diff_ram(bytes([1, 2, 3]), bytes([1, 2]))


def test_changed_addresses_and_values():
    a = bytes([10, 20, 30, 40])
    b = bytes([10, 99, 30, 7])
    d = diff_ram(a, b)
    assert not d.identical
    assert d.changed_addresses == [1, 3]
    changes = {c["address"]: c for c in d.changes}
    assert changes[1] == {"address": 1, "before": 20, "after": 99}
    assert changes[3] == {"address": 3, "before": 40, "after": 7}


def test_accepts_numpy_array():
    a = np.array([1, 2, 3], dtype=np.uint8)
    b = np.array([1, 9, 3], dtype=np.uint8)
    d = diff_ram(a, b)
    assert d.changed_addresses == [1]


def test_describe_ram_and_hash():
    info = describe_ram(bytes(range(4)))
    assert info.size == 4
    assert ram_sha256(bytes(range(4))) == info.sha256


def test_to_dict_json_safe():
    import json
    d = diff_ram(bytes([1, 2]), bytes([1, 3]))
    json.dumps(d.to_dict())
