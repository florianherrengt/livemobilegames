"""Framebuffer comparison utilities.

All functions operate on numpy arrays so they stay generic over colour depth
and resolution. They produce *machine-readable* descriptions of what changed
between two frames, without ever labelling regions as semantic objects
("player", "ball", ...). An agent is expected to infer those meanings itself.

Region detection uses ``scipy.ndimage.label`` for connected-component
labelling, which is a mature, well-tested implementation.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage


@dataclass(frozen=True)
class FramebufferInfo:
    """Summary of a single frame, suitable for JSON serialization."""

    width: int
    height: int
    channels: int
    sha256: str


@dataclass(frozen=True)
class FrameDiff:
    """Difference between two frames of identical shape."""

    changed_pixel_count: int
    total_pixels: int
    changed_fraction: float
    identical: bool
    bounding_box: tuple[int, int, int, int] | None = None
    """(x, y, width, height) of the axis-aligned box enclosing all changed
    pixels, or None when nothing changed."""

    regions: list[tuple[int, int, int, int]] = field(default_factory=list)
    """Axis-aligned bounding boxes (x, y, width, height) of each connected
    component of changed pixels. Ordered by area, largest first."""

    def to_dict(self) -> dict:
        return {
            "changed_pixel_count": self.changed_pixel_count,
            "total_pixels": self.total_pixels,
            "changed_fraction": round(self.changed_fraction, 6),
            "bounding_box": list(self.bounding_box) if self.bounding_box else None,
            "regions": [list(r) for r in self.regions],
            "region_count": len(self.regions),
            "identical": self.identical,
        }


def frame_sha256(frame: np.ndarray) -> str:
    """Stable hash of a frame's bytes."""
    return hashlib.sha256(np.ascontiguousarray(frame).tobytes()).hexdigest()


def color_palette(frame: np.ndarray, *, top_n: int = 8) -> list[dict]:
    """Return the ``top_n`` most common colors and their pixel counts.

    Each entry is ``{"rgb": [r, g, b], "count": N, "fraction": float}``,
    sorted by count descending. This lets a text-only agent understand what
    is on screen ("85% blue background, 14% pink border, 0.6% red block")
    without viewing a PNG.
    """
    if frame.ndim == 2:
        frame = np.stack([frame] * 3, axis=2)
    pixels = frame.reshape(-1, frame.shape[-1])[:, :3]
    total = int(pixels.shape[0])
    colors, counts = np.unique(pixels, axis=0, return_counts=True)
    idx = np.argsort(-counts)[:top_n]
    return [
        {
            "rgb": [int(c) for c in colors[i]],
            "count": int(counts[i]),
            "fraction": round(float(counts[i]) / total, 4),
        }
        for i in idx
    ]


def extract_glyphs(
    frame: np.ndarray,
    *,
    region: tuple[int, int, int, int] | None = None,
    min_area: int = 8,
    top_n: int = 32,
    max_colors: int = 3,
    background: tuple[int, int, int] | None = None,
) -> dict:
    """Extract glyph-like connected components (digits, sprites, letters).

    "Glyph" means any connected group of non-background pixels within a
    region. The most common color in the region is treated as the background
    (override with ``background``). Each glyph is reported with a tight
    bounding box, pixel count, a SHA-256 fingerprint of its pixels, and its
    dominant colors. The fingerprint lets a text-only agent detect that a
    glyph *changed shape* (e.g. a score digit changing 0 -> 1) without any
    vision: the SHA-256 of the digit pixels is different.

    The framework never labels glyphs ("digit", "icon"); it only reports
    shape fingerprints and positions. An agent infers meaning by tracking a
    glyph's position/fingerprint across frames.
    """
    if frame.ndim == 2:
        frame = np.stack([frame] * 3, axis=2)
    if frame.shape[2] > 3:
        frame = frame[:, :, :3]

    if region is not None:
        x, y, w, h = region
        sub = frame[y : y + h, x : x + w]
        origin = (x, y)
    else:
        sub = frame
        origin = (0, 0)

    if sub.size == 0:
        return {"background": None, "glyphs": []}

    pixels = sub.reshape(-1, 3)
    # Most common color = background (or caller-supplied override).
    if background is None:
        colors, counts = np.unique(pixels, axis=0, return_counts=True)
        bg = tuple(int(c) for c in colors[np.argmax(counts)])
    else:
        bg = tuple(background)

    mask = np.any(sub != np.array(bg, dtype=np.uint8), axis=2)
    if not mask.any():
        return {"background": list(bg), "glyphs": []}

    labels, n = ndimage.label(mask)
    glyphs: list[dict] = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(labels == i)
        count = len(ys)
        if count < min_area:
            continue
        x0, x1 = xs.min(), xs.max()
        y0, y1 = ys.min(), ys.max()
        crop = sub[y0 : y1 + 1, x0 : x1 + 1]
        fp = hashlib.sha256(np.ascontiguousarray(crop).tobytes()).hexdigest()
        ccolors, ccounts = np.unique(crop.reshape(-1, 3), axis=0, return_counts=True)
        order = np.argsort(-ccounts)
        glyphs.append(
            {
                "bbox": [
                    int(x0 + origin[0]),
                    int(y0 + origin[1]),
                    int(x1 - x0 + 1),
                    int(y1 - y0 + 1),
                ],
                "pixels": int(count),
                "sha256": fp,
                "colors": [
                    {
                        "rgb": [int(c) for c in ccolors[order[j]]],
                        "count": int(ccounts[order[j]]),
                    }
                    for j in range(min(max_colors, len(order)))
                ],
            }
        )
    # Reading order: top-to-bottom, then left-to-right.
    glyphs.sort(key=lambda g: (g["bbox"][1], g["bbox"][0]))
    return {"background": list(bg), "glyphs": glyphs[:top_n]}


def describe_frame(frame: np.ndarray) -> FramebufferInfo:
    if frame.ndim == 2:
        height, width = frame.shape
        channels = 1
    elif frame.ndim == 3:
        height, width, channels = frame.shape
    else:
        raise ValueError(f"Expected 2D or 3D framebuffer, got shape {frame.shape!r}")
    return FramebufferInfo(
        width=int(width),
        height=int(height),
        channels=int(channels),
        sha256=frame_sha256(frame),
    )


def _diff_mask(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Boolean 2D mask of pixels that differ, collapsing channels."""
    if a.shape != b.shape:
        raise ValueError(
            f"Cannot diff frames of different shapes: {a.shape!r} vs {b.shape!r}"
        )
    if a.ndim == 2:
        return a != b
    # any channel difference counts as a changed pixel
    return np.any(a != b, axis=2)


def diff_frames(
    a: np.ndarray,
    b: np.ndarray,
    *,
    connectivity: int = 4,
    min_region_area: int = 1,
) -> FrameDiff:
    """Compute a machine-readable diff between two frames.

    Parameters
    ----------
    a, b:
        Frames of identical shape (2D or H x W x C).
    connectivity:
        4 (edge-adjacent) or 8 (also diagonal) for connected components.
    min_region_area:
        Ignore connected components smaller than this many pixels. Useful to
        drop single-pixel noise.
    """
    mask = _diff_mask(a, b)
    changed = int(mask.sum())
    total = int(mask.size)
    identical = changed == 0

    if identical:
        return FrameDiff(
            changed_pixel_count=0,
            total_pixels=total,
            changed_fraction=0.0,
            identical=True,
            bounding_box=None,
            regions=[],
        )

    ys, xs = np.nonzero(mask)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bbox = (x0, y0, int(x1 - x0 + 1), int(y1 - y0 + 1))

    structure = np.ones((3, 3), dtype=int) if connectivity == 8 else None
    labels, n = ndimage.label(mask, structure=structure)
    regions: list[tuple[int, int, int, int]] = []
    if n > 0:
        slices = ndimage.find_objects(labels)
        for sl in slices:
            if sl is None:
                continue
            sy, sx = sl
            area = int((labels[sl] != 0).sum())
            if area < min_region_area:
                continue
            regions.append(
                (int(sx.start), int(sy.start), int(sx.stop - sx.start), int(sy.stop - sy.start))
            )
        regions.sort(key=lambda r: r[2] * r[3], reverse=True)

    return FrameDiff(
        changed_pixel_count=changed,
        total_pixels=total,
        changed_fraction=changed / total,
        identical=False,
        bounding_box=bbox,
        regions=regions,
    )
