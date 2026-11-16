"""Import numbered stickers without modifying originals or re-encoding GIFs.

Requires Pillow. The ignored catalog in artifacts keeps numbers stable on reruns.
"""
from pathlib import Path
from hashlib import sha256
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'artifacts' / '蓝姐表情包'
TARGET = ROOT / 'assets' / 'stickers'
CATALOG = ROOT / 'artifacts' / 'sticker-import.json'
TARGET.mkdir(parents=True, exist_ok=True)
rows = json.loads(CATALOG.read_text(encoding='utf-8')) if CATALOG.exists() else []
by_hash = {row['sha256']: row for row in rows}
number = max([row['number'] for row in rows] + [0])
for source in sorted(SOURCE.iterdir()):
    if source.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp', '.gif'}:
        continue
    data = source.read_bytes()
    digest = sha256(data).hexdigest()
    with Image.open(source) as image:
        image.verify()
    if digest not in by_hash:
        number += 1
        row = {'number': number, 'source': source.name,
               'file': f'lanjie-{number:03}{source.suffix.lower()}', 'sha256': digest}
        rows.append(row)
        by_hash[digest] = row
    target = TARGET / by_hash[digest]['file']
    if target.exists() and sha256(target.read_bytes()).hexdigest() != digest:
        raise ValueError(f'Refusing to overwrite edited sticker: {target}')
    if not target.exists():
        shutil.copyfile(source, target)
CATALOG.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Imported {len(rows)} numbered stickers; original GIF bytes preserved.')
