"""game-lab command-line interface.

Designed for AI agents first: data-producing commands emit JSON by default, and
every command has a ``--help`` page via typer. Human-readable output is still
available where it is genuinely more useful (e.g. screenshots are PNGs).

Example::

    game-lab info "roms/surround.bin"
    game-lab inputs "roms/surround.bin"
    game-lab run experiments/01-load-and-reset.json
    game-lab frame diff a.png b.png
    game-lab memory dump "roms/surround.bin" --frames 30 -o ram.bin
    game-lab memory diff ram_a.bin ram_b.bin
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import numpy as np
import typer

from . import __version__
from .adapters import build_adapter
from .capabilities import Capability
from .controller import ControllerState
from .experiment import Experiment
from .framebuffer import color_palette, diff_frames, extract_glyphs
from .lab import GameLab
from .memory import diff_ram
from .observation import ExperimentResult

app = typer.Typer(
    name="game-lab",
    help="Reverse-engineer old video games through a programmable emulator.",
    no_args_is_help=True,
    add_completion=False,
    context_settings={"help_option_names": ["-h", "--help"]},
)

frame_app = typer.Typer(help="Framebuffer comparison utilities.", no_args_is_help=True)
memory_app = typer.Typer(help="Memory (RAM) inspection utilities.", no_args_is_help=True)
state_app = typer.Typer(help="Emulator save-state utilities.", no_args_is_help=True)
results_app = typer.Typer(help="Experiment result utilities.", no_args_is_help=True)
app.add_typer(frame_app, name="frame")
app.add_typer(memory_app, name="memory")
app.add_typer(state_app, name="state")
app.add_typer(results_app, name="results")


def _version(value: bool) -> None:
    if value:
        typer.echo(f"game-lab {__version__}")
        raise typer.Exit()


@app.callback()
def _main(
    version: bool = typer.Option(
        False, "--version", callback=_version, is_eager=True, help="Show version and exit."
    ),
) -> None:
    """game-lab: controlled experiments over an emulator."""


# -- helpers ----------------------------------------------------------------


def _make_lab(rom: Optional[str], seed: int = 123, adapter: str = "ale-stella") -> GameLab:
    emu = build_adapter(adapter, seed=seed)
    lab = GameLab(emu)
    if rom:
        lab.load(rom)
    return lab


def _echo_json(obj) -> None:
    if hasattr(obj, "model_dump"):
        typer.echo(obj.model_dump_json(indent=2))
    else:
        typer.echo(json.dumps(obj, indent=2, default=str))


# -- info / inputs ----------------------------------------------------------


@app.command()
def info(
    rom: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROM file to inspect."),
    adapter: str = typer.Option("ale-stella", "--adapter",
                                help="Adapter name (e.g. ale-stella-multi for two-player)."),
) -> None:
    """Show adapter capabilities and ROM metadata as JSON."""
    lab = _make_lab(str(rom), adapter=adapter)
    payload = {
        **asdict(lab.rom_info()),
        "inputs": {str(k): [b.value for b in v] for k, v in lab.inputs().items()},
    }
    _echo_json(payload)


@app.command()
def inputs(
    rom: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROM file to inspect."),
    adapter: str = typer.Option("ale-stella", "--adapter",
                                help="Adapter name (e.g. ale-stella-multi for two-player)."),
) -> None:
    """List available generic buttons per controller port as JSON."""
    lab = _make_lab(str(rom), adapter=adapter)
    payload = {
        "multi_controller": bool(lab.capabilities() & Capability.MULTI_CONTROLLER),
        "ports": {
            str(port): [b.value for b in buttons]
            for port, buttons in lab.inputs().items()
        },
        "adapter": adapter,
    }
    _echo_json(payload)


# -- run --------------------------------------------------------------------


@app.command()
def run(
    experiment: Path = typer.Argument(..., exists=True, dir_okay=False,
                                      help="Experiment JSON file to run."),
    output: Optional[Path] = typer.Option(
        None, "--output", "-o", help="Write the structured result JSON to this path."
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Do not print the result."),
    adapter: Optional[str] = typer.Option(
        None, "--adapter",
        help="Adapter name (e.g. ale-stella-multi for two-player). "
        "Defaults to the experiment's declared adapter.",
    ),
) -> None:
    """Run an experiment and emit its structured result as JSON."""
    declared = Experiment.from_file(str(experiment)).adapter
    name = adapter or declared
    lab = _make_lab(rom=None, adapter=name)
    result = lab.run_experiment_file(str(experiment))
    if output:
        GameLab.save_result(result, str(output))
    if not quiet:
        _echo_json(result)


# -- step (quick single shot) ----------------------------------------------


@app.command()
def step(
    rom: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROM file."),
    frames: int = typer.Option(1, "--frames", "-f", min=1, help="Frames to advance."),
    inputs: Optional[str] = typer.Option(
        None, "--inputs", "-i",
        help="Port-1 buttons, comma-separated, e.g. RIGHT,BUTTON_1. Use 'NONE' for release.",
    ),
    reset: bool = typer.Option(True, "--reset/--no-reset", help="Reset before stepping."),
    seed: int = typer.Option(123, "--seed", help="Random seed."),
) -> None:
    """Quickly advance frames and print a structured observation as JSON."""
    lab = _make_lab(str(rom), seed=seed)
    if reset:
        lab.reset()
    state = _parse_port1_inputs(inputs)
    res = lab.step({1: state} if state is not None else None, frames=frames)
    fb_info = lab.describe_frame(lab.framebuffer())
    ram_info = lab.describe_ram(lab.ram())
    payload = {
        "step_result": asdict(res),
        "framebuffer": {
            "width": fb_info.width, "height": fb_info.height,
            "channels": fb_info.channels, "sha256": fb_info.sha256,
        },
        "ram": {"size": ram_info.size, "sha256": ram_info.sha256},
    }
    _echo_json(payload)


def _parse_port1_inputs(text: Optional[str]) -> Optional[ControllerState]:
    if text is None:
        return None
    cleaned = text.strip().upper()
    if cleaned in ("", "NONE"):
        return ControllerState.empty()
    return ControllerState.from_names([p.strip() for p in cleaned.split(",") if p.strip()])


# -- screenshot -------------------------------------------------------------


@app.command()
def screenshot(
    rom: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROM file."),
    output: Path = typer.Option(Path("screenshot.png"), "--output", "-o", help="PNG output path."),
    frames: int = typer.Option(0, "--frames", "-f", min=0, help="Frames to advance first."),
    inputs: Optional[str] = typer.Option(None, "--inputs", "-i", help="Port-1 buttons."),
    reset: bool = typer.Option(True, "--reset/--no-reset"),
) -> None:
    """Capture a screenshot PNG after optionally advancing frames."""
    lab = _make_lab(str(rom))
    if reset:
        lab.reset()
    state = _parse_port1_inputs(inputs)
    if frames:
        lab.step({1: state} if state is not None else None, frames=frames)
    path = lab.screenshot(str(output))
    typer.echo(path)


# -- frame subcommands ------------------------------------------------------


@frame_app.command("diff")
def frame_diff(
    a: Path = typer.Argument(..., exists=True, dir_okay=False, help="First PNG/frame."),
    b: Path = typer.Argument(..., exists=True, dir_okay=False, help="Second PNG/frame."),
    connectivity: int = typer.Option(4, "--connectivity", min=4, max=8),
    min_region_area: int = typer.Option(1, "--min-region-area", min=1),
) -> None:
    """Diff two PNG images and emit a machine-readable change description."""
    fa, fb = _load_image(a), _load_image(b)
    d = diff_frames(fa, fb, connectivity=connectivity, min_region_area=min_region_area)
    _echo_json(d.to_dict())


@frame_app.command("colors")
def frame_colors(
    png: Path = typer.Argument(..., exists=True, dir_okay=False, help="PNG image to analyze."),
    top_n: int = typer.Option(8, "--top", "-n", min=1, max=64, help="Number of colors to return."),
) -> None:
    """Analyze the color palette of a PNG image."""
    frame = _load_image(png)
    _echo_json(color_palette(frame, top_n=top_n))


@frame_app.command("glyphs")
def frame_glyphs(
    png: Path = typer.Argument(..., exists=True, dir_okay=False, help="PNG image to analyze."),
    region: Optional[str] = typer.Option(
        None, "--region", help="Crop to this region before extracting: x,y,w,h."
    ),
    min_area: int = typer.Option(8, "--min-area", min=1, help="Drop glyphs smaller than this many pixels."),
    top_n: int = typer.Option(32, "--top", "-n", min=1, max=256, help="Maximum number of glyphs to return."),
) -> None:
    """Extract connected non-background glyphs (digits, sprites, icons).

    Each glyph carries a tight bounding box, pixel count, dominant colors,
    and a sha256 fingerprint of its pixels. Fingerprints change when a glyph
    changes shape, so a text-only agent can detect "the score digit changed"
    without vision.
    """
    frame = _load_image(png)
    region_tuple = None
    if region:
        parts = [int(p) for p in region.split(",")]
        if len(parts) != 4:
            raise typer.BadParameter("--region must be x,y,w,h")
        region_tuple = tuple(parts)  # type: ignore[assignment]
    _echo_json(extract_glyphs(frame, region=region_tuple, min_area=min_area, top_n=top_n))


def _load_image(path: Path) -> np.ndarray:
    from PIL import Image
    img = Image.open(path).convert("RGB")
    return np.array(img, dtype=np.uint8)


# -- memory subcommands -----------------------------------------------------


@memory_app.command("dump")
def memory_dump(
    rom: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROM file."),
    frames: int = typer.Option(0, "--frames", "-f", min=0, help="Frames to advance first."),
    inputs: Optional[str] = typer.Option(None, "--inputs", "-i", help="Port-1 buttons."),
    output: Optional[Path] = typer.Option(
        None, "--output", "-o", help="Write raw RAM bytes here (binary)."
    ),
    reset: bool = typer.Option(True, "--reset/--no-reset"),
) -> None:
    """Dump the current RAM as raw bytes and/or a JSON description."""
    lab = _make_lab(str(rom))
    if reset:
        lab.reset()
    state = _parse_port1_inputs(inputs)
    if frames:
        lab.step({1: state} if state is not None else None, frames=frames)
    ram = lab.ram()
    if output:
        output.write_bytes(bytes(ram))
    info = lab.describe_ram(ram)
    payload = {
        "size": info.size,
        "sha256": info.sha256,
        "values": [int(x) for x in ram],
        "output_file": str(output) if output else None,
    }
    _echo_json(payload)


@memory_app.command("poke")
def memory_poke(
    rom: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROM file."),
    address: int = typer.Argument(..., min=0, help="RAM byte address to write."),
    value: int = typer.Argument(..., min=0, max=255, help="Byte value to write."),
    frames: int = typer.Option(30, "--frames", "-f", min=0,
                               help="Frames to advance after the poke."),
    inputs: Optional[str] = typer.Option(None, "--inputs", "-i", help="Port-1 buttons."),
    adapter: str = typer.Option("ale-stella", "--adapter",
                                help="Adapter name (e.g. ale-stella-multi for two-player)."),
    reset: bool = typer.Option(True, "--reset/--no-reset"),
) -> None:
    """Write one byte to RAM, then advance some frames and report the result."""
    lab = _make_lab(str(rom), adapter=adapter)
    if reset:
        lab.reset()
    before = int(lab.ram()[address])
    lab.set_ram(address, value)
    state = _parse_port1_inputs(inputs)
    if frames:
        lab.step({1: state} if state is not None else None, frames=frames)
    after = int(lab.ram()[address])
    payload = {
        "adapter": adapter,
        "address": address,
        "value": value,
        "value_before": before,
        "value_after": after,
        "frames": frames,
        "survived": after == value,
        "ram_sha256": lab.describe_ram(lab.ram()).sha256,
    }
    _echo_json(payload)


@memory_app.command("diff")
def memory_diff(
    a: Path = typer.Argument(..., exists=True, dir_okay=False, help="First RAM binary."),
    b: Path = typer.Argument(..., exists=True, dir_okay=False, help="Second RAM binary."),
) -> None:
    """Diff two raw RAM dumps and emit per-address changes as JSON."""
    ra = a.read_bytes()
    rb = b.read_bytes()
    _echo_json(diff_ram(ra, rb).to_dict())


# -- state subcommands ------------------------------------------------------


@state_app.command("save")
def state_save(
    rom: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROM file."),
    output: Path = typer.Argument(..., help="Where to write a state descriptor JSON."),
    frames: int = typer.Option(0, "--frames", "-f", min=0, help="Frames to advance first."),
    inputs: Optional[str] = typer.Option(None, "--inputs", "-i", help="Port-1 buttons."),
    reset: bool = typer.Option(True, "--reset/--no-reset"),
) -> None:
    """Reach a state, save it, and write a JSON descriptor with a frame number.

    The actual emulator state lives only in the running process (it cannot be
    serialized to disk by ALE). This command is most useful as a building block
    within a single experiment run; for branching experiments use the
    ``save_state``/``restore_state`` fields in an experiment file.
    """
    lab = _make_lab(str(rom))
    if reset:
        lab.reset()
    state = _parse_port1_inputs(inputs)
    if frames:
        lab.step({1: state} if state is not None else None, frames=frames)
    handle = lab.save_state()
    payload = {
        "save_state_id": handle.id,
        "frame_number": handle.frame_number,
        "output": str(output),
        "note": (
            "ALE state handles are in-memory only and live within this CLI process. "
            "Use experiment files' save_state/restore_state fields to branch within "
            "a single run."
        ),
    }
    _echo_json(payload)


# -- results subcommands ---------------------------------------------------


def _load_result(path: Path) -> ExperimentResult:
    with open(path, encoding="utf-8") as fh:
        return ExperimentResult.model_validate(json.load(fh))


@results_app.command("compare")
def results_compare(
    a: Path = typer.Argument(..., exists=True, dir_okay=False, help="First result JSON."),
    b: Path = typer.Argument(..., exists=True, dir_okay=False, help="Second result JSON."),
) -> None:
    """Structurally diff two experiment results, aligned by sample index."""
    _echo_json(GameLab.compare_results(_load_result(a), _load_result(b)))


def main() -> None:  # pragma: no cover
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
