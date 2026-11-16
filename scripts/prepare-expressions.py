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

frames = {"portrait-desktop.png": BASE}
for output_name, (source_name, regions) in EXPRESSIONS.items():
    frame = make_frame(source_name, regions)
    frame.save(PORTRAITS / output_name, optimize=True)
    assert frame.getchannel("A").tobytes() == BASE.getchannel("A").tobytes()
    assert ImageChops.difference(BASE.convert("RGB"), frame.convert("RGB")).crop((0, 380, 626, 1024)).getbbox() is None
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

print(f"Prepared {len(EXPRESSIONS)} expression frames in assets/portraits/.")
print("Comparison: artifacts/表情对比.png")
