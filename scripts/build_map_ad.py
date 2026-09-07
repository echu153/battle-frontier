from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT = PUBLIC / "ads" / "battle-frontier-map-ad.png"
W, H = 1200, 675


def font(size, bold=False):
    candidates = [
        Path(r"C:\Windows\Fonts\meiryob.ttc" if bold else r"C:\Windows\Fonts\meiryo.ttc"),
        Path(r"C:\Windows\Fonts\YuGothB.ttc" if bold else r"C:\Windows\Fonts\YuGothR.ttc"),
        Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


def draw_text_shadow(draw, xy, text, font_obj, fill, shadow=(0, 0, 0, 180), offset=(0, 3), stroke=0):
    x, y = xy
    if stroke:
        draw.text((x, y), text, font=font_obj, fill=shadow, stroke_width=stroke, stroke_fill=shadow)
    else:
        draw.text((x + offset[0], y + offset[1]), text, font=font_obj, fill=shadow)
    draw.text((x, y), text, font=font_obj, fill=fill)


def text_size(draw, text, font_obj):
    box = draw.textbbox((0, 0), text, font=font_obj)
    return box[2] - box[0], box[3] - box[1]


bg = Image.open(PUBLIC / "taitorugamen.png").convert("RGB")
bg = bg.resize((W, H), Image.Resampling.LANCZOS).convert("RGBA")

# Darken the sides while leaving the center logo and map readable.
vignette = Image.new("RGBA", (W, H), (0, 0, 0, 0))
vd = ImageDraw.Draw(vignette)
for x in range(W):
    edge = min(x, W - 1 - x)
    if edge < 210:
        alpha = int(((210 - edge) / 210) ** 1.65 * 135)
        vd.line((x, 0, x, H), fill=(0, 0, 0, alpha))
for y in range(H):
    edge = min(y, H - 1 - y)
    if edge < 120:
        alpha = int(((120 - edge) / 120) ** 1.55 * 90)
        vd.line((0, y, W, y), fill=(0, 0, 0, alpha))
bg.alpha_composite(vignette)

left = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ld = ImageDraw.Draw(left)
for x in range(0, 620):
    alpha = int(188 * (1 - x / 620) ** 1.2)
    ld.line((x, 0, x, H), fill=(4, 13, 24, alpha))
bg.alpha_composite(left)

bottom = Image.new("RGBA", (W, H), (0, 0, 0, 0))
bd = ImageDraw.Draw(bottom)
for y in range(400, H):
    alpha = int(150 * ((y - 400) / (H - 400)) ** 1.3)
    bd.line((0, y, W, y), fill=(3, 9, 18, alpha))
bg.alpha_composite(bottom)

draw = ImageDraw.Draw(bg)

gold = (244, 190, 91)
cream = (246, 241, 224)
blue = (153, 213, 255)
muted = (200, 216, 227)

draw.rounded_rectangle((72, 80, 272, 122), radius=21, fill=(10, 28, 48, 175), outline=(201, 158, 80, 190), width=2)
draw.text((100, 88), "育成バトルRPG", font=font(20, True), fill=gold)

draw_text_shadow(draw, (72, 150), "出撃を重ねて、", font(48, True), cream)
draw_text_shadow(draw, (72, 210), "限界なく強くなれ。", font(48, True), cream)

draw.rounded_rectangle((72, 296, 516, 302), radius=3, fill=(244, 190, 91, 210))
draw.text((72, 326), "ステータス・装備・スキル・ペット・転職", font=font(28, True), fill=blue)
draw.text((72, 369), "強くなる要素が、いくつもある", font=font(28, True), fill=muted)
draw.text((72, 424), "行動までの時間は10秒・20秒のお好みで", font=font(26, True), fill=muted)

brand = "BATTLE FRONTIER"
brand_font = font(44, True)
bw, _ = text_size(draw, brand, brand_font)
draw.text((W - bw - 76, H - 124), brand, font=brand_font, fill=(232, 186, 94, 235))
draw.text((W - 322, H - 64), "#インディーゲーム  #ブラウザゲーム", font=font(18, True), fill=(211, 225, 235, 220))

noise = Image.effect_noise((W, H), 14).convert("L")
grain = Image.new("RGBA", (W, H), (255, 255, 255, 0))
grain.putalpha(noise.point(lambda p: 11 if p > 135 else 0))
bg.alpha_composite(grain)

OUT.parent.mkdir(parents=True, exist_ok=True)
bg.convert("RGB").save(OUT, quality=95)
print(OUT)
