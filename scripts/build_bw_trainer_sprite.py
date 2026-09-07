"""Convert a chroma-key pose sheet into a coarse 80px Gen-V trainer animation."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image


def remove_green(cell: Image.Image) -> Image.Image:
    data = np.asarray(cell.convert('RGBA')).copy()
    red = data[:, :, 0].astype(np.int16)
    green = data[:, :, 1].astype(np.int16)
    blue = data[:, :, 2].astype(np.int16)
    chroma = (green > 90) & (green > red * 1.16 + 12) & (green > blue * 1.16 + 12)
    data[chroma] = (0, 0, 0, 0)
    return Image.fromarray(data, 'RGBA')


def coarse_palette(image: Image.Image, colors: int = 15) -> Image.Image:
    alpha = image.getchannel('A').point(lambda value: 255 if value >= 96 else 0)
    rgb = Image.new('RGB', image.size, (0, 0, 0))
    rgb.paste(image.convert('RGB'), mask=alpha)
    reduced = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
    reduced.putalpha(alpha)
    return reduced


def extract_frames(sheet: Image.Image, size: int) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for row in range(2):
        top = round(row * sheet.height / 2)
        bottom = round((row + 1) * sheet.height / 2)
        for column in range(4):
            left = round(column * sheet.width / 4)
            right = round((column + 1) * sheet.width / 4)
            cell = remove_green(sheet.crop((left, top, right, bottom)))
            bbox = cell.getchannel('A').getbbox()
            crop = cell.crop(bbox)
            scale = min((size - 8) / crop.width, (size - 6) / crop.height)
            crop = crop.resize(
                (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
                Image.Resampling.NEAREST,
            )
            canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            canvas.alpha_composite(crop, ((size - crop.width) // 2, size - crop.height - 3))
            frames.append(coarse_palette(canvas))
    return frames


def puppet_transform(sprite: Image.Image, phase: float, pose_index: int) -> Image.Image:
    bbox = sprite.getchannel('A').getbbox()
    crop = sprite.crop(bbox)

    # Trainer intros combine drawn key poses with small continuous affine motion.
    settle = math.sin(phase * math.pi)
    hop = -round(2.8 * max(0.0, math.sin(phase * math.pi * 1.08)))
    sway = 1.6 * math.sin(phase * math.tau + pose_index * 0.33)
    squash = 1.0 + 0.022 * math.sin(phase * math.tau * 1.35)
    width_scale = 2.0 - squash
    tilt = 1.7 * math.sin(phase * math.pi * 1.1 + pose_index * 0.42)

    crop = crop.resize(
        (max(1, round(crop.width * width_scale)), max(1, round(crop.height * squash))),
        Image.Resampling.NEAREST,
    )
    crop = crop.rotate(tilt, resample=Image.Resampling.NEAREST, expand=True)
    canvas = Image.new('RGBA', sprite.size, (0, 0, 0, 0))
    x = (sprite.width - crop.width) // 2 + round(sway)
    y = sprite.height - crop.height - 3 + hop + round(settle)
    canvas.alpha_composite(crop, (x, y))
    return coarse_palette(canvas)


def save_animation(frames: list[Image.Image], output: Path, preview: Path, duration_ms: int, frame_count: int) -> None:
    # Eight drawn poses, spaced to create anticipation, action, follow-through,
    # magic accent and a comparatively long final settle.
    pose_stops = (0.00, 0.11, 0.23, 0.35, 0.48, 0.61, 0.73, 0.84, 1.01)
    animation: list[Image.Image] = []
    for index in range(frame_count):
        progress = index / (frame_count - 1)
        pose = next((i for i in range(8) if pose_stops[i] <= progress < pose_stops[i + 1]), 7)
        local = (progress - pose_stops[pose]) / (pose_stops[pose + 1] - pose_stops[pose])
        animation.append(puppet_transform(frames[pose], local, pose))
    animation[-1] = animation[0].copy()

    durations = [duration_ms // frame_count + (1 if i < duration_ms % frame_count else 0) for i in range(frame_count)]
    output.parent.mkdir(parents=True, exist_ok=True)
    common = dict(save_all=True, duration=durations, loop=0, disposal=0, blend=0, optimize=True)
    animation[0].save(output, format='PNG', append_images=animation[1:], **common)

    enlarged = [frame.resize((frame.width * 4, frame.height * 4), Image.Resampling.NEAREST) for frame in animation]
    enlarged[0].save(preview, format='PNG', append_images=enlarged[1:], **common)


def build(source: Path, sheet_output: Path, animation_output: Path, preview_output: Path) -> None:
    source_sheet = Image.open(source).convert('RGBA')
    frames = extract_frames(source_sheet, 80)
    sheet = Image.new('RGBA', (320, 160), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, ((index % 4) * 80, (index // 4) * 80))
    sheet.save(sheet_output, optimize=True)
    save_animation(frames, animation_output, preview_output, duration_ms=4300, frame_count=162)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('sheet_output', type=Path)
    parser.add_argument('animation_output', type=Path)
    parser.add_argument('preview_output', type=Path)
    args = parser.parse_args()
    build(args.source, args.sheet_output, args.animation_output, args.preview_output)
