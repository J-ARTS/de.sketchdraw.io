#!/usr/bin/env python3
"""Builds the Sketchdraw app icons from build/icon-source.png (#171).

The source is the artwork as delivered: the icon body (a white rounded square) on a flat dark background.
This script cuts the body out, and writes

  build/icon.icns        macOS  – body on the 824/1024 grid with the usual soft shadow
  build/icon.ico         Windows – 16 … 256 px
  build/icons/<n>x<n>.png  Linux – 16 … 1024 px
  public/app-icon.png    window icon (Windows/Linux) and browser tab

Run `python3 tools/build-app-icons.py` after replacing the source and commit the results. Needs Pillow.
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon-source.png"
MASTER = 1024
MARKER = (255, 0, 255)
# Colour distance (sum over RGB) that still counts as the flat background around the icon body.
BACKGROUND_TOLERANCE = 60
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
# macOS draws no mask of its own: the body sits on Apple's grid (824 of 1024) and carries its shadow.
MAC_BODY = 824
# Windows and Linux show the bitmap as it is, so the body fills the canvas up to a thin safety margin.
PLAIN_BODY = 960


def cut_out(source: Image.Image) -> Image.Image:
    """Returns the icon body as a square RGBA image with a transparent, anti-aliased outline."""
    rgb = source.convert("RGB")
    flooded = rgb.copy()
    width, height = rgb.size
    for corner in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        ImageDraw.floodfill(flooded, corner, MARKER, thresh=BACKGROUND_TOLERANCE)
    marker = Image.new("RGB", rgb.size, MARKER)
    body = ImageChops.difference(flooded, marker).convert("L").point(lambda value: 255 if value else 0)
    # Two pixels in from the outline, so no background colour is left in the edge; then a soft edge again.
    body = body.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
    box = body.point(lambda value: 255 if value >= 128 else 0).getbbox()
    if box is None:
        raise SystemExit("No icon body found in the source image.")
    cut = rgb.convert("RGBA")
    cut.putalpha(body)
    side = max(box[2] - box[0], box[3] - box[1])
    # The delivered body is about one percent off square; it is evened out here.
    return cut.crop(box).resize((side, side), Image.Resampling.LANCZOS)


def place(body: Image.Image, size: int, shadow: bool) -> Image.Image:
    canvas = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    scaled = body.resize((size, size), Image.Resampling.LANCZOS)
    offset = (MASTER - size) // 2
    if shadow:
        shade = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
        alpha = scaled.getchannel("A").point(lambda value: value * 30 // 100)
        shade.paste((0, 0, 0, 255), (offset, offset + 12), alpha)
        canvas = Image.alpha_composite(canvas, shade.filter(ImageFilter.GaussianBlur(12)))
    canvas.alpha_composite(scaled, (offset, offset))
    return canvas


def png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def scaled(master: Image.Image, size: int) -> Image.Image:
    return master if size == master.width else master.resize((size, size), Image.Resampling.LANCZOS)


def icns(master: Image.Image) -> bytes:
    # PNG-coded entries of the icns container; 16 pt is served by its @2x entry.
    entries = [(b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024), (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512)]
    body = b""
    for kind, size in entries:
        data = png(scaled(master, size))
        body += kind + (len(data) + 8).to_bytes(4, "big") + data
    return b"icns" + (len(body) + 8).to_bytes(4, "big") + body


def ico(master: Image.Image) -> bytes:
    images = [png(scaled(master, size)) for size in ICO_SIZES]
    header = (0).to_bytes(2, "little") + (1).to_bytes(2, "little") + len(images).to_bytes(2, "little")
    offset = 6 + 16 * len(images)
    directory = b""
    for size, data in zip(ICO_SIZES, images):
        directory += bytes([size % 256, size % 256, 0, 0]) + (1).to_bytes(2, "little") + (32).to_bytes(2, "little") + len(data).to_bytes(4, "little") + offset.to_bytes(4, "little")
        offset += len(data)
    return header + directory + b"".join(images)


def outputs() -> dict[Path, bytes]:
    body = cut_out(Image.open(SOURCE))
    mac = place(body, MAC_BODY, shadow=True)
    plain = place(body, PLAIN_BODY, shadow=False)
    files = {ROOT / "build" / "icon.icns": icns(mac), ROOT / "build" / "icon.ico": ico(plain), ROOT / "public" / "app-icon.png": png(scaled(plain, 256))}
    for size in LINUX_SIZES:
        files[ROOT / "build" / "icons" / f"{size}x{size}.png"] = png(scaled(plain, size))
    return files


def main() -> int:
    for path, data in outputs().items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"{path.relative_to(ROOT).as_posix()}  {len(data)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
