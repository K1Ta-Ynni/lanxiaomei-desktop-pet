"""Extract cached audio without transcoding. Requires FFmpeg and ffprobe on PATH.

Usage: python scripts/extract-bilibili-audio.py SOURCE --output OUTPUT
Only reads the source cache; outputs audio and a JSON verification report.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def run(*args):
    result = subprocess.run(args, capture_output=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:] or f'{args[0]} failed')
    return result.stdout


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(value)).strip(' .')[:90] or 'untitled'
    if re.fullmatch(r'(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', value):
        value = '_' + value
    return value


def probe(path):
    return json.loads(run('ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)))


def stream_hash(path):
    return run('ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-c:a', 'copy',
               '-f', 'streamhash', '-hash', 'sha256', '-').strip().split('=')[-1]


def extract(metadata, destination, previous=None):
    info = json.loads(metadata.read_text(encoding='utf-8-sig'))
    if info.get('status') not in (None, 'completed'):
        return {'source': str(metadata.parent), 'skipped': 'Cache is not completed'}
    # DASH audio representations use 302xx / 303xx; older clients may call it audio.m4s.
    files = sorted(metadata.parent.glob('*.m4s'))
    candidates = [p for p in files if re.search(r'-(?:302|303)\d+\.m4s$', p.name) or p.name.lower() == 'audio.m4s']
    if not candidates:
        candidates = files
    with tempfile.TemporaryDirectory(prefix='bilibili-audio-') as temporary:
        tracks = []
        for index, source in enumerate(candidates):
            clean = Path(temporary) / f'{index}.m4s'
            with source.open('rb') as incoming, clean.open('wb') as outgoing:
                # Windows client adds exactly nine ASCII zeroes ahead of the MP4 box.
                prefix = incoming.read(9)
                if prefix != b'000000000':
                    outgoing.write(prefix)
                shutil.copyfileobj(incoming, outgoing)
            details = probe(clean)
            for stream in details.get('streams', []):
                if stream['codec_type'] == 'audio':
                    lossless = stream['codec_name'] in ('flac', 'alac', 'wavpack') or stream['codec_name'].startswith('pcm_')
                    rank = (lossless, int(stream.get('bit_rate') or details['format'].get('bit_rate') or 0),
                            int(stream.get('sample_rate') or 0), int(stream.get('channels') or 0))
                    tracks.append((rank, source, clean, stream, details['format']))
                    break
        if not tracks:
            raise RuntimeError('No audio track found')
        _, source, clean, stream, container = max(tracks, key=lambda item: item[0])
        codec = stream['codec_name']
        extension = {'aac': '.m4a', 'alac': '.m4a', 'flac': '.flac', 'mp3': '.mp3',
                     'opus': '.ogg', 'vorbis': '.ogg'}.get(codec, '.mka')
        group = safe_name(info.get('groupTitle') or info.get('bvid') or 'bilibili')
        title = info.get('title') or metadata.parent.name
        folder = destination / group
        folder.mkdir(parents=True, exist_ok=True)
        output = folder / (safe_name(title) + ' [' + safe_name(info.get('cid', metadata.parent.name)) + ']' + extension)
        # Follow renamed exports on repeat runs rather than recreating the old names.
        if previous and previous.get('output'):
            preferred = Path(previous['output']).resolve()
            if destination in preferred.parents and preferred.is_file():
                output = preferred
        original_hash = stream_hash(clean)
        exists = output.exists()
        if exists:
            if stream_hash(output) != original_hash:
                raise RuntimeError('Existing output differs; refusing to overwrite: ' + str(output))
        else:
            staging = Path(temporary) / ('extracted' + extension)
            run('ffmpeg', '-v', 'error', '-n', '-i', str(clean), '-map', '0:a:0', '-c:a', 'copy',
                '-metadata', 'title=' + str(title), str(staging))
            if stream_hash(staging) != original_hash:
                raise RuntimeError('Audio packet hash differs after extraction')
            # Decode every frame, rather than checking only the file header.
            run('ffmpeg', '-v', 'error', '-xerror', '-i', str(staging), '-map', '0:a:0', '-f', 'null', '-')
            with staging.open('rb') as incoming, output.open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
        if exists:
            run('ffmpeg', '-v', 'error', '-xerror', '-i', str(output), '-map', '0:a:0', '-f', 'null', '-')
        return {'title': title, 'displayTitle': output.stem, 'bvid': info.get('bvid'), 'source': str(source), 'output': str(output),
                'codec': codec, 'sampleRate': int(stream.get('sample_rate') or 0), 'channels': stream.get('channels'),
                'bitRate': int(stream.get('bit_rate') or container.get('bit_rate') or 0),
                'duration': float(stream.get('duration') or container.get('duration') or 0),
                'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                'audioPacketSha256': original_hash, 'packetCopyVerified': True, 'fullDecodeVerified': True,
                'availableAudioTracks': len(tracks), 'reused': exists}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=3)
    args = parser.parse_args()
    source, destination = args.source.resolve(), args.output.resolve()
    if not source.is_dir() or destination == source or source in destination.parents:
        parser.error('Source must exist; output must be outside the cache directory.')
    for command in ('ffmpeg', 'ffprobe'):
        if not shutil.which(command):
            parser.error(command + ' is required on PATH')
    destination.mkdir(parents=True, exist_ok=True)
    report_path = destination / 'extraction-report.json'
    previous = {}
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding='utf-8'))
        previous = {str(Path(row['source']).parent): row for row in report.get('files', []) if row.get('output')}
    metadata = sorted(source.rglob('videoInfo.json'))
    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        jobs = {executor.submit(extract, entry, destination, previous.get(str(entry.parent))): entry for entry in metadata}
        for future in as_completed(jobs):
            try:
                row = future.result()
            except Exception as error:
                row = {'source': str(jobs[future].parent), 'error': str(error)}
            rows.append(row)
            print(json.dumps({'done': len(rows), 'total': len(metadata), **row}, ensure_ascii=True), flush=True)
    rows.sort(key=lambda row: row.get('output', row['source']))
    report = {'source': str(source), 'output': str(destination),
              'exported': sum('output' in row for row in rows), 'errors': sum('error' in row for row in rows), 'files': rows}
    (destination / 'extraction-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('exported', 'errors')}, ensure_ascii=True))
    return 1 if report['errors'] or not report['exported'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
