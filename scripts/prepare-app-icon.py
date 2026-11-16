"""Regenerate the multi-size Windows icon from the project avatar (requires Pillow)."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
avatar = Image.open(root / "assets" / "portraits" / "avatar.png").convert("RGBA")
avatar.save(root / "assets" / "icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Updated assets/icon.ico from assets/portraits/avatar.png")
