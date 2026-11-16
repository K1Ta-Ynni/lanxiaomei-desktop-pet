"""Measure perceived loudness and derive safe playback gains; never rewrite audio.

Requires FFmpeg. Reports and playback metadata can be regenerated from the pack.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'assets' / 'voices'
TARGET = -18.0  # LUFS, a moderate spoken-audio level before the user's volume.
CEILING = -1.5  # dBTP, retain peak headroom without clipping or compression.


def measure(clip):
    path = DIRECTORY / clip['file']
    result = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path),
                             '-af', f'loudnorm=I={TARGET}:TP={CEILING}:LRA=11:print_format=json',
                             '-f', 'null', '-'], capture_output=True, encoding='utf-8',
                            errors='replace', check=True)
    start = result.stderr.rfind('{')
    stats = json.loads(result.stderr[start:result.stderr.index('}', start) + 1])
    loudness, peak = float(stats['input_i']), float(stats['input_tp'])
    gain = min(TARGET - loudness, CEILING - peak, 36) if math.isfinite(loudness) and math.isfinite(peak) else 0
    gain = round(max(-36, gain), 2)
    return {'id': clip['id'], 'file': clip['file'], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'integratedLufs': loudness if math.isfinite(loudness) else None,
            'truePeakDb': peak if math.isfinite(peak) else None,
            'gainDb': gain,
            'estimatedLufs': round(loudness + gain, 2) if math.isfinite(loudness) else None,
            'peakLimited': math.isfinite(peak) and CEILING - peak < TARGET - loudness}


manifest = json.loads((DIRECTORY / 'manifest.json').read_text(encoding='utf-8'))
with ThreadPoolExecutor(max_workers=3) as executor:
    rows = list(executor.map(measure, manifest['clips']))
report = {'targetLufs': TARGET, 'peakCeilingDb': CEILING, 'clips': rows}
(DIRECTORY / 'loudness.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'clips': len(rows), 'beforeLufsRange': [min(row['integratedLufs'] for row in rows if row['integratedLufs'] is not None), max(row['integratedLufs'] for row in rows if row['integratedLufs'] is not None)],
                  'afterLufsRange': [min(row['estimatedLufs'] for row in rows if row['estimatedLufs'] is not None), max(row['estimatedLufs'] for row in rows if row['estimatedLufs'] is not None)],
                  'peakLimited': [row['id'] for row in rows if row['peakLimited']]}, indent=2))
