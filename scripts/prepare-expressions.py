"""Align user-generated expression art onto the original transparent portrait.

Requires Pillow and source PNGs in artifacts/原图. Original images are never
modified. Run from any directory: python scripts/prepare-expressions.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parents[1]
PORTRAITS = ROOT / "assets" / "portraits"
SOURCES = ROOT / "artifacts" / "原图"
BASE = Image.open(PORTRAITS / "portrait-desktop.png").convert("RGBA")
if BASE.size != (626, 1024):
    raise ValueError("Expression masks were aligned for the 626 x 1024 portrait.")

EXPRESSIONS = {
    "portrait-blink.png": ("blink.png", [(200, 250, 285, 341), (313, 263, 398, 355)]),
    "portrait-happy.png": ("\u95ed\u773c\u8868\u60c5.png", [(204, 264, 397, 371)]),
    "portrait-shy.png": ("\u5bb3\u7f9e.png", [(204, 252, 397, 357)]),
    "portrait-smile.png": ("可常驻脸红微笑.png", [(204, 250, 399, 371)]),
    "portrait-sleepy.png": ("半眯眼困倦.png", [(204, 250, 399, 371)]),
    "portrait-pout.png": ("嘟嘴.png", [(204, 250, 399, 371)]),
    "portrait-talk.png": ("嘴巴微张说话.png", [(270, 324, 327, 369)]),
    "portrait-laugh.png": ("大笑.png", [(204, 250, 399, 371)]),
    "portrait-teary.png": ("委屈流泪.png", [(204, 250, 399, 374)]),
    "portrait-surprised.png": ("张嘴惊讶.png", [(204, 250, 399, 371)]),
    "portrait-annoyed.png": ("生气无语.png", [(204, 250, 399, 371)]),
}

# A tilted head needs its matching hair, ears and silhouette. Use the whole
# supplied drawing for this pose rather than inserting tilted eyes into a face.
FULL_FRAMES = {"portrait-confused.png": "疑惑.png"}

# These symbols are part of the generated expression art. Keep them only in
# the matching short-lived expression frame, rather than in the base portrait.
ICONS = {
    "portrait-surprised.png": ("张嘴惊讶.png", (541, 36, 590, 128),
                               [(7, 0), (48, 0), (49, 24), (33, 68), (0, 68)],
                               (0, 62, 32, 92), (544, 30)),
}

def make_frame(source_name, regions):
    source_path = SOURCES / source_name
    if not source_path.is_file():
        raise FileNotFoundError(f"Put the generated source image here: {source_path}")
    donor = Image.open(source_path).convert("RGB").resize(BASE.size, Image.Resampling.LANCZOS)
    mask = Image.new("L", BASE.size)
    draw = ImageDraw.Draw(mask)
    for box in regions:
        draw.rounded_rectangle(box, radius=12, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(2))
    frame = Image.composite(donor.convert("RGBA"), BASE, mask)
    frame.putalpha(BASE.getchannel("A"))
    return frame


def add_icon(frame, source_name, box, outline, dot_box, position):
    source_path = SOURCES / source_name
    donor = Image.open(source_path).convert("RGB").resize(BASE.size, Image.Resampling.LANCZOS)
    icon = donor.crop(box).convert("RGBA")
    # Trace only the symbol, excluding nearby hair/ears. Preserve the symbol's
    # pale/white interior instead of treating every white pixel as background.
    silhouette = Image.new("L", icon.size)
    draw = ImageDraw.Draw(silhouette)
    draw.polygon(outline, fill=255)
    draw.ellipse(dot_box, fill=255)
    difference = ImageChops.difference(Image.new("RGB", icon.size, "white"), icon.convert("RGB"))
    ink = difference.convert("L").point(lambda value: 255 if value >= 18 else 0)
    alpha = ImageChops.multiply(silhouette, ink.filter(ImageFilter.MaxFilter(3)))
    # Fill enclosed white areas, including the white rim between colored lines.
    outside = alpha.point(lambda value: 0 if value else 255)
    ImageDraw.floodfill(outside, (0, 0), 128)
    enclosed = outside.point(lambda value: 255 if value == 255 else 0)
    alpha = ImageChops.lighter(alpha, ImageChops.multiply(enclosed, silhouette))
    icon.putalpha(alpha)
    frame.alpha_composite(icon, position)
    return frame


def make_full_frame(source_name):
    source = Image.open(SOURCES / source_name).convert("RGB")
    width, height = source.size
    # Remove only near-white regions connected to the outside. The white parts
    # of the face/clothes and the question mark remain opaque within their lines.
    background = Image.new("L", source.size)
    background.putdata([
        255 if min(pixel) >= 235 and max(pixel) - min(pixel) <= 18 else 0
        for pixel in (source.get_flattened_data() if hasattr(source, "get_flattened_data") else source.getdata())
    ])
    # Close tiny breaks in the pale AI-drawn outlines before the background
    # flood, otherwise it can leak into white hair and facial highlights.
    background = background.filter(ImageFilter.MinFilter(5))
    for x in range(width):
        for y in (0, height - 1):
            if background.getpixel((x, y)) == 255:
                ImageDraw.floodfill(background, (x, y), 128)
    for y in range(height):
        for x in (0, width - 1):
            if background.getpixel((x, y)) == 255:
                ImageDraw.floodfill(background, (x, y), 128)
    # The halo encloses a separate piece of the same white page.
    halo_hole = (round(width * .24), round(height * .065))
    if background.getpixel(halo_hole) == 255:
        ImageDraw.floodfill(background, halo_hole, 128)
    alpha = background.point(lambda value: 0 if value == 128 else 255).filter(ImageFilter.MinFilter(3))
    # Leave the original source and its watermark untouched; omit the detached
    # source label from the runtime transparent sprite.
    ImageDraw.Draw(alpha).rectangle((width * .81, height * .96, width, height), fill=0)
    rgba = source.convert("RGBA")
    rgba.putalpha(alpha)
    ratio = min(BASE.width / width, BASE.height / height)
    resized = rgba.resize((round(width * ratio), round(height * ratio)), Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", BASE.size)
    frame.alpha_composite(resized, ((BASE.width - resized.width) // 2, BASE.height - resized.height))
    return frame

frames = {"portrait-desktop.png": BASE}
for output_name, (source_name, regions) in EXPRESSIONS.items():
    frame = make_frame(source_name, regions)
    if output_name in ICONS:
        frame = add_icon(frame, *ICONS[output_name])
    frame.save(PORTRAITS / output_name, optimize=True)
    if output_name not in ICONS:
        assert frame.getchannel("A").tobytes() == BASE.getchannel("A").tobytes()
    assert ImageChops.difference(BASE.convert("RGB"), frame.convert("RGB")).crop((0, 380, 626, 1024)).getbbox() is None
    frames[output_name] = frame

for output_name, source_name in FULL_FRAMES.items():
    frame = make_full_frame(source_name)
    frame.save(PORTRAITS / output_name, optimize=True)
    frames[output_name] = frame

artifacts = ROOT / "artifacts"
artifacts.mkdir(exist_ok=True)
tile_width, tile_height = 200, 350
columns = 6
comparison = Image.new("RGB", (tile_width * columns, tile_height * ((len(frames) + columns - 1) // columns)), "#d9e4e7")
for index, frame in enumerate(frames.values()):
    layer = frame.resize((tile_width, 327), Image.Resampling.LANCZOS)
    background = Image.new("RGBA", layer.size, "#d9e4e7")
    background.alpha_composite(layer)
    x, y = index % columns * tile_width, index // columns * tile_height
    comparison.paste(background.convert("RGB"), (x, y))
    ImageDraw.Draw(comparison).text((x + 4, y + 329), list(frames)[index].removeprefix("portrait-"), fill="#193b46")
comparison.save(artifacts / "表情对比.png")

print(f"Prepared {len(EXPRESSIONS) + len(FULL_FRAMES)} expression frames in assets/portraits/.")
print("Comparison: artifacts/表情对比.png")
