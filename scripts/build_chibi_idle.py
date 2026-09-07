"""Build a transparent chibi idle animation from a single pixel-art sprite."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter


def magic_mask(sprite: Image.Image) -> Image.Image:
    mask = Image.new('L', sprite.size)
    src = sprite.load()
    dst = mask.load()
    for y in range(sprite.height):
        for x in range(sprite.width):
            red, green, blue, alpha = src[x, y]
            if alpha > 24 and red > 90 and red > green * 1.28 and red > blue * 1.12:
                dst[x, y] = alpha
    return mask


def sway_rows(sprite: Image.Image, phase: float) -> Image.Image:
    """Move one-pixel rows so long hair and the dress hem visibly drift."""
    result = Image.new('RGBA', sprite.size, (0, 0, 0, 0))
    height = sprite.height
    for y in range(height):
        relative = y / max(1, height - 1)
        top_flow = max(0.0, 0.43 - relative) * 3.2
        hem_flow = max(0.0, relative - 0.52) * 4.8
        body_flow = 0.45
        amount = body_flow + top_flow + hem_flow
        offset = round(amount * math.sin(phase * math.tau + relative * 2.6))
        result.alpha_composite(sprite.crop((0, y, sprite.width, y + 1)), (offset, y))
    return result


def frame_at(sprite: Image.Image, red_mask: Image.Image, phase: float, canvas: tuple[int, int]) -> Image.Image:
    # A restrained two-beat breath; the feet remain anchored.
    breath = (1.0 - math.cos(phase * math.tau * 2.0)) / 2.0
    height = max(1, round(sprite.height * (0.994 + breath * 0.014)))
    breathing = sprite.resize((sprite.width, height), Image.Resampling.NEAREST)
    mask = red_mask.resize((sprite.width, height), Image.Resampling.NEAREST)
    posed = sway_rows(breathing, phase)

    # Red accents pulse without changing the costume or adding a background.
    pulse = 1.08 + 0.22 * (math.sin(phase * math.tau * 3.0) + 1.0) / 2.0
    bright = ImageEnhance.Brightness(posed).enhance(pulse)
    posed = Image.composite(bright, posed, mask)

    aura_alpha = mask.filter(ImageFilter.GaussianBlur(radius=3))
    aura_alpha = aura_alpha.point(lambda value: round(value * (0.08 + 0.08 * breath)))
    aura = Image.new('RGBA', posed.size, (0, 0, 0, 0))
    aura_color = Image.new('RGBA', posed.size, (225, 38, 50, 255))
    aura.paste(aura_color, (0, 0), aura_alpha)

    frame = Image.new('RGBA', canvas, (0, 0, 0, 0))
    anchor_y = canvas[1] - 10
    bob = round(-2 * breath)
    x = (canvas[0] - posed.width) // 2
    y = anchor_y - posed.height + bob
    frame.alpha_composite(aura, (x, y))
    frame.alpha_composite(posed, (x, y))
    frame.putdata([
        (0, 0, 0, 0) if alpha == 0 else (red, green, blue, alpha)
        for red, green, blue, alpha in frame.get_flattened_data()
    ])
    return frame


def build(source: Path, output: Path, width: int, height: int, frames: int, duration_ms: int) -> None:
    image = Image.open(source).convert('RGBA')
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)

    ratio = min((width - 28) / image.width, (height - 24) / image.height)
    sprite = image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.Resampling.NEAREST,
    )
    red_mask = magic_mask(sprite)
    animation = [frame_at(sprite, red_mask, index / frames, (width, height)) for index in range(frames)]
    output.parent.mkdir(parents=True, exist_ok=True)
    animation[0].save(
        output,
        format='WEBP',
        save_all=True,
        append_images=animation[1:],
        duration=duration_ms // frames,
        loop=0,
        lossless=True,
        quality=92,
        method=6,
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--width', type=int, default=256)
    parser.add_argument('--height', type=int, default=304)
    parser.add_argument('--frames', type=int, default=48)
    parser.add_argument('--duration-ms', type=int, default=6000)
    args = parser.parse_args()
    build(args.source, args.output, args.width, args.height, args.frames, args.duration_ms)
