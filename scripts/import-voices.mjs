// Copies the owner's source pack without changing any original recording.
// ffprobe (FFmpeg) is required only for importing, never for running the pet.
import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'artifacts', '蓝姐语音包');
const target = join(root, 'assets', 'voices');
const manifestPath = join(target, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const previous = new Map(manifest.clips.map(clip => [clip.id, clip]));
const imported = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { await walk(path); continue; }
    if (!/\.(mp3|wav|ogg)$/iu.test(item.name)) continue;
    const local = relative(source, path).replaceAll('\\', '/');
    const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
      'stream=codec_name:format=duration', '-of', 'json', path], { encoding: 'utf8', windowsHide: true }));
    if (!metadata.streams?.length) throw new Error(`No audio stream: ${local}`);
    const duration = Number(metadata.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid audio duration: ${local}`);
    const id = 'lanjie_' + createHash('sha256').update(local).digest('hex').slice(0, 12);
    const group = local.includes('/') ? local.split('/')[0] : '常用语音';
    const file = 'lanjie/' + local;
    const destination = join(target, file);
    await mkdir(join(destination, '..'), { recursive: true });
    try { await copyFile(path, destination, 1); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await readFile(path)).equals(await readFile(destination))) throw new Error(`Existing audio differs; left unchanged: ${file}`);
    }
    imported.push({ id, label: basename(local, extname(local)).replace(/\s*\(\d+\)$/u, '').trim(),
      file, group, text: '', duration: Math.round(duration * 1000) / 1000,
      random: group !== '唱歌' && duration <= 30, ...previous.get(id) });
    previous.delete(id);
  }
}
await walk(source);
await writeFile(manifestPath, JSON.stringify({ ...manifest, clips: [...previous.values(), ...imported] }, null, 2) + '\n', 'utf8');
const groups = {};
for (const clip of imported) groups[clip.group] = (groups[clip.group] || 0) + 1;
console.log(JSON.stringify({ imported: imported.length, groups, randomClips: imported.filter(clip => clip.random).length }, null, 2));
