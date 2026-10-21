#!/usr/bin/env python3
"""Draw the Chessly icon: dark tile, focus brackets, eval badge."""

import struct
import zlib
from pathlib import Path


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            pixels.extend(color_at(x, y, size))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(pixels), 9)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def color_at(x, y, size):
    pad = size * 0.08
    radius = size * 0.22
    if not in_round_rect(x + 0.5, y + 0.5, pad, pad, size - pad, size - pad, radius):
        return (0, 0, 0, 0)
    bracket = size * 0.16
    thickness = max(1, size * 0.045)
    inset = size * 0.22
    if on_brackets(x, y, size, inset, bracket, thickness):
        return (229, 229, 234, 255)
    badge_w = size * 0.28
    badge_h = size * 0.14
    bx = size * 0.56
    by = size * 0.18
    if bx <= x <= bx + badge_w and by <= y <= by + badge_h:
        return (229, 229, 234, 255)
    return (28, 28, 30, 255)


def in_round_rect(x, y, left, top, right, bottom, radius):
    if x < left or x > right or y < top or y > bottom:
        return False
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def on_brackets(x, y, size, inset, length, thickness):
    corners = (
        (inset, inset, 1, 1),
        (size - inset, inset, -1, 1),
        (inset, size - inset, 1, -1),
        (size - inset, size - inset, -1, -1),
    )
    for cx, cy, dx, dy in corners:
        along_x = 0 <= (x - cx) * dx <= length and abs(y - cy) <= thickness
        along_y = 0 <= (y - cy) * dy <= length and abs(x - cx) <= thickness
        if along_x or along_y:
            return True
    return False


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1] / "icons"
    root.mkdir(exist_ok=True)
    for size in (16, 48, 128):
        write_png(root / f"icon{size}.png", size)
