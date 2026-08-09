"""Machine-readable observation models.

Every observation is a pydantic model so it can be validated, serialized to
JSON, and consumed reliably by an AI agent (text-only or vision-capable).

Observations deliberately never assign semantic meaning to pixels or addresses:
no "player", "enemy", "score". They describe *what* changed and *where*, and
leave the *why* to the agent.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class FramebufferSummary(BaseModel):
    width: int
    height: int
    channels: int
    sha256: str


class Observation(BaseModel):
    """A single sampled observation during an experiment.

    Most experiments record one observation per *step* (after applying a step's
    inputs for its frame count). Pass ``observe_per_frame=True`` to the runner
    to also record one observation per emulator frame.
    """

    step_index: int = Field(description="Index of the experiment step, 0-based.")
    sample_index: int = Field(
        default=0,
        description="Frame offset within the step (0 for a per-step sample, "
        "or 0..N-1 for per-frame samples).",
    )
    frame_number: int = Field(description="Total frames since emulator creation.")
    episode_frame_number: int = Field(description="Frames since the last reset.")

    inputs_applied: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Controller port -> list of buttons pressed for this sample. "
        "Port numbers are stringified for JSON stability (e.g. '1').",
    )

    framebuffer: Optional[FramebufferSummary] = Field(
        default=None, description="Summary of the current framebuffer, if exposed."
    )
    framebuffer_colors: Optional[list[dict]] = Field(
        default=None,
        description="Top color palette: [{rgb: [r,g,b], count: N, fraction: float}, ...]. "
        "Lets a text-only agent understand what is on screen without viewing a PNG.",
    )
    framebuffer_changed: bool = Field(
        default=False,
        description="True if this frame differs from the previously sampled frame.",
    )
    glyph_groups: Optional[list[dict]] = Field(
        default=None,
        description="Per-requested-region glyph extractions: "
        "[{region: [x,y,w,h], background: [r,g,b], glyphs: [...]}, ...]. "
        "Each glyph carries a tight bbox, pixel count, dominant colors, and a "
        "sha256 fingerprint of its pixels so shape changes (e.g. score digits "
        "counting up) are detectable without vision.",
    )
    changed_pixel_count: int = 0
    change_bounding_box: Optional[list[int]] = Field(
        default=None,
        description="[x, y, width, height] enclosing all changed pixels, or null.",
    )
    change_regions: list[list[int]] = Field(
        default_factory=list,
        description="Connected-component bounding boxes [x, y, width, height] of "
        "changed pixels, largest first. No semantic labels.",
    )

    ram: Optional[dict] = Field(
        default=None,
        description="{'size': N, 'sha256': '...'} for the current RAM, if exposed.",
    )
    ram_changed: Optional[bool] = Field(
        default=None, description="True if RAM differs from the previous sample."
    )
    ram_changed_address_count: Optional[int] = None
    ram_changed_addresses: Optional[list[int]] = Field(
        default=None,
        description="Addresses whose value changed vs the previous sample. "
        "Meaning of each address is unknown to the framework.",
    )
    ram_changes: Optional[list[dict]] = Field(
        default=None,
        description="Per-address changes: [{address, before, after}, ...]. "
        "Present whenever ram_changed_addresses is present and the adapter "
        "supports RAM access.",
    )
    ram_watch: Optional[dict] = Field(
        default=None,
        description="Watched addresses as {address: value} for the addresses "
        "listed in the experiment's ram_watch field. Lets an agent track a "
        "few addresses without dumping all RAM.",
    )
    ram_watch_changed: Optional[list[int]] = Field(
        default=None,
        description="Watched addresses whose value changed vs the previous sample.",
    )

    terminal: Optional[bool] = Field(
        default=None, description="Whether the emulator reports game-over."
    )
    lives: Optional[int] = Field(default=None, description="Remaining lives, if exposed.")
    reward: Optional[float] = Field(
        default=None,
        description="Per-sample reward summed over the sampled frames, if exposed. "
        "Meaning is emulator-defined (often score delta).",
    )

    save_state_id: Optional[str] = Field(
        default=None,
        description="Identifier of the state saved at this sample, if requested.",
    )
    screenshot_path: Optional[str] = Field(
        default=None, description="Path to a PNG written at this sample, if requested."
    )

    notes: list[str] = Field(default_factory=list)


class ExperimentSummary(BaseModel):
    name: str
    rom: Optional[str] = None
    seed: Optional[int] = None
    reset: bool
    step_count: int
    frames_advanced: int
    final_frame_number: int
    final_episode_frame_number: int
    final_terminal: Optional[bool] = None
    final_lives: Optional[int] = None
    framebuffer_ever_changed: bool
    ram_ever_changed: Optional[bool] = None


class ExperimentResult(BaseModel):
    """Full structured result of running one experiment."""

    experiment: dict = Field(description="The experiment definition that was run.")
    adapter: str
    console: str
    rom: str
    capabilities: list[str]
    inputs: dict[str, list[str]]
    summary: ExperimentSummary
    observations: list[Observation]
    states: dict[str, dict] = Field(
        default_factory=dict,
        description="Named saved states captured during the run: "
        "{name: {'frame_number': N, 'save_state_id': '...'}}.",
    )
    screenshots: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    probes: list["ProbeResult"] = Field(
        default_factory=list,
        description="Probe sweeps performed during this run (see ProbeResult).",
    )


class ProbeVariant(BaseModel):
    """One input variant within a probe sweep."""

    inputs: dict[str, list[str]] = Field(
        description="Controller port -> buttons held for the whole probe run.",
    )
    is_baseline: bool = Field(
        default=False,
        description="True for the baseline variant all others are compared against.",
    )
    final_observation: Optional[Observation] = Field(
        default=None,
        description="Observation recorded at the end of this variant's run.",
    )
    fb_divergence_frame: Optional[int] = Field(
        default=None,
        description="Frame offset (0-based) of the first frame whose framebuffer "
        "differs from the baseline variant, or None if identical for the whole run.",
    )
    ram_divergence_frame: Optional[int] = Field(
        default=None,
        description="Frame offset (0-based) of the first frame whose RAM differs "
        "from the baseline variant, or None if identical for the whole run.",
    )
    ram_divergence_addresses: list[dict] = Field(
        default_factory=list,
        description="Per-address RAM differences at the first diverging frame: "
        "[{address, baseline, variant}, ...]. Empty when RAM never diverged.",
    )


class ProbeResult(BaseModel):
    """Result of one probe: sweep several input variants from one state and
    report when each diverges from the baseline."""

    name: str
    frames: int = Field(description="Frames run per variant.")
    variants: list[ProbeVariant] = Field(
        default_factory=list,
        description="One entry per probed input, first entry is the baseline.",
    )
    warnings: list[str] = Field(default_factory=list)
