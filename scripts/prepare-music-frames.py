"""Build stable, transparent singing frames from the owner's three PNGs.

Requires Pillow. Source drawings remain untouched. The body and musical notes
come from frame 1; only the face changes, avoiding flickering outlines/clothes.
Reuse the same two notes at slightly different positions in each frame.
"""
from pathlib import Path
import importlib.util
import json
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_expressions", ROOT / "scripts" / "prepare-expressions.py")
tools = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(tools)


def main():
    base = tools.make_full_frame("音乐1.png", halo_hole=(.33, .042))
    # Guard the music drawing's halo: the ring stays solid, its hole is clear.
    assert base.getpixel((206, 24))[3] == 255
    assert base.getpixel((206, 43))[3] == 0
    note_boxes = [(30, 35, 123, 151), (531, 28, 612, 109)]
    notes = [base.crop(box) for box in note_boxes]
    for box in note_boxes:
        ImageDraw.Draw(base).rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=(0, 0, 0, 0))
    frames = [base]
    mask = Image.new("L", base.size)
    # Include eyes, cheeks and mouth; keep the common hairline and silhouette.
    ImageDraw.Draw(mask).rounded_rectangle((202, 251, 402, 373), radius=18, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(3))
    for index in (2, 3):
        donor = Image.open(tools.SOURCES / f"音乐{index}.png").convert("RGBA")
        ratio = min(base.width / donor.width, base.height / donor.height)
        donor = donor.resize((round(donor.width * ratio), round(donor.height * ratio)), Image.Resampling.LANCZOS)
        aligned = Image.new("RGBA", base.size)
        aligned.alpha_composite(donor, ((base.width - donor.width) // 2, base.height - donor.height))
        frame = Image.composite(aligned, base, mask)
        frame.putalpha(base.getchannel("A"))
        assert ImageChops.difference(base, frame).crop((0, 390, base.width, base.height)).getbbox() is None
        frames.append(frame)
    note_offsets = [((0, 0), (0, 0)), ((-5, -8), (4, 6)), ((5, 5), (-5, -7))]
    for index, frame in enumerate(frames, 1):
        for note, box, offset in zip(notes, note_boxes, note_offsets[index - 1]):
            frame.alpha_composite(note, (box[0] + offset[0], box[1] + offset[1]))
        frame.save(tools.PORTRAITS / f"music-{index}.png", optimize=True)

    preview = Image.new("RGB", (750, 440), "#657a88")
    for index, frame in enumerate(frames):
        layer = frame.resize((244, 400), Image.Resampling.LANCZOS)
        preview.paste(layer, (index * 250 + 3, 3), layer)
        ImageDraw.Draw(preview).text((index * 250 + 8, 413), f"music-{index + 1}", fill="white")
    preview.save(ROOT / "artifacts" / "music-frames-preview.png")
    animation = json.loads((ROOT / "character" / "character.json").read_text(encoding="utf-8"))["musicAnimation"]
    sequence = [int(Path(frame["file"]).stem.rsplit("-", 1)[1]) - 1 for frame in animation]
    tiles = [preview.crop((index * 250, 0, index * 250 + 250, 408)) for index in sequence]
    tiles[0].save(ROOT / "artifacts" / "music-animation-preview.gif", save_all=True,
                  append_images=tiles[1:], duration=[frame["duration"] for frame in animation], loop=0)
    print("Prepared 3 transparent music frames. Preview: artifacts/music-frames-preview.png")


if __name__ == "__main__":
    main()
