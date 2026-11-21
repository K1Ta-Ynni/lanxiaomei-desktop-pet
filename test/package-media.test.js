import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { packageVoices } from '../scripts/package-media.mjs';
import { prepareMedia } from '../src/media.js';
import { loadVoices } from '../src/companion.js';

test('portable media includes spoken files only while source songs remain intact', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pet-package-media-'));
  try {
    const source = join(temp, 'source'), output = join(temp, 'output');
    await mkdir(join(source, 'mixed'), { recursive: true });
    await mkdir(join(source, 'music'));
    const manifest = { clips: [
      { id: 'voice', file: 'mixed/hello.wav', group: '入场语音' },
      { id: 'song', file: 'mixed/music.m4a', music: true },
      { id: 'legacy', file: 'mixed/legacy.mp3', group: '唱歌' },
    ] };
    for (const file of ['mixed/hello.wav', 'mixed/music.m4a', 'mixed/legacy.mp3', 'music/unindexed.m4a']) {
      await writeFile(join(source, file), file);
    }
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
    const levels = JSON.stringify({ clips: [{ id: 'song', gainDb: -2 }] });
    await writeFile(join(source, 'loudness.json'), levels);
    assert.deepEqual(await packageVoices(source, output), { voiceClips: 1, songsExcluded: 2 });
    assert.deepEqual(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')).clips, [manifest.clips[0]]);
    assert.deepEqual(await readdir(join(output, 'mixed')), ['hello.wav']);
    await assert.rejects(readFile(join(output, 'music/unindexed.m4a')), { code: 'ENOENT' });
    assert.equal(await readFile(join(output, 'loudness.json'), 'utf8'), levels, 'keep gain metadata for existing songs');
    assert.deepEqual(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')), manifest);
    assert.equal(await readFile(join(source, 'mixed/music.m4a'), 'utf8'), 'mixed/music.m4a');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('a package without songs preserves existing song metadata, bytes and measured gain', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pet-song-upgrade-'));
  try {
    const source = join(temp, 'source'), root = join(temp, 'app'), data = join(temp, 'profile');
    const personal = join(data, 'media/voices');
    await mkdir(source); await mkdir(personal, { recursive: true });
    const song = { id: 'song', label: 'My song', file: 'song.m4a', music: true, group: '歌曲' };
    const voice = { id: 'voice', file: 'voice.wav' };
    const bytes = Buffer.from('unchanged encoded audio');
    await writeFile(join(source, 'song.m4a'), bytes);
    await writeFile(join(source, 'voice.wav'), 'spoken fixture');
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ clips: [voice, song] }));
    await writeFile(join(source, 'loudness.json'), JSON.stringify({ clips: [
      { id: 'song', gainDb: 3, sha256: createHash('sha256').update(bytes).digest('hex') },
    ] }));
    const destination = join(root, 'assets/voices');
    await packageVoices(source, destination);
    await writeFile(join(personal, 'song.m4a'), bytes);
    await writeFile(join(personal, 'manifest.json'), JSON.stringify({ clips: [song] }));
    const prefs = JSON.stringify({ musicPlaylist: { mode: 'repeat', ids: ['song'] } });
    await writeFile(join(data, 'preferences.json'), prefs);
    const edits = JSON.stringify({ version: 2, music: { items: { song: { label: 'My label', category: 'My category' } } } });
    await writeFile(join(data, 'media-library.json'), edits);
    await prepareMedia({ root, userData: data, packaged: true });
    await prepareMedia({ root, userData: data, packaged: true });
    const catalog = await loadVoices(personal, { loudnessDirectory: destination });
    assert.deepEqual(catalog.warnings, []);
    assert.deepEqual(catalog.clips.map(clip => clip.id), ['song', 'voice']);
    assert.equal(catalog.clips[0].label, song.label);
    assert.equal(catalog.clips[0].gainDb, 3);
    assert.deepEqual(await readFile(join(personal, 'song.m4a')), bytes);
    assert.equal(await readFile(join(data, 'preferences.json'), 'utf8'), prefs);
    assert.equal(await readFile(join(data, 'media-library.json'), 'utf8'), edits);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
