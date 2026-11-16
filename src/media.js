import { copyFile, lstat, mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function prepareMedia({ root, userData, packaged }) {
  if (!packaged) return { voicesDirectory: join(root, 'assets', 'voices'), stickersDirectory: join(root, 'assets', 'stickers') };
  const directory = join(userData, 'media');
  for (const kind of ['voices', 'stickers']) {
    const target = join(directory, kind);
    await mkdir(target, { recursive: true });
    // Adopt recordings/images from older portable installs, retaining user changes.
    await copyMissing(join(root, 'assets', kind), target);
  }
  await mergeVoiceManifest(join(root, 'assets', 'voices'), join(directory, 'voices'));
  return { voicesDirectory: join(directory, 'voices'), stickersDirectory: join(directory, 'stickers') };
}

async function copyMissing(source, destination) {
  await mkdir(destination, { recursive: true });
  let entries;
  try { entries = await readdir(source, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    let existing;
    try { existing = await lstat(to); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (entry.isDirectory() && (!existing || (existing.isDirectory() && !existing.isSymbolicLink()))) await copyMissing(from, to);
    else if (entry.isFile() && !existing) await copyFile(from, to, 1);
  }
}

async function mergeVoiceManifest(source, destination) {
  let bundled, current;
  const manifest = join(destination, 'manifest.json');
  try {
    bundled = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
    current = JSON.parse(await readFile(manifest, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return;
    throw error;
  }
  if (!Array.isArray(bundled.clips) || !Array.isArray(current.clips) || current.clips.length > 200) return;
  const ids = new Set(current.clips.map(clip => clip?.id));
  const additions = bundled.clips.filter(clip => typeof clip?.id === 'string' && !ids.has(clip.id)).slice(0, 200 - current.clips.length);
  if (!additions.length) return;
  const previous = await readFile(manifest);
  const backup = join(destination, 'manifest.before-bundled-import.json');
  try { await copyFile(manifest, backup, 1); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const temporary = `${manifest}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...current, clips: [...current.clips, ...additions] }, null, 2) + '\n', 'utf8');
  // Single application instance: preserve the old catalog until the atomic swap.
  // The backup above retains the pre-import user manifest for manual recovery.
  if (!(await readFile(manifest)).equals(previous)) throw new Error('语音清单已改变，请重启以重新合并语音包。');
  await rename(temporary, manifest);
}
