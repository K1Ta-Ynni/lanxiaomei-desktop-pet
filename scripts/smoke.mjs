import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-desktop-test-'));
const fixture = join(temp, 'app');
const dataDir = join(temp, 'data');
const artifacts = join(root, 'artifacts');
await mkdir(fixture, { recursive: true });
await mkdir(artifacts, { recursive: true });
for (const path of ['src', 'assets', 'character', 'package.json']) await cp(join(root, path), join(fixture, path), { recursive: true });
const env = { ...process.env, PET_STARTER_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
let desktop;
const errors = [];
async function launch() {
  desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40_000 });
  desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const pet = await desktop.firstWindow();
  await pet.locator('#greeting').waitFor({ state: 'visible' });
  return pet;
}
async function waitPage(part, trigger) {
  const promise = desktop.waitForEvent('window', page => page.waitForURL('**/' + part + '.html').then(() => true));
  await trigger();
  const page = await promise;
  await page.waitForFunction(() => Boolean(window.petApp));
  return page;
}
function testWav() {
  const rate = 16000;
  const samples = rate * 5;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes; // Silent, real PCM WAV: no character audio is required.
}
try {
  let pet = await launch();
  assert.equal(await pet.title(), '蓝小妹');
  assert.equal(await pet.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await pet.evaluate(() => typeof window.process), 'undefined');
  const settings = await waitPage('settings', () => pet.evaluate(() => window.petApp.openSettings()));
  await settings.locator('[data-action=jump]').waitFor();
  await settings.locator('#check-updates').waitFor();
  await desktop.evaluate(({ net }) => {
    net.fetch = async () => new Response(JSON.stringify([{ tag_name: 'v0.1.0', name: 'v0.1.0', body: 'Current preview', prerelease: true,
      html_url: 'https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/tag/v0.1.0', assets: [] }]), { headers: { 'Content-Type': 'application/json' } });
  });
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('最新版本'));
  assert.equal(await settings.locator('#install-update').isVisible(), false, 'source mode cannot self-replace');
  await settings.locator('#include-prereleases').uncheck();
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('没有发布版本'));
  await settings.locator('#include-prereleases').check();
  await desktop.evaluate(({ net }) => { net.fetch = async () => new Response('', { status: 403 }); });
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('过于频繁'));
  await desktop.evaluate(({ net }) => {
    net.fetch = async () => new Response(JSON.stringify([{ tag_name: 'v0.2.0', name: 'v0.2.0', body: 'Next preview', prerelease: true,
      html_url: 'https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/tag/v0.2.0', assets: [] }]), { headers: { 'Content-Type': 'application/json' } });
  });
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('发现 v0.2.0'));
  assert.equal(await settings.locator('#download-update').isVisible(), false, 'incomplete release cannot download');
  assert.match(await settings.locator('#voice-count').textContent(), /还没有录音/u);
  await pet.screenshot({ path: join(artifacts, 'pet.png'), omitBackground: true });
  await settings.screenshot({ path: join(artifacts, 'settings.png'), fullPage: true });

  await settings.locator('[data-action=jump]').click();
  await pet.waitForFunction(() => document.querySelector('#pet').classList.contains('action-jump'));
  await settings.locator('[data-action=sleep]').click();
  await pet.locator('#sleep').waitFor({ state: 'visible' });
  await settings.locator('[data-action=sway]').click();
  await settings.waitForFunction(() => document.querySelector('#action-result').textContent.includes('先叫醒'));
  await settings.locator('[data-action=wake]').click();
  await pet.locator('#sleep').waitFor({ state: 'hidden' });

  await settings.locator('#scale').fill('0.8');
  await settings.locator('#volume').fill('0.4');
  await settings.locator('#muted').check();
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await settings.waitForFunction(() => document.querySelector('#result').textContent.includes('立即生效'));
  await pet.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--pet-height') === '288px');
  const saved = JSON.parse(await readFile(join(dataDir, 'preferences.json'), 'utf8'));
  assert.equal(saved.scale, 0.8);
  assert.equal(saved.volume, 0.4);
  assert.equal(saved.muted, true);

  // Direct IPC must also reject AI calls, including when a page bypasses disabled controls.
  await desktop.evaluate(() => { globalThis.fetch = () => { throw new Error('Unexpected network request'); }; });
  for (const call of ['sendMessage', 'saveSettings']) {
    const error = await pet.evaluate(async call => {
      try { await window.petApp[call](call === 'sendMessage' ? 'hello' : {}); return ''; }
      catch (error) { return error.message; }
    }, call);
    assert.match(error, /功能暂未开放/u);
  }
  const chat = await waitPage('chat', () => pet.evaluate(() => window.petApp.openChat()));
  assert.equal(await chat.locator('#input').isDisabled(), true);
  assert.equal(await chat.locator('#send').isDisabled(), true);
  assert.equal(await settings.locator('#apiKey').isDisabled(), true);
  assert.match(await chat.locator('#status').textContent(), /功能暂未开放/u);
  await chat.screenshot({ path: join(artifacts, 'chat.png') });

  // Import with the native picker mocked; files go only into the temporary app.
  const sample = join(temp, '开心.png');
  await cp(join(fixture, 'assets', 'portraits', 'avatar.png'), sample);
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, sample);
  await settings.locator('#import-stickers').click();
  await settings.waitForFunction(() => document.querySelector('#sticker-result').textContent.includes('已添加 1 张'));
  await settings.locator('[data-sticker="开心.png"]').click();
  await pet.locator('#sticker').waitFor({ state: 'visible' });
  await pet.waitForFunction(() => document.querySelector('#sticker').naturalWidth > 0);
  await pet.screenshot({ path: join(artifacts, 'pet-sticker.png'), omitBackground: true });
  await settings.screenshot({ path: join(artifacts, 'settings-stickers.png'), fullPage: true });
  await settings.locator('#hide-sticker').click();
  await pet.locator('#sticker').waitFor({ state: 'hidden' });
  await settings.locator('[data-sticker="开心.png"]').click();
  await pet.locator('#sticker').waitFor({ state: 'visible' });
  await pet.locator('#sticker').waitFor({ state: 'hidden', timeout: 10000 });
  const catalog = await pet.evaluate(() => window.petApp.interactions());
  assert.equal(catalog.stickers[0].id, '开心.png');
  for (const type of ['greet', 'jump', 'sway', 'sleep', 'wake', 'playVoice', 'stopVoice', 'showSticker', 'hideSticker', 'setPreferences', 'resetPosition', 'moveTo']) {
    assert.ok(catalog.commands.some(command => command.id === type));
  }
  for (const command of [{ type: 'showSticker', id: '../outside.png' }, { type: 'unknown' }, { type: 'moveTo', x: 'bad', y: 0 }]) {
    const error = await pet.evaluate(async command => {
      try { await window.petApp.executeInteraction(command); return ''; }
      catch (error) { return error.message; }
    }, command);
    assert.ok(error, 'invalid interaction must reject');
  }
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'moveTo', x: 100, y: 100 }));
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'resetPosition' }));
  await settings.locator('#import-stickers').click();
  await settings.waitForFunction(() => document.querySelectorAll('[data-sticker]').length === 2);
  assert.equal((await pet.evaluate(() => window.petApp.stickers())).stickers.length, 2, 'duplicate names never overwrite original');
  await settings.locator('[data-action=sleep]').click();
  await settings.locator('[data-sticker="开心.png"]').click();
  await settings.waitForFunction(() => document.querySelector('#sticker-result').textContent.includes('先叫醒'));
  await settings.locator('[data-action=wake]').click();

  // Add audio only to the copied temporary app, never to the actual voice pack.
  const voiceDir = join(fixture, 'assets', 'voices');
  await writeFile(join(voiceDir, 'test.wav'), testWav());
  await writeFile(join(voiceDir, 'manifest.json'), JSON.stringify({ clips: [{ id: 'test', label: '测试音频', file: 'test.wav', text: '本地播放测试' }] }));
  await settings.locator('#refresh-voices').click();
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  await settings.locator('[data-action=sleep]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已停止'));
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('先叫醒'));
  await settings.locator('[data-action=wake]').click();
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  await settings.locator('#stop-voice').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已停止'));
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('播放完成'), { timeout: 12000 });

  // Modes are independent, apply to every interaction entry and never steal focus.
  assert.equal(await desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+G')), true);
  assert.equal(await desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+H')), true);
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html'));
    const original = window.setIgnoreMouseEvents.bind(window);
    window.setIgnoreMouseEvents = (ignore, options) => { globalThis.lastPetMouseIgnore = ignore; return original(ignore, options); };
  });
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  await settings.locator('#game-mode').check();
  await pet.waitForFunction(() => document.body.classList.contains('game-mode'));
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已停止'));
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), true);
  assert.equal(await settings.locator('#pet-hidden').isChecked(), false);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isFocusable()), false);
  await pet.evaluate(() => window.petApp.ignoreMouse(false));
  assert.equal(await desktop.evaluate(() => globalThis.lastPetMouseIgnore), true, 'renderer cannot undo game click-through');
  for (const command of [{ type: 'greet' }, { type: 'jump' }, { type: 'sleep' }, { type: 'playVoice', id: 'test' }, { type: 'showSticker', id: '开心.png' }, { type: 'moveTo', x: 0, y: 0 }]) {
    const message = await pet.evaluate(async command => {
      try { await window.petApp.executeInteraction(command); return ''; } catch (error) { return error.message; }
    }, command);
    assert.match(message, /游戏模式/u);
  }
  assert.equal(await pet.locator('#bubble').isVisible(), false);
  assert.equal(await pet.locator('.pet-tools').isVisible(), false);
  assert.equal(await pet.locator('#pet img').evaluate(image => getComputedStyle(image).animationName), 'none');
  const beforeDrag = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).getBounds());
  await pet.evaluate(() => { window.petApp.dragStart(); window.petApp.dragMove(); window.petApp.dragEnd(); });
  assert.deepEqual(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).getBounds()), beforeDrag);
  await settings.locator('#pet-hidden').check();
  assert.equal((await pet.evaluate(() => window.petApp.desktopState())).gameMode, true);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), false);
  await settings.locator('#game-mode').uncheck();
  assert.equal((await pet.evaluate(() => window.petApp.desktopState())).petHidden, true);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), false);
  await settings.locator('#pet-hidden').uncheck();
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'jump' }));
  await pet.waitForFunction(() => document.querySelector('#pet').classList.contains('action-jump'));
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isFocusable()), true);

  await writeFile(join(voiceDir, 'manifest.json'), '{broken');
  await settings.locator('#refresh-voices').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('清单无法读取'));
  assert.match(await pet.title(), /蓝小妹/u, 'bad voice manifest does not stop the app');

  await settings.locator('#game-mode').check();
  await settings.locator('#pet-hidden').check();
  await desktop.close();
  pet = await launch();
  const modes = await pet.evaluate(() => window.petApp.desktopState());
  assert.equal(modes.gameMode, false, 'game mode resets on restart');
  assert.equal(modes.petHidden, false, 'hidden state resets on restart');
  const info = await pet.evaluate(() => window.petApp.info());
  assert.equal(info.preferences.scale, 0.8);
  assert.equal(info.preferences.muted, true);
  assert.equal(info.features.ai, false);
  assert.deepEqual(errors, [], 'renderers have no unhandled errors');
  console.log('Desktop smoke passed: interactions, independent game/hide modes, shortcuts, local media, update UI/version channels/rate limits, settings persistence, AI disabled and renderer sandbox.');
  console.log('Screenshots: ' + artifacts);
} finally {
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
