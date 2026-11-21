import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isSong } from '../src/music.js';

// Repository/source catalogs retain songs; portable builds ship only recordings.
// Copy only referenced voice files, excluding orphaned copies and song directories.
export async function packageVoices(source, destination) {
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.clips)) throw new Error('Voice manifest requires a clips array.');
  const clips = manifest.clips.filter(clip => !isSong(clip));
  const base = await realpath(source);
  const files = new Map();
  for (const clip of clips) {
    if (typeof clip.file !== 'string' || isAbsolute(clip.file)) throw new Error('Invalid voice path.');
    const file = await realpath(resolve(base, clip.file));
    const local = relative(base, file);
    if (local === '..' || local.startsWith('..\\') || local.startsWith('../') || isAbsolute(local)) {
      throw new Error('Voice file must stay inside the source media directory.');
    }
    files.set(local, file);
  }
  await mkdir(destination, { recursive: true });
  for (const [local, file] of files) {
    const target = join(destination, local);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file, target);
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ ...manifest, clips }, null, 2) + '\n', 'utf8');
  for (const metadata of ['README.md', 'loudness.json']) {
    try {
      // Retain song gain metadata so recordings from earlier installs keep their
      // playback level; this tiny JSON contains no audio or user preferences.
      await copyFile(join(source, metadata), join(destination, metadata));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { voiceClips: clips.length, songsExcluded: manifest.clips.length - clips.length };
}
