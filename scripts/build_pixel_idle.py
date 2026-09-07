"""Build a transparent flame-flicker and roar loop from one pixel-art sprite."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter


def flame_masks(sprite: Image.Image) -> tuple[list[Image.Image], Image.Image]:
    """Split luminous cyan/magenta fire pixels into asynchronous flicker groups."""
    hsv = sprite.convert('RGB').convert('HSV')
    alpha = sprite.getchannel('A')
    groups = [Image.new('L', sprite.size) for _ in range(3)]
    gp = [group.load() for group in groups]
    hp = hsv.load()
    ap = alpha.load()

    for y in range(sprite.height):
        for x in range(sprite.width):
            hue, saturation, value = hp[x, y]
            luminous_magic = (
                saturation > 90
                and value > 145
                and (112 <= hue <= 158 or 196 <= hue <= 234)
            )
            if luminous_magic and ap[x, y] > 24:
                gp[((x // 9) + (y // 7)) % 3][x, y] = ap[x, y]

    combined = ImageChops.lighter(groups[0], ImageChops.lighter(groups[1], groups[2]))
    return groups, combined


def tint_flames(sprite: Image.Image, masks: list[Image.Image], phase: float) -> Image.Image:
    result = sprite.copy()
    for index, mask in enumerate(masks):
        wave = math.sin(phase * math.tau * (5 + index) + index * 2.1)
        strength = 1.03 + 0.20 * (wave + 1.0) / 2.0
        bright = ImageEnhance.Brightness(sprite).enhance(strength)
        result = Image.composite(bright, result, mask)
        # Let the outer flame pixels lick upward/sideways without redrawing the body.
        accent = Image.new('RGBA', sprite.size, (0, 0, 0, 0))
        accent.paste(bright, (0, 0), mask)
        drift_x = -1 if wave < -0.35 else 1 if wave > 0.55 else 0
        drift_y = -1 if wave > 0.0 else 0
        result.alpha_composite(accent, (drift_x, drift_y))
    return result


def roar_amount(phase: float) -> float:
    # One short roar late in every eight-second idle loop.
    start, end = 0.64, 0.78
    if not start <= phase <= end:
        return 0.0
    return math.sin(math.pi * (phase - start) / (end - start))


def frame_at(
    sprite: Image.Image,
    masks: list[Image.Image],
    flame_mask: Image.Image,
    phase: float,
    canvas_size: int,
) -> Image.Image:
    flickering = tint_flames(sprite, masks, phase)

    # Constant magical aura: intensity changes independently from the body.
    glow_wave = (math.sin(phase * math.tau * 4.0) + 1.0) / 2.0
    glow_alpha = flame_mask.filter(ImageFilter.GaussianBlur(radius=4))
    glow_alpha = glow_alpha.point(lambda a: round(a * (0.14 + glow_wave * 0.12)))
    glow = Image.new('RGBA', sprite.size, (0, 0, 0, 0))
    glow_color = Image.new('RGBA', sprite.size, (50, 135, 255, 255))
    glow.paste(glow_color, (0, 0), glow_alpha)

    roar = roar_amount(phase)
    scale = 1.0 + 0.025 * roar
    width = max(1, round(sprite.width * scale))
    height = max(1, round(sprite.height * scale))
    posed = flickering.resize((width, height), Image.Resampling.NEAREST)
    posed_glow = glow.resize((width, height), Image.Resampling.NEAREST)

    # During the roar the dragon lunges right and shudders; otherwise it stays planted.
    shake = round(math.sin(phase * math.tau * 38) * 2.0 * roar)
    lunge = round(5 * roar)
    anchor_y = canvas_size - 12
    x = (canvas_size - width) // 2 + lunge
    y = anchor_y - height + shake

    frame = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    frame.alpha_composite(posed_glow, (x, y))
    frame.alpha_composite(posed, (x, y))

    # Pixel shock rings make the occasional roar readable even at battle size.
    if roar > 0.18:
        draw = ImageDraw.Draw(frame)
        head_x = round(canvas_size * 0.57) + lunge
        head_y = round(canvas_size * 0.32) + shake
        opacity = round(205 * roar)
        for radius, width_px in ((11, 2), (18, 2), (26, 1)):
            draw.arc(
                (head_x - radius, head_y - radius, head_x + radius, head_y + radius),
                start=300,
                end=420,
                fill=(145, 235, 255, opacity),
                width=width_px,
            )
    # Some image viewers expose RGB hidden under fully transparent WebP pixels.
    # Canonicalize them so the asset stays clean in every pipeline.
    frame.putdata([
        (0, 0, 0, 0) if alpha == 0 else (red, green, blue, alpha)
        for red, green, blue, alpha in frame.get_flattened_data()
    ])
    return frame


def build(source: Path, output: Path, size: int, frames: int, duration_ms: int) -> None:
    image = Image.open(source).convert('RGBA')
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)

    max_sprite = size - 28
    ratio = min(max_sprite / image.width, max_sprite / image.height)
    sprite = image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.Resampling.NEAREST,
    )
    masks, combined = flame_masks(sprite)
    animation = [frame_at(sprite, masks, combined, i / frames, size) for i in range(frames)]
    output.parent.mkdir(parents=True, exist_ok=True)

    common = dict(
        save_all=True,
        append_images=animation[1:],
        duration=duration_ms // frames,
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
    parser.add_argument('--size', type=int, default=336)
    parser.add_argument('--frames', type=int, default=64)
    parser.add_argument('--duration-ms', type=int, default=8000)
    args = parser.parse_args()
    build(args.source, args.output, args.size, args.frames, args.duration_ms)
