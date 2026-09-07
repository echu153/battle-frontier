"""Build a snappy cel-based handheld-RPG battle idle from a 3x3 sprite sheet."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from build_chibi_performance import clean_alpha, normalized_keyframes


def transform_sprite(
    sprite: Image.Image,
    width: int,
    height: int,
    *,
    dx: int = 0,
    dy: int = 0,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
    tilt: float = 0.0,
) -> Image.Image:
    bbox = sprite.getchannel('A').getbbox()
    crop = sprite.crop(bbox)
    crop = crop.resize(
        (max(1, round(crop.width * scale_x)), max(1, round(crop.height * scale_y))),
        Image.Resampling.NEAREST,
    )
    if tilt:
        crop = crop.rotate(tilt, resample=Image.Resampling.NEAREST, expand=True)
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    x = (width - crop.width) // 2 + dx
    y = height - crop.height - 8 + dy
    canvas.alpha_composite(crop, (x, y))
    return clean_alpha(canvas)


def build(source: Path, output: Path, width: int, height: int, frames: int, duration_ms: int) -> None:
    sheet = Image.open(source).convert('RGBA')
    keys = normalized_keyframes(sheet, width, height)
    animation: list[Image.Image] = []
    seconds = duration_ms / 1000

    # Integer offsets, nearest-neighbour deformation and held cels deliberately
    # mimic handheld battle-sprite timing. There is no image cross-fading.
    idle_keys = (0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 0, 0, 0)
    idle_y = (1, 1, 0, -1, -2, -2, -1, 0, 1, 1, 1, 1, 1, 1, 1)
    idle_sx = (1.00, 1.00, 0.99, 0.99, 0.98, 0.98, 1.00, 1.01, 1.01, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00)
    idle_sy = (0.99, 0.99, 1.00, 1.01, 1.02, 1.02, 1.01, 1.00, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99)

    for index in range(frames):
        if index == frames - 1:
            animation.append(transform_sprite(keys[0], width, height, dy=1, scale_y=0.99))
            continue
        time_s = index * seconds / (frames - 1)

        if time_s < 5.45 or time_s >= 7.35:
            phase = int((time_s % 1.25) / 1.25 * len(idle_keys)) % len(idle_keys)
            animation.append(transform_sprite(
                keys[idle_keys[phase]], width, height,
                dy=idle_y[phase], scale_x=idle_sx[phase], scale_y=idle_sy[phase],
            ))
        elif time_s < 5.72:
            animation.append(transform_sprite(keys[5], width, height, dy=3, scale_x=1.025, scale_y=0.975, tilt=-1.0))
        elif time_s < 5.92:
            animation.append(transform_sprite(keys[6], width, height, dx=-2, dy=-3, scale_x=0.98, scale_y=1.03, tilt=1.0))
        elif time_s < 6.72:
            shake = -1 if index % 2 else 1
            animation.append(transform_sprite(keys[7], width, height, dx=shake, dy=-2, scale_x=0.99, scale_y=1.02))
        elif time_s < 6.98:
            animation.append(transform_sprite(keys[8], width, height, dx=1, dy=0, scale_x=1.015, scale_y=0.99, tilt=-1.0))
        else:
            animation.append(transform_sprite(keys[0], width, height, dy=1, scale_x=1.00, scale_y=0.99))

    durations = [duration_ms // frames + (1 if i < duration_ms % frames else 0) for i in range(frames)]
    output.parent.mkdir(parents=True, exist_ok=True)
    animation[0].save(
        output,
        format='PNG',
        save_all=True,
        append_images=animation[1:],
        duration=durations,
        loop=0,
        disposal=0,
        blend=0,
        optimize=True,
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--width', type=int, default=256)
    parser.add_argument('--height', type=int, default=304)
    parser.add_argument('--frames', type=int, default=96)
    parser.add_argument('--duration-ms', type=int, default=8000)
    args = parser.parse_args()
    build(args.source, args.output, args.width, args.height, args.frames, args.duration_ms)
