"""Build a restrained trainer idle matching a supplied localized-motion reference."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw

from build_bw_trainer_sprite import coarse_palette, remove_green


def extract_shared(sheet: Image.Image, size: int = 80) -> list[Image.Image]:
    crops: list[Image.Image] = []
    for row in range(2):
        for column in range(4):
            left = round(column * sheet.width / 4)
            right = round((column + 1) * sheet.width / 4)
            top = round(row * sheet.height / 2)
            bottom = round((row + 1) * sheet.height / 2)
            cell = remove_green(sheet.crop((left, top, right, bottom)))
            bbox = cell.getchannel('A').getbbox()
            crops.append(cell.crop(bbox))

    max_width = max(crop.width for crop in crops)
    max_height = max(crop.height for crop in crops)
    scale = min((size - 8) / max_width, (size - 6) / max_height)
    frames: list[Image.Image] = []
    for crop in crops:
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.NEAREST,
        )
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(crop, ((size - crop.width) // 2, size - crop.height - 3))
        frames.append(coarse_palette(canvas))
    return frames


def dynamic_mask(size: int = 80) -> Image.Image:
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    # Face/eyes, reaching hand, rear hair mass and only the outer dress hems.
    draw.rectangle((29, 8, 48, 24), fill=255)
    draw.polygon(((5, 18), (34, 18), (34, 40), (5, 42)), fill=255)
    draw.polygon(((42, 7), (79, 7), (79, 55), (50, 55), (42, 38)), fill=255)
    draw.polygon(((0, 49), (31, 49), (37, 79), (0, 79)), fill=255)
    draw.polygon(((48, 48), (79, 45), (79, 79), (43, 79)), fill=255)
    return mask


def restrained_frame(base: Image.Image, first: Image.Image, second: Image.Image, amount: float, mask: Image.Image) -> Image.Image:
    eased = 0.5 - 0.5 * math.cos(math.pi * amount)
    moving = coarse_palette(Image.blend(first, second, eased))
    # The body core comes from `base` every time, so it cannot bob, rotate or scale.
    return Image.composite(moving, base, mask)


def build(source: Path, sheet_output: Path, animation_output: Path, preview_output: Path) -> None:
    keys = extract_shared(Image.open(source).convert('RGBA'))
    base = keys[0]
    mask = dynamic_mask()

    sheet = Image.new('RGBA', (320, 160), (0, 0, 0, 0))
    for index, key in enumerate(keys):
        sheet.alpha_composite(Image.composite(key, base, mask), ((index % 4) * 80, (index // 4) * 80))
    sheet.save(sheet_output, optimize=True)

    duration_ms = 5440
    fps = 30
    frame_count = round(duration_ms / 1000 * fps)
    stops = (0.00, 0.10, 0.21, 0.32, 0.43, 0.54, 0.64, 0.72, 0.79, 0.86, 0.93, 1.00)
    order = (0, 1, 2, 3, 4, 5, 4, 6, 7, 6, 1, 0)
    animation: list[Image.Image] = []
    for index in range(frame_count):
        progress = index / (frame_count - 1)
        segment = next((i for i in range(len(stops) - 1) if stops[i] <= progress < stops[i + 1]), len(stops) - 2)
        local = (progress - stops[segment]) / (stops[segment + 1] - stops[segment])
        animation.append(restrained_frame(base, keys[order[segment]], keys[order[segment + 1]], local, mask))
    animation[-1] = animation[0].copy()

    durations = [duration_ms // frame_count + (1 if i < duration_ms % frame_count else 0) for i in range(frame_count)]
    common = dict(save_all=True, duration=durations, loop=0, disposal=0, blend=0, optimize=True)
    animation[0].save(animation_output, format='PNG', append_images=animation[1:], **common)
    enlarged = [frame.resize((320, 320), Image.Resampling.NEAREST) for frame in animation]
    enlarged[0].save(preview_output, format='PNG', append_images=enlarged[1:], **common)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('sheet_output', type=Path)
    parser.add_argument('animation_output', type=Path)
    parser.add_argument('preview_output', type=Path)
    args = parser.parse_args()
    build(args.source, args.sheet_output, args.animation_output, args.preview_output)
