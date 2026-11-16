import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function prepareMedia({ root, userData, packaged }) {
  if (!packaged) return { voicesDirectory: join(root, 'assets', 'voices'), stickersDirectory: join(root, 'assets', 'stickers') };
  const directory = join(userData, 'media');
  for (const kind of ['voices', 'stickers']) {
    const target = join(directory, kind);
    await mkdir(target, { recursive: true });
    // Adopt recordings/images from older portable installs, retaining user changes.
    await copyMissing(join(root, 'assets', kind), target);
  }
  return { voicesDirectory: join(directory, 'voices'), stickersDirectory: join(directory, 'stickers') };
}

async function copyMissing(source, destination) {
  await mkdir(destination, { recursive: true });
  let entries;
  try { entries = await readdir(source, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    try { await lstat(to); continue; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (entry.isDirectory()) await copyMissing(from, to);
    else if (entry.isFile()) await copyFile(from, to, 1);
  }
}
