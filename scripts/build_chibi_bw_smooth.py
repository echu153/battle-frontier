"""Build a smooth Gen-V-inspired multi-region battle sprite animation."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image

from build_chibi_performance import clean_alpha, normalized_keyframes


def deform(sprite: Image.Image, phase: float, *, energy: float = 1.0) -> Image.Image:
    """Apply a continuous inverse-mapped puppet deformation without cross-fading."""
    source = np.asarray(sprite, dtype=np.uint8)
    height, width = source.shape[:2]
    yy, xx = np.indices((height, width), dtype=np.float32)

    anchor_y = height - 8.0
    center_x = width / 2.0
    breath = math.sin(phase)
    follow = math.sin(phase - 0.62)  # roughly a tenth-second visual lag

    scale_y = 1.0 + 0.0105 * breath * energy
    scale_x = 1.0 - 0.0055 * breath * energy
    bob = -1.7 * breath * energy
    sway = 0.8 * math.sin(phase - 0.28) * energy

    # Continuous weights avoid rectangular slice seams. The right/upper field
    # corresponds mainly to the large rear hair mass; the lower field lets the
    # dress hem follow through on a different phase.
    hair_x = np.clip((xx - width * 0.43) / (width * 0.47), 0.0, 1.0)
    hair_y = np.clip((height * 0.80 - yy) / (height * 0.58), 0.0, 1.0)
    hair_weight = hair_x * hair_y
    hem_weight = np.clip((yy - height * 0.58) / (height * 0.37), 0.0, 1.0)

    local_x = 2.35 * hair_weight * follow * energy
    local_x += 1.05 * hem_weight * math.sin(phase + 0.48) * energy
    local_y = 0.65 * hair_weight * math.cos(phase - 0.62) * energy

    source_x = center_x + (xx - center_x - sway - local_x) / scale_x
    source_y = anchor_y + (yy - anchor_y - bob - local_y) / scale_y
    source_x = np.rint(source_x).astype(np.int32)
    source_y = np.rint(source_y).astype(np.int32)

    valid = (source_x >= 0) & (source_x < width) & (source_y >= 0) & (source_y < height)
    result = np.zeros_like(source)
    result[valid] = source[source_y[valid], source_x[valid]]
    return clean_alpha(Image.fromarray(result, 'RGBA'))


def select_pose(keys: list[Image.Image], time_s: float) -> tuple[Image.Image, float, float]:
    """Return sprite, local phase and deformation energy for idle/idle-break."""
    if time_s < 7.15:
        return keys[0], time_s, 1.0
    if time_s < 7.42:
        return keys[4], time_s * 1.15, 0.8
    if time_s < 7.68:
        return keys[5], time_s * 1.45, 1.35
    if time_s < 7.93:
        return keys[6], time_s * 1.7, 1.5
    if time_s < 8.68:
        return keys[7], time_s * 1.25, 0.9
    if time_s < 9.05:
        return keys[8], time_s * 1.3, 1.15
    return keys[0], time_s, 0.85


def build(source: Path, output: Path, width: int, height: int, fps: int, duration_ms: int) -> None:
    sheet = Image.open(source).convert('RGBA')
    keys = normalized_keyframes(sheet, width, height)
    seconds = duration_ms / 1000.0
    frame_count = max(2, round(seconds * fps))
    frames: list[Image.Image] = []

    for index in range(frame_count):
        if index == frame_count - 1:
            frames.append(deform(keys[0], 0.0, energy=1.0))
            continue
        time_s = index * seconds / (frame_count - 1)
        sprite, local_time, energy = select_pose(keys, time_s)
        phase = local_time * math.tau / 1.72
        frames.append(deform(sprite, phase, energy=energy))

    durations = [duration_ms // frame_count + (1 if i < duration_ms % frame_count else 0) for i in range(frame_count)]
    output.parent.mkdir(parents=True, exist_ok=True)
    common = dict(save_all=True, append_images=frames[1:], duration=durations, loop=0)
    if output.suffix.lower() == '.webp':
        frames[0].save(output, format='WEBP', lossless=True, quality=92, method=6, **common)
    else:
        frames[0].save(output, format='PNG', disposal=0, blend=0, optimize=True, **common)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--width', type=int, default=256)
    parser.add_argument('--height', type=int, default=304)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--duration-ms', type=int, default=10000)
    args = parser.parse_args()
    build(args.source, args.output, args.width, args.height, args.fps, args.duration_ms)
