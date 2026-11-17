import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaLibrary } from '../src/media-library.js';
import { isSong } from '../src/music.js';

test('local media edits persist without changing IDs, source groups or original catalogs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pet-library-'));
  try {
    const path = join(directory, 'media-library.json');
    const raw = [{ id: 'song', label: '原歌曲', group: '唱歌', src: 'test.mp3' },
      { id: 'hello', label: '入场', group: '入场语音', random: false }];
    const snapshot = structuredClone(raw);
    const library = new MediaLibrary(path); await library.load();
    const catalog = async () => raw;
    await Promise.all([
      library.edit({ kind: 'voice', action: 'createGroup', name: '收藏' }, catalog),
      library.edit({ kind: 'sticker', action: 'createGroup', name: '收藏' }, async () => []),
    ]);
    await library.edit({ kind: 'voice', action: 'editItem', id: 'song', label: '新歌名', category: '收藏' }, catalog);
    await library.edit({ kind: 'voice', action: 'editItem', id: 'hello', label: '欢迎', category: '收藏' }, catalog);
    await library.edit({ kind: 'voice', action: 'renameGroup', name: '收藏', newName: '最爱' }, catalog);
    assert.deepEqual(raw, snapshot);
    const restarted = new MediaLibrary(path); await restarted.load();
    const [song, entrance] = restarted.decorate('voice', raw);
    assert.equal(song.label, '新歌名'); assert.equal(song.category, '最爱'); assert.equal(song.id, 'song');
    assert.ok(isSong(song)); assert.equal(entrance.group, '入场语音'); assert.equal(entrance.random, false);
    assert.deepEqual(restarted.groups('sticker', []), ['收藏']);
    await restarted.edit({ kind: 'voice', action: 'deleteGroup', name: '最爱' }, catalog);
    assert.ok(restarted.decorate('voice', raw).every(item => item.category === '未分类'));
    await restarted.edit({ kind: 'voice', action: 'resetItem', id: 'song' }, catalog);
    assert.deepEqual(restarted.decorate('voice', raw)[0], { ...raw[0], category: '唱歌' });
    const before = await readFile(path, 'utf8');
    for (const command of [
      { kind: 'other', action: 'createGroup', name: 'x' },
      { kind: 'voice', action: 'editItem', id: 'song', label: '', category: '唱歌' },
      { kind: 'voice', action: 'editItem', id: 'song', label: 'x', category: '不存在' },
      { kind: 'voice', action: 'createGroup', name: '唱歌' },
      { kind: 'voice', action: 'deleteGroup', name: '未分类' },
    ]) await assert.rejects(restarted.edit(command, catalog));
    assert.equal(await readFile(path, 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('audio category migration preserves old edits while splitting songs from voices', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pet-library-migration-'));
  try {
    const path = join(directory, 'media-library.json');
    const legacy = { version: 1, voice: { groups: ['混合收藏', '空分类'], items: {
      song: { label: '新歌名', category: '混合收藏' }, voice: { label: '新语音名', category: '混合收藏' },
    } }, sticker: { groups: ['图包'], items: { pic: { label: '图片', category: '图包' } } } };
    await writeFile(path, JSON.stringify(legacy));
    const songs = [{ id: 'song', label: '原歌名', group: '唱歌' }];
    const voices = [{ id: 'voice', label: '原语音', group: '常用语音' }];
    const library = new MediaLibrary(path); await library.load(async () => [...voices, ...songs]);
    const catalog = async kind => kind === 'music' ? songs : voices;
    assert.equal(library.decorate('music', songs)[0].label, '新歌名');
    assert.equal(library.decorate('voice', voices)[0].label, '新语音名');
    await library.edit({ kind: 'music', action: 'renameGroup', name: '混合收藏', newName: '歌曲专用' }, catalog);
    assert.equal(library.decorate('voice', voices)[0].category, '混合收藏');
    assert.ok(!library.groups('music', songs).includes('常用语音'));
    assert.ok(!library.groups('voice', voices).includes('歌曲专用'));
    assert.ok(library.groups('music', songs).includes('空分类'));
    assert.deepEqual(JSON.parse(await readFile(path + '.v1-backup.json', 'utf8')), legacy);
    const restarted = new MediaLibrary(path); await restarted.load();
    assert.equal(restarted.decorate('music', songs)[0].category, '歌曲专用');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bulk editing is atomic and confined to its category namespace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pet-library-bulk-'));
  try {
    const path = join(directory, 'media-library.json');
    const library = new MediaLibrary(path);
    const raw = [{ id: 'a', label: '第一项', group: '常用语音', random: false }, { id: 'b', label: '第二项', group: '常用语音' }];
    const snapshot = structuredClone(raw), catalog = async () => raw;
    for (const kind of ['voice', 'music', 'sticker']) await library.edit({ kind, action: 'createGroup', name: '收藏' }, catalog);
    await library.edit({ kind: 'voice', action: 'moveItems', ids: ['a', 'b'], category: '收藏' }, catalog);
    await library.edit({ kind: 'voice', action: 'renameItems', ids: ['a', 'b'], prefix: '我的语音' }, catalog);
    assert.deepEqual(library.decorate('voice', raw).map(row => [row.label, row.category]), [['我的语音 01', '收藏'], ['我的语音 02', '收藏']]);
    assert.equal(library.decorate('music', raw)[0].label, '第一项');
    const before = await readFile(path, 'utf8');
    for (const ids of [[], ['a', 'a'], ['a', 'missing']]) await assert.rejects(library.edit({ kind: 'voice', action: 'moveItems', ids, category: '常用语音' }, catalog));
    assert.equal(await readFile(path, 'utf8'), before, 'invalid batch never partially applies');
    const restarted = new MediaLibrary(path); await restarted.load();
    assert.equal(restarted.decorate('voice', raw)[1].label, '我的语音 02');
    await restarted.edit({ kind: 'voice', action: 'resetItems', ids: ['a', 'b'] }, catalog);
    assert.deepEqual(restarted.decorate('voice', raw), raw.map(row => ({ ...row, category: row.group })));
    assert.deepEqual(raw, snapshot);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
