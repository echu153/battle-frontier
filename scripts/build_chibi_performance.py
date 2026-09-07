"""Build a smooth breathing/hair/pose loop from a 3x3 pixel-art keyframe sheet."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def keep_main_sprite(cell: Image.Image) -> Image.Image:
    """Remove neighboring-cell bleed while retaining the connected character."""
    alpha = cell.getchannel('A')
    pixels = alpha.load()
    width, height = cell.size
    visited = bytearray(width * height)
    largest: list[tuple[int, int]] = []

    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if visited[offset] or pixels[x, y] <= 16:
                continue
            stack = [(x, y)]
            visited[offset] = 1
            component: list[tuple[int, int]] = []
            while stack:
                px, py = stack.pop()
                component.append((px, py))
                for ny in range(max(0, py - 1), min(height, py + 2)):
                    for nx in range(max(0, px - 1), min(width, px + 2)):
                        neighbor = ny * width + nx
                        if not visited[neighbor] and pixels[nx, ny] > 16:
                            visited[neighbor] = 1
                            stack.append((nx, ny))
            if len(component) > len(largest):
                largest = component

    keep = Image.new('L', cell.size, 0)
    keep_pixels = keep.load()
    for x, y in largest:
        keep_pixels[x, y] = pixels[x, y]
    cleaned = cell.copy()
    cleaned.putalpha(keep)
    return clean_alpha(cleaned)


def normalized_keyframes(sheet: Image.Image, width: int, height: int) -> list[Image.Image]:
    cells = []
    for row in range(3):
        top = round(row * sheet.height / 3)
        bottom = round((row + 1) * sheet.height / 3)
        for column in range(3):
            left = round(column * sheet.width / 3)
            right = round((column + 1) * sheet.width / 3)
            cells.append(keep_main_sprite(sheet.crop((left, top, right, bottom))))
    cropped = []
    for cell in cells:
        bbox = cell.getchannel('A').getbbox()
        cropped.append(cell.crop(bbox) if bbox else cell)

    max_w = max(image.width for image in cropped)
    max_h = max(image.height for image in cropped)
    scale = min((width - 18) / max_w, (height - 16) / max_h)

    normalized = []
    for image in cropped:
        resized = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.NEAREST,
        )
        canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        x = (width - resized.width) // 2
        y = height - resized.height - 8
        canvas.alpha_composite(resized, (x, y))
        normalized.append(canvas)
    return normalized


def clean_alpha(frame: Image.Image) -> Image.Image:
    frame.putdata([
        (0, 0, 0, 0) if alpha == 0 else (red, green, blue, alpha)
        for red, green, blue, alpha in frame.get_flattened_data()
    ])
    return frame


def build(source: Path, output: Path, width: int, height: int, frames: int, duration_ms: int) -> None:
    sheet = Image.open(source).convert('RGBA')
    keyframes = normalized_keyframes(sheet, width, height)
    seconds = duration_ms / 1000.0
    animation = []

    # Timing intentionally gives breathing and hair follow-through room, while
    # the hand sweep is quick and the signature pose is held long enough to read.
    key_times = [0.0, 1.15, 2.15, 3.35, 5.25, 7.35, 8.10, 8.75, 9.55, seconds]
    key_order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0]

    for index in range(frames):
        if index == frames - 1:
            animation.append(keyframes[0].copy())
            continue
        time_s = index * seconds / (frames - 1)
        segment = next(i for i in range(len(key_times) - 1) if key_times[i] <= time_s < key_times[i + 1])
        start_time, end_time = key_times[segment], key_times[segment + 1]
        progress = smoothstep((time_s - start_time) / (end_time - start_time))
        frame = Image.blend(keyframes[key_order[segment]], keyframes[key_order[segment + 1]], progress)
        animation.append(clean_alpha(frame))

    output.parent.mkdir(parents=True, exist_ok=True)
    common = dict(
        save_all=True,
        append_images=animation[1:],
        duration=[duration_ms // frames + (1 if i < duration_ms % frames else 0) for i in range(frames)],
        loop=0,
    )
    if output.suffix.lower() == '.webp':
        animation[0].save(output, format='WEBP', lossless=True, quality=92, method=6, **common)
    else:
        animation[0].save(output, format='PNG', disposal=0, blend=0, optimize=True, **common)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--width', type=int, default=256)
    parser.add_argument('--height', type=int, default=304)
    parser.add_argument('--frames', type=int, default=120)
    parser.add_argument('--duration-ms', type=int, default=10000)
    args = parser.parse_args()
    build(args.source, args.output, args.width, args.height, args.frames, args.duration_ms)
