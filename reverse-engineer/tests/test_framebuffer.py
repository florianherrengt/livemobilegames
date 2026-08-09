"""Tests for framebuffer comparison utilities (pure numpy, no emulator)."""

import numpy as np
import pytest

from game_lab.framebuffer import (
    color_palette,
    describe_frame,
    diff_frames,
    extract_glyphs,
    frame_sha256,
)


def _solid(h, w, c=(10, 20, 30)):
    return np.full((h, w, 3), c, dtype=np.uint8)


def test_identical_frames_report_no_change():
    a = _solid(10, 12)
    d = diff_frames(a, a.copy())
    assert d.identical
    assert d.changed_pixel_count == 0
    assert d.bounding_box is None
    assert d.regions == []
    assert d.to_dict()["region_count"] == 0


def test_shape_mismatch_raises():
    with pytest.raises(ValueError):
        diff_frames(_solid(4, 4), _solid(4, 5))


def test_single_block_change_bounding_box_and_region():
    a = _solid(20, 20)
    b = a.copy()
    b[5:8, 10:13] = (255, 255, 255)  # 3x3 block at y=5..7, x=10..12
    d = diff_frames(a, b)
    assert not d.identical
    assert d.changed_pixel_count == 9
    assert d.bounding_box == (10, 5, 3, 3)
    assert len(d.regions) == 1
    assert d.regions[0] == (10, 5, 3, 3)


def test_two_separate_regions_4_connectivity():
    a = _solid(20, 20)
    b = a.copy()
    b[2:4, 2:4] = 255
    b[15:17, 15:17] = 255
    d = diff_frames(a, b, connectivity=4)
    assert d.changed_pixel_count == 8
    assert len(d.regions) == 2
    # regions ordered by area (both equal here), each is 2x2
    for (x, y, w, h) in d.regions:
        assert w == 2 and h == 2


def test_grayscale_2d_supported():
    a = np.zeros((6, 6), dtype=np.uint8)
    b = a.copy()
    b[0, 0] = 1
    d = diff_frames(a, b)
    assert d.changed_pixel_count == 1
    assert d.bounding_box == (0, 0, 1, 1)


def test_describe_frame_and_hash_stability():
    f = _solid(4, 5)
    info = describe_frame(f)
    assert info.width == 5 and info.height == 4 and info.channels == 3
    h1 = frame_sha256(f)
    h2 = frame_sha256(f.copy())
    assert h1 == h2  # content-addressed, not memory-addressed


def test_min_region_area_filter():
    a = _solid(20, 20)
    b = a.copy()
    b[0, 0] = 255  # single pixel
    b[10:13, 10:13] = 255  # 9-pixel block
    d = diff_frames(a, b, min_region_area=2)
    assert len(d.regions) == 1  # only the 9-pixel block survives
    assert d.regions[0][2:] == (3, 3)


def test_to_dict_is_json_safe():
    a = _solid(4, 4)
    b = a.copy()
    b[0, 0] = 1
    payload = diff_frames(a, b).to_dict()
    import json
    json.dumps(payload)  # must not raise
    assert payload["bounding_box"] == [0, 0, 1, 1]


def test_color_palette_ranks_by_count_and_reports_fraction():
    f = np.zeros((10, 10, 3), dtype=np.uint8)
    f[:] = (10, 20, 30)  # 100 px background
    f[0, 0] = (200, 200, 200)  # 1 px white
    palette = color_palette(f, top_n=8)
    assert palette[0]["rgb"] == [10, 20, 30]
    assert palette[0]["count"] == 99
    assert palette[0]["fraction"] == pytest.approx(0.99)
    assert palette[1]["rgb"] == [200, 200, 200]
    assert palette[1]["count"] == 1


def test_color_palette_respects_top_n_and_2d_frames():
    f = np.zeros((4, 4), dtype=np.uint8)
    f[:] = 7
    f[0, 0] = 3
    palette = color_palette(f, top_n=1)
    assert len(palette) == 1
    assert palette[0]["rgb"] == [7, 7, 7]
    assert palette[0]["count"] == 15


def test_color_palette_counts_sum_to_total_pixels():
    rng = np.random.default_rng(1)
    f = rng.integers(0, 256, size=(30, 40, 3), dtype=np.uint8)
    palette = color_palette(f, top_n=5)
    assert sum(p["count"] for p in palette) <= 1200
    assert all(0.0 <= p["fraction"] <= 1.0 for p in palette)


def test_extract_glyphs_finds_digits_and_fingerprints_are_stable():
    # Blue background with two digit-like white blocks.
    f = np.full((40, 60, 3), (10, 20, 30), dtype=np.uint8)
    f[5:22, 8:20] = (255, 255, 255)   # "0"-ish block 1
    f[5:22, 40:52] = (255, 255, 255)  # "0"-ish block 2
    g = extract_glyphs(f, min_area=20)
    assert g["background"] == [10, 20, 30]
    assert len(g["glyphs"]) == 2
    # Sorted in reading order (top-to-bottom, then left-to-right).
    assert g["glyphs"][0]["bbox"] == [8, 5, 12, 17]
    assert g["glyphs"][1]["bbox"] == [40, 5, 12, 17]
    # Same shape -> same fingerprint.
    assert g["glyphs"][0]["sha256"] == g["glyphs"][1]["sha256"]
    assert g["glyphs"][0]["pixels"] == 17 * 12


def test_extract_glyphs_region_crops_and_uses_region_background():
    f = np.full((40, 60, 3), (10, 20, 30), dtype=np.uint8)
    f[5:22, 8:20] = (255, 255, 255)
    f[30:40, 30:50] = (200, 100, 50)  # outside the region
    g = extract_glyphs(f, region=(0, 0, 24, 24), min_area=20)
    assert len(g["glyphs"]) == 1
    assert g["glyphs"][0]["bbox"] == [8, 5, 12, 17]
    assert g["background"] == [10, 20, 30]


def test_extract_glyphs_shape_change_changes_fingerprint():
    f = np.full((20, 20, 3), (0, 0, 0), dtype=np.uint8)
    a = f.copy()
    a[2:8, 2:8] = 255  # square
    b = f.copy()
    b[2:8, 2:10] = 255  # wider rectangle
    ga = extract_glyphs(a, min_area=10)
    gb = extract_glyphs(b, min_area=10)
    assert ga["glyphs"][0]["sha256"] != gb["glyphs"][0]["sha256"]
    assert ga["glyphs"][0]["bbox"][2:] == [6, 6]
    assert gb["glyphs"][0]["bbox"][2:] == [8, 6]


def test_extract_glyphs_empty_frame_and_min_area():
    f = np.full((20, 20, 3), (0, 0, 0), dtype=np.uint8)
    assert extract_glyphs(f)["glyphs"] == []
    f[0, 0] = 255  # single pixel, below min_area default of 8
    assert extract_glyphs(f)["glyphs"] == []
    assert len(extract_glyphs(f, min_area=1)["glyphs"]) == 1


def test_extract_glyphs_grayscale_input():
    f = np.zeros((20, 20), dtype=np.uint8)
    f[5:10, 5:10] = 200
    g = extract_glyphs(f, min_area=10)
    assert len(g["glyphs"]) == 1
    assert g["glyphs"][0]["bbox"] == [5, 5, 5, 5]
