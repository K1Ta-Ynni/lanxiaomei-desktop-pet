import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const edition = process.argv.find(arg => arg.startsWith('--edition='))?.slice('--edition='.length) || 'basic';
if (!['basic', 'companion'].includes(edition)) throw new Error('Edition must be basic or companion.');
const build = JSON.parse(await readFile(join(root, 'dist', `latest-build-${edition}.json`), 'utf8'));
const data = await mkdtemp(join(tmpdir(), 'lanxiaomei-package-'));
const env = { ...process.env, PET_STARTER_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
let desktop;
try {
  const extracted = join(data, 'extracted');
  await mkdir(extracted);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath ${quote(build.zip)} -DestinationPath ${quote(extracted)}`], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Release ZIP extraction failed.');
  desktop = await electron.launch({ executablePath: join(extracted, basename(build.output), 'LanXiaomei.exe'), args: [], env, timeout: 40000 });
  const pet = await desktop.firstWindow();
  await pet.locator('#greeting').waitFor({ state: 'visible' });
  assert.equal(await pet.title(), '蓝小妹');
  assert.equal(await pet.evaluate(() => window.petApp.info()).then(info => info.features.ai), edition === 'companion');
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'jump' }));
  await pet.waitForFunction(() => document.querySelector('#pet').classList.contains('action-jump'));
  const opened = desktop.waitForEvent('window', page => page.waitForURL('**/settings.html').then(() => true));
  await pet.evaluate(() => window.petApp.openSettings());
  const settings = await opened;
  await settings.locator('#import-stickers').waitFor({ state: 'attached' });
  const stickers = (await pet.evaluate(() => window.petApp.stickers())).stickers;
  assert.equal(stickers.length, 55, 'numbered stickers migrate to packaged user media');
  assert.equal(stickers.filter(sticker => sticker.animated).length, 4);
  assert.ok(stickers.every(sticker => sticker.src.includes('/media/stickers/')));
  await pet.evaluate(() => document.querySelector('#open-stickers').click());
  await pet.locator('#quick-stickers button').first().waitFor();
  await pet.locator('#quick-random').click();
  await pet.locator('#sticker').waitFor({ state: 'visible' });
  await pet.waitForFunction(() => document.querySelector('#sticker').naturalWidth > 0);
  await pet.evaluate(() => window.petApp.hideSticker());
  await settings.locator('[data-expression=laugh]').click();
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-laugh.png'));
  const pack = await pet.evaluate(() => window.petApp.voices());
  assert.equal(pack.warnings.length, 0);
  assert.equal(pack.clips.length, 31, 'bundled recordings migrate to user media on first launch');
  assert.equal(pack.clips.filter(clip => clip.group === '唱歌').length, 7);
  assert.ok(pack.clips.filter(clip => clip.group === '唱歌').every(clip => clip.random === false));
  assert.ok(pack.clips.every(clip => clip.src.includes('/media/voices/')));
  await settings.locator('[data-page=voices]').click();
  await settings.locator('[data-voice]').first().waitFor();
  await settings.locator('#voice-playlist-mode').waitFor();
  await settings.locator('#sticker-playlist-mode').waitFor({ state: 'attached' });
  assert.equal(await settings.locator('[data-voice-playlist]').count(), 31, 'packaged voice playlist includes every clip');
  assert.equal(await settings.locator('[data-sticker-playlist]').count(), 55, 'packaged sticker playlist includes every image');
  assert.equal(await settings.locator('[data-voice-playlist]:checked').count(), pack.clips.filter(clip => clip.random !== false && clip.group !== '唱歌').length, 'songs stay outside the default playlist');
  const prefs = await pet.evaluate(() => window.petApp.preferences());
  await pet.evaluate(prefs => window.petApp.savePreferences({ ...prefs, muted: true }), prefs);
  const shortest = [...pack.clips].sort((a, b) => a.duration - b.duration)[0];
  await pet.evaluate(id => window.petApp.playVoice(id), shortest.id);
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('播放完成'), null, { timeout: 15000 });
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/settings.html'));
    window.close();
  });
  const petStillVisible = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible());
  assert.equal(petStillVisible, true, 'closing settings never closes the pet');
  const reopened = desktop.waitForEvent('window', page => page.waitForURL('**/settings.html').then(() => true));
  await pet.evaluate(() => window.petApp.openSettings());
  const reopenedSettings = await reopened;
  await reopenedSettings.locator('#check-updates').waitFor({ state: 'attached' });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).close());
  assert.equal((await pet.evaluate(() => window.petApp.desktopState())).petHidden, true);
  await reopenedSettings.locator('#pet-hidden').uncheck();
  await reopenedSettings.locator('#game-mode').check();
  await pet.waitForFunction(() => document.body.classList.contains('game-mode'));
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), true);
  await reopenedSettings.locator('#pet-hidden').check();
  assert.equal((await pet.evaluate(() => window.petApp.desktopState())).gameMode, true);
  await reopenedSettings.locator('#pet-hidden').uncheck();
  await reopenedSettings.locator('#game-mode').uncheck();
  console.log('Packaged Windows app passed: independent executable starts, portrait loads, actions and interaction panel work.');
} finally {
  await desktop?.close().catch(() => {});
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await rm(data, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 }); lastError = undefined; break; }
    catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (lastError) throw lastError;
}
