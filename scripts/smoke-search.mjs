import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-search-'));
const fixture = join(temp, 'app'), data = join(temp, 'data');
let desktop;
const errors = [];
try {
  await mkdir(fixture); await mkdir(data);
  for (const entry of ['src', 'assets', 'character', 'package.json']) await cp(join(root, entry), join(fixture, entry), { recursive: true });
  const voiceDirectory = join(fixture, 'assets/voices');
  const rate = 16000, bytes = Buffer.alloc(44 + rate * 30 * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  await writeFile(join(voiceDirectory, 'search.wav'), bytes);
  await writeFile(join(voiceDirectory, 'manifest.json'), JSON.stringify({ clips: [
    { id: 'rain', label: '雨爱', group: '清唱', music: true, file: 'search.wav' },
    { id: 'english', label: 'Wonderful U', group: '英文歌曲', music: true, file: 'search.wav' },
    { id: 'hello', label: '早上好', group: '问候', file: 'search.wav' },
    { id: 'bye', label: '晚安', group: '告别', file: 'search.wav' },
  ] }));
  await writeFile(join(data, 'preferences.json'), JSON.stringify({ muted: true, idleActions: false, idleHello: false,
    musicPlaylist: { mode: 'sequence', ids: ['rain', 'english'] } }));
  const env = { ...process.env, PET_STARTER_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40000 });
  desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const pet = await desktop.firstWindow(); await pet.locator('#pet').waitFor();
  const pending = desktop.waitForEvent('window', page => page.waitForURL('**/settings.html').then(() => true));
  await pet.evaluate(() => window.petApp.openSettings());
  const panel = await pending;
  await panel.waitForFunction(() => document.querySelectorAll('[data-song]').length === 2);
  const before = await pet.evaluate(() => window.petApp.preferences());
  await panel.locator('[data-page=music]').click();
  const category = panel.locator('#music-list details').filter({ hasText: '清唱' });
  await category.locator('summary > span').first().click();
  assert.equal(await category.evaluate(element => element.open), false);
  await panel.locator('#music-library > summary').click();
  await panel.locator('#music-search').fill('雨');
  assert.equal(await panel.locator('[data-song]:visible').count(), 1);
  assert.equal(await panel.locator('[data-music-selected]:visible').count(), 1);
  assert.equal(await category.evaluate(element => element.open), true, 'matching collapsed categories open for search');
  await panel.locator('#music-search').press('Escape');
  assert.equal(await category.evaluate(element => element.open), false, 'clearing search restores category folding');
  assert.equal(await panel.locator('#music-library').evaluate(element => element.open), false, 'clearing restores outer library folding too');
  await panel.locator('#music-library > summary').click();
  await panel.locator('#music-search').fill('ｗＯＮＤＥＲＦＵＬ u');
  assert.equal(await panel.locator('[data-song]:visible').getAttribute('data-song'), 'english');
  assert.equal(await panel.locator('[data-music-selected]:visible').getAttribute('data-music-selected'), 'english');
  await panel.locator('#music-search').fill('清唱');
  assert.equal(await panel.locator('[data-song]:visible').getAttribute('data-song'), 'rain', 'search matches category names');
  await panel.locator('#music-search').fill('找不到的歌');
  assert.equal(await panel.locator('[data-song]:visible').count(), 0);
  assert.equal(await panel.locator('[data-panel=music] .search-empty:visible').count(), 2);
  await panel.locator('#music-refresh').click();
  await panel.waitForFunction(() => !document.querySelector('#music-list [data-search-text]:not([hidden])'));
  assert.equal(await panel.locator('#music-search').inputValue(), '找不到的歌');
  await panel.locator('[data-panel=music] .search-clear').click();
  assert.equal(await panel.locator('#music-search').inputValue(), '');
  assert.equal(await panel.locator('[data-song]:visible').count(), 2);
  await panel.locator('[data-song=rain]').click();
  await pet.waitForFunction(async () => (await window.petApp.musicStatus()).state === 'playing');
  await panel.locator('#music-search').fill('wonderful');
  assert.equal((await pet.evaluate(() => window.petApp.musicStatus())).id, 'rain', 'search does not interrupt or change music');
  // Search must remain in effect after metadata changes and full list rerender.
  await panel.evaluate(() => window.petApp.editMedia({ kind: 'music', action: 'editItem', id: 'rain', label: '雨爱新版', category: '清唱' }));
  await panel.locator('#music-refresh').click();
  await panel.waitForFunction(() => document.querySelector('[data-song=rain]').textContent.includes('新版'));
  assert.equal(await panel.locator('[data-song]:visible').getAttribute('data-song'), 'english');
  for (const [kind, page, text, expected] of [['voice', 'voices', '早上', 'hello'], ['sticker', 'stickers', '001', 'lanjie-001.png']]) {
    await panel.locator(`[data-page=${page}]`).click();
    await panel.locator(`#${kind}-search`).fill(text);
    assert.equal(await panel.locator(`[data-${kind}]:visible`).count(), 1);
    assert.equal(await panel.locator(`[data-${kind}-selected]:visible`).count(), 1);
    assert.equal(await panel.locator(`[data-${kind}]:visible`).getAttribute(`data-${kind}`), expected);
  }
  await panel.locator('[data-page=home]').click();
  await panel.locator('#expression-search').fill('不可能匹配');
  assert.equal(await panel.locator('#expression-list [data-search-text]:visible').count(), 0);
  await panel.locator('#expression-search').press('Escape');
  assert.ok(await panel.locator('#expression-list [data-search-text]:visible').count() > 0);
  await pet.evaluate(() => document.querySelector('#open-music').click());
  await pet.locator('#quick-music [data-song]').first().waitFor();
  await pet.locator('#quick-music-search').fill('雨爱');
  assert.equal(await pet.locator('#quick-music [data-song]:visible').getAttribute('data-song'), 'rain');
  await pet.locator('#quick-music-search').fill('不存在');
  assert.equal(await pet.locator('#quick-music [data-song]:visible').count(), 0);
  await pet.locator('#music-picker .search-empty').waitFor({ state: 'visible' });
  await pet.locator('#quick-music-search').press('Escape');
  await pet.locator('#music-picker').waitFor({ state: 'visible' });
  assert.equal(await pet.locator('#quick-music [data-song]:visible').count(), 2);
  await pet.locator('#quick-music-search').fill('wOnDeRfUl');
  await pet.locator('#quick-music [data-song=english]').click();
  await pet.waitForFunction(async () => (await window.petApp.musicStatus()).id === 'english');
  await pet.evaluate(() => document.querySelector('#open-stickers').click());
  await pet.locator('#quick-stickers [data-sticker]').first().waitFor();
  await pet.locator('#quick-sticker-search').fill('001');
  assert.equal(await pet.locator('#quick-stickers [data-sticker]:visible').getAttribute('data-sticker'), 'lanjie-001.png');
  const after = await pet.evaluate(() => window.petApp.preferences());
  for (const kind of ['music', 'voice', 'sticker', 'expression']) assert.deepEqual(after[kind + 'Playlist'], before[kind + 'Playlist'], 'search never changes playlist membership');
  assert.deepEqual(errors, []);
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await pet.screenshot({ path: join(root, 'artifacts/search-quick.png'), omitBackground: true });
  await panel.locator('[data-page=music]').click();
  await panel.locator('#music-search').scrollIntoViewIfNeeded();
  await panel.screenshot({ path: join(root, 'artifacts/search-panel.png') });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html')).setSize(760, 580));
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'search bars fit a narrow settings window');
  console.log('PASS: all library/selected searches, quick music/sticker searches, Unicode and multiword matching, empty/clear/Escape, category folding, refresh/rename persistence, active playback and playlist preservation.');
} finally {
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
