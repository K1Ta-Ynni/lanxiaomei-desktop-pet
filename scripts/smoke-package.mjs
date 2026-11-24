import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, stat } from 'node:fs/promises';
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
  await pet.evaluate(() => window.petApp.savePreferences({ muted: true }));
  await pet.locator('#greeting').waitFor({ state: 'visible' });
  assert.equal(await pet.title(), '蓝小妹');
  assert.equal(await pet.evaluate(() => window.petApp.info()).then(info => info.features.ai), false, 'both transition packages default to optional AI off');
  assert.equal((await pet.evaluate(() => window.petApp.updateStatus())).currentEdition, 'basic', 'both packages converge on the unified channel');
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'jump' }));
  await pet.waitForFunction(() => document.querySelector('#pet').classList.contains('action-jump'));
  const opened = desktop.waitForEvent('window', page => page.waitForURL('**/settings.html').then(() => true));
  await pet.evaluate(() => window.petApp.openSettings());
  const settings = await opened;
  await settings.locator('#import-stickers').waitFor({ state: 'attached' });
  const assetRoot = join(extracted, basename(build.output), 'resources/app/assets');
  for (const path of ['voices', 'stickers', 'media-library-defaults.json', 'snowman']) {
    await assert.rejects(stat(join(assetRoot, path)), { code: 'ENOENT' });
  }
  assert.deepEqual(await pet.evaluate(() => window.petApp.stickers()), { stickers: [], warnings: [], groups: [] });
  await pet.evaluate(() => document.querySelector('#open-stickers').click());
  await pet.waitForFunction(() => document.querySelector('#picker-status').textContent.includes('还没有表情包'));
  await pet.evaluate(() => document.querySelector('#close-picker').click());
  await settings.locator('[data-expression=laugh]').click();
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-laugh.png'));
  assert.deepEqual(await pet.evaluate(() => window.petApp.voices()), { clips: [], warnings: [], groups: [], musicGroups: [] });
  await pet.evaluate(() => window.petApp.savePreferences({ appearance: 'layered' }));
  await pet.waitForFunction(() => {
    const canvas = document.querySelector('.layered-portrait');
    if (canvas.hidden) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value !== 0);
  });
  await pet.evaluate(() => window.petApp.savePreferences({ appearance: 'portrait' }));
  await pet.locator('#pet img').waitFor({ state: 'visible' });
  await pet.evaluate(() => document.querySelector('#open-music').click());
  await pet.locator('#quick-music-search').waitFor();
  await pet.locator('#quick-music-search').fill('不存在的测试歌名');
  await pet.locator('#music-picker .search-empty').waitFor();
  assert.equal(await pet.locator('#quick-music [data-song]:visible').count(), 0);
  await pet.evaluate(() => document.querySelector('#close-music-picker').click());
  await settings.locator('[data-page=music]').click();
  await settings.locator('#music-search').fill('不存在的测试歌名');
  assert.equal(await settings.locator('[data-song]:visible').count(), 0);
  await settings.locator('#music-search').fill('');
  await settings.locator('[data-page=voices]').click();
  await settings.locator('#voice-playlist-mode').waitFor();
  await settings.locator('#sticker-playlist-mode').waitFor({ state: 'attached' });
  assert.equal(await settings.locator('[data-voice-playlist]').count(), 0);
  assert.equal(await settings.title(), '蓝神のLivehouse');
  assert.equal(await settings.locator('#update-edition').count(), 0);
  assert.ok((await readFile(join(extracted, basename(build.output), 'PLAY_GUIDE.md'), 'utf8')).includes('常驻表情列表'));
  assert.equal(await settings.locator('[data-sticker-playlist]').count(), 0);
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
  await pet.evaluate(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 200 })));
  assert.equal(await pet.locator('.pet-tools').isVisible(), false, 'game mode hides the toolbar in the packaged app');
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
