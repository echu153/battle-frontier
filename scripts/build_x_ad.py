from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT = PUBLIC / "ads" / "battle-frontier-x-ad.png"

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


def paste_fit(base, path, box, shadow=True):
    img = Image.open(path).convert("RGBA")
    x, y, bw, bh = box
    img.thumbnail((bw, bh), Image.Resampling.LANCZOS)
    px = x + (bw - img.width) // 2
    py = y + (bh - img.height) // 2
    if shadow:
        alpha = img.getchannel("A")
        sh = Image.new("RGBA", img.size, (0, 0, 0, 170))
        sh.putalpha(alpha)
        shadow_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        shadow_layer.alpha_composite(sh, (px, py + 12))
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(8))
        base.alpha_composite(shadow_layer)
    base.alpha_composite(img, (px, py))


def text_center(draw, xy, text, font_obj, fill):
    x, y = xy
    box = draw.textbbox((0, 0), text, font=font_obj)
    draw.text((x - (box[2] - box[0]) / 2, y), text, font=font_obj, fill=fill)


def add_noise(img, opacity=16):
    noise = Image.effect_noise((W, H), 18).convert("L")
    overlay = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    overlay.putalpha(noise.point(lambda p: min(opacity, max(0, p - 118))))
    img.alpha_composite(overlay)


canvas = Image.new("RGBA", (W, H), (12, 25, 38, 255))

bg = Image.open(PUBLIC / "taitorugamen.png").convert("RGBA")
bg = bg.resize((W, H), Image.Resampling.LANCZOS)
bg.putalpha(60)
canvas.alpha_composite(bg)

shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle((26, 34, 1174, 653), radius=20, fill=(0, 0, 0, 72))
shadow = shadow.filter(ImageFilter.GaussianBlur(10))
canvas.alpha_composite(shadow)

card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(card)
draw.rounded_rectangle((24, 24, 1176, 651), radius=18, fill=(244, 249, 253, 255), outline=(109, 130, 147, 255), width=3)
draw.rounded_rectangle((38, 38, 1162, 637), radius=12, outline=(212, 226, 238, 255), width=2)
canvas.alpha_composite(card)
add_noise(canvas, 13)
draw = ImageDraw.Draw(canvas)

decor = (99, 119, 137, 185)
draw.line((426, 73, 520, 73), fill=decor, width=3)
draw.line((680, 73, 774, 73), fill=decor, width=3)
draw.polygon([(541, 62), (557, 73), (541, 84), (525, 73)], outline=decor)
draw.polygon([(659, 62), (675, 73), (659, 84), (643, 73)], outline=decor)
text_center(draw, (600, 47), "放置で進む本格バトルRPG", font(33, True), (35, 56, 75))

draw.text((66, 104), "BATTLE FRONTIER", font=font(96, True), fill=(7, 17, 30))
draw.rounded_rectangle((67, 211, 825, 216), radius=3, fill=(31, 59, 85, 58))

draw.text((70, 246), "寝ている間も、冒険が進む。", font=font(43, True), fill=(16, 77, 122))
draw.text((72, 302), "育成・装備・ペット・レイドを遊びこめる", font=font(26, True), fill=(48, 74, 95))
draw.text((72, 337), "ブラウザで今すぐ無料プレイ！", font=font(26, True), fill=(48, 74, 95))

draw.rounded_rectangle((72, 392, 408, 474), radius=9, fill=(247, 251, 255), outline=(157, 178, 195), width=4)
draw.ellipse((96, 412, 140, 456), fill=(31, 104, 168))
draw.pieslice((93, 404, 151, 462), 70, 290, fill=(247, 251, 255))
draw.text((164, 412), "放置キャンプ", font=font(34, True), fill=(37, 56, 74))

ground = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(ground)
gd.ellipse((455, 410, 1125, 523), fill=(97, 71, 40, 52))
ground = ground.filter(ImageFilter.GaussianBlur(2))
canvas.alpha_composite(ground)

paste_fit(canvas, PUBLIC / "papia.png", (468, 331, 150, 155))
paste_fit(canvas, PUBLIC / "koboruto2.png", (590, 340, 150, 150))
paste_fit(canvas, PUBLIC / "sukerutonken.png", (705, 332, 160, 160))
paste_fit(canvas, PUBLIC / "suraimu3.png", (835, 362, 120, 120))
paste_fit(canvas, PUBLIC / "zerugiasu.png", (950, 252, 195, 220))

draw = ImageDraw.Draw(canvas)
draw.rectangle((0, 540, W, 643), fill=(232, 240, 247, 244))
draw.line((54, 540, 1146, 540), fill=(169, 186, 200), width=2)

features = [
    ((72, 571), "育成と装備を強化", "ATK"),
    ((350, 571), "放置中も経験値蓄積", "Zz"),
    ((650, 571), "ペット・レイドも充実", "PET"),
    ((947, 571), "無料プレイ", "GO"),
]
for (x, y), label, mark in features:
    draw.rounded_rectangle((x, y - 25, x + 40, y + 16), radius=6, fill=(31, 104, 168, 25), outline=(31, 104, 168, 85), width=2)
    text_center(draw, (x + 20, y - 22), mark, font(17, True), (31, 104, 168))
    draw.text((x + 52, y - 25), label, font=font(22, True), fill=(49, 71, 90))

OUT.parent.mkdir(parents=True, exist_ok=True)
canvas.convert("RGB").save(OUT, quality=95)
print(OUT)
