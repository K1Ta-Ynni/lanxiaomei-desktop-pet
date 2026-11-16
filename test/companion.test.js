import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_PREFERENCES, INTERACTIONS, validatePreferences, loadVoices, loadStickers } from '../src/companion.js';

test('rejects invalid local preferences rather than persisting unusable values', () => {
  assert.deepEqual(validatePreferences(DEFAULT_PREFERENCES), DEFAULT_PREFERENCES);
  const { clickSticker, portraitMode, ...legacy } = DEFAULT_PREFERENCES;
  assert.deepEqual(validatePreferences(legacy), DEFAULT_PREFERENCES, 'older preferences gain new defaults without losing volume or scale');
  for (const changed of [{ scale: NaN }, { scale: 2 }, { volume: -1 }, { muted: 'yes' }]) {
    assert.throws(() => validatePreferences({ ...DEFAULT_PREFERENCES, ...changed }));
  }
});

test('shared interaction catalog exposes all local actions through a bounded command API', () => {
  for (const type of ['greet', 'jump', 'sway', 'sleep', 'wake', 'playVoice', 'stopVoice', 'showSticker', 'hideSticker', 'setPreferences', 'resetPosition']) {
    assert.ok(INTERACTIONS.some(command => command.id === type));
  }
});

test('voice manifest fences files to its own directory and skips missing entries', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pet-voices-'));
  try {
    const directory = join(temp, 'voices');
    await mkdir(directory);
    assert.deepEqual(await loadVoices(directory), { clips: [], warnings: [] });
    await writeFile(join(directory, 'hello.wav'), 'test fixture');
    await writeFile(join(temp, 'outside.wav'), 'must not load');
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ clips: [
      { id: 'hello', file: 'hello.wav', label: '问候', group: '唱歌', random: false, duration: 120 },
      { id: 'outside', file: '../outside.wav' },
      { id: 'missing', file: 'missing.mp3' },
      { id: 'script', file: 'script.js' },
      { id: 'hello', file: 'hello.wav' },
    ] }));
    const catalog = await loadVoices(directory);
    assert.equal(catalog.clips.length, 1);
    assert.equal(catalog.clips[0].id, 'hello');
    assert.equal(catalog.clips[0].random, false);
    assert.equal(catalog.clips[0].group, '唱歌');
    assert.equal(catalog.clips[0].duration, 120);
    assert.match(catalog.clips[0].src, /^file:/);
    assert.equal(catalog.warnings.length, 4);
    await writeFile(join(directory, 'manifest.json'), '{broken');
    await assert.rejects(loadVoices(directory), /清单无法读取/u);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('measured playback gain is applied only when recording bytes still match', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pet-loudness-'));
  try {
    const bytes = Buffer.from('audio fixture');
    await writeFile(join(temp, 'hello.wav'), bytes);
    await writeFile(join(temp, 'manifest.json'), JSON.stringify({ clips: [{ id: 'hello', file: 'hello.wav' }] }));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(temp, 'loudness.json'), JSON.stringify({ clips: [{ id: 'hello', sha256, gainDb: 8 }] }));
    assert.equal((await loadVoices(temp)).clips[0].gainDb, 8);
    await writeFile(join(temp, 'hello.wav'), 'user edited audio');
    assert.equal((await loadVoices(temp)).clips[0].gainDb, 0, 'edited audio never receives stale gain');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('stickers are indexed by safe local filename IDs', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pet-stickers-'));
  try {
    const directory = join(temp, 'stickers');
    await mkdir(directory);
    await writeFile(join(directory, '点头.gif'), 'test image');
    await writeFile(join(directory, 'lanjie-007.gif'), 'test image');
    await writeFile(join(directory, 'ignore.txt'), 'no');
    await writeFile(join(temp, 'outside.png'), 'must not load');
    const catalog = await loadStickers(directory);
    assert.equal(catalog.stickers.length, 2);
    assert.ok(catalog.stickers.some(row => row.id === '点头.gif'));
    assert.equal(catalog.stickers.find(row => row.id === 'lanjie-007.gif').label, '表情 007');
    assert.ok(catalog.stickers.every(row => row.animated));
    assert.match(catalog.stickers[0].src, /^file:/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
