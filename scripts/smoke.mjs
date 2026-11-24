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
// Test playback only with generated silent audio; never randomly play the owner's pack.
await writeFile(join(fixture, 'assets', 'voices', 'manifest.json'), JSON.stringify({ clips: [] }));
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
  const reducedMotion = await pet.evaluate(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const image = document.querySelector('#pet img');
    return { matches: query.matches, iterationCount: getComputedStyle(image).animationIterationCount };
  });
  if (reducedMotion.matches) assert.equal(reducedMotion.iterationCount, '1', 'reduced-motion must not leave infinite animation loops');
  // Hover/click-through transitions must not jump to another point in the idle motion.
  // Freeze time so only the hover state changes, independent of machine frame rate.
  await pet.mouse.move(0, 0);
  const cdp = await pet.context().newCDPSession(pet);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root: documentNode } = await cdp.send('DOM.getDocument');
  const { nodeId: portraitNode } = await cdp.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#pet' });
  await pet.evaluate(() => {
    const animation = document.querySelector('#pet img').getAnimations()[0];
    animation.pause();
    animation.currentTime = 1800;
  });
  await pet.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const idleTransform = await pet.locator('#pet img').evaluate(image => getComputedStyle(image).transform);
  for (const forcedPseudoClasses of [['hover'], [], ['hover'], []]) {
    await cdp.send('CSS.forcePseudoState', { nodeId: portraitNode, forcedPseudoClasses });
    await pet.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await pet.locator('#pet img').evaluate(image => getComputedStyle(image).transform), idleTransform,
      'entering/leaving the portrait must preserve the idle animation phase');
  }
  await pet.evaluate(() => document.querySelector('#pet img').getAnimations()[0].play());
  await cdp.detach();
  const initialPortrait = await pet.locator('#pet').boundingBox();
  const initialToolsTop = await pet.locator('.pet-tools').evaluate(toolbar => toolbar.offsetTop);
  assert.ok(Math.abs(initialToolsTop - initialPortrait.y - initialPortrait.height - 10) <= 3, 'toolbar stays immediately below portrait when the viewport size changes');
  assert.equal(await pet.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await pet.evaluate(() => typeof window.process), 'undefined');
  const settings = await waitPage('settings', () => pet.evaluate(() => window.petApp.openSettings()));
  await settings.locator('[data-action=jump]').waitFor();
  const bundledStickers = (await pet.evaluate(() => window.petApp.stickers())).stickers;
  assert.equal(bundledStickers.length, 55);
  assert.equal(bundledStickers.filter(row => row.animated).length, 4);
  await settings.locator('[data-sticker]').first().waitFor({ state: 'attached' });
  await pet.evaluate(() => document.querySelector('#open-stickers').click());
  await pet.locator('#quick-stickers button').first().waitFor();
  assert.equal(await pet.locator('#quick-stickers button').count(), 55);
  await pet.screenshot({ path: join(artifacts, 'sticker-picker.png'), omitBackground: true });
  const gif = bundledStickers.find(row => row.animated);
  await pet.locator('#quick-stickers button').filter({ has: pet.locator(`img[alt="${gif.label}"]`) }).click();
  await pet.locator('#sticker-picker').waitFor({ state: 'hidden' });
  await pet.waitForFunction(() => document.querySelector('#sticker').naturalWidth > 0 && !document.querySelector('#sticker').hidden);
  assert.equal(await pet.locator('#sticker').getAttribute('alt'), gif.label);
  const imageSize = await pet.locator('#sticker').boundingBox();
  assert.ok(imageSize.width <= 107 && imageSize.height <= 107, 'sticker bubbles remain compact');
  assert.equal(await pet.locator('#greeting').textContent(), '');
  const bubbleBounds = await pet.locator('#bubble').boundingBox();
  const portraitBounds = await pet.locator('#pet').boundingBox();
  assert.ok(bubbleBounds.y + bubbleBounds.height <= portraitBounds.y + 2, 'sticker bubble stays just above the visible portrait');
  await pet.screenshot({ path: join(artifacts, 'numbered-sticker-bubble.png'), omitBackground: true });
  await pet.locator('#bubble-dismiss').click();
  await pet.locator('#sticker').waitFor({ state: 'hidden' });
  await pet.waitForTimeout(3100);
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'randomSticker' }));
  await pet.locator('#sticker').waitFor({ state: 'visible' });
  await pet.evaluate(() => window.petApp.hideSticker());
  await desktop.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const petWindow = windows.find(window => window.webContents.getURL().endsWith('/pet.html'));
    petWindow.close();
    if (petWindow.isDestroyed() || petWindow.isVisible()) throw new Error('Closing the pet should hide it to the tray, not destroy it.');
  });
  await settings.waitForFunction(() => document.querySelector('#pet-hidden').checked);
  await settings.locator('#pet-hidden').uncheck();
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), true);
  await settings.locator('[data-page=updates]').click();
  await settings.locator('#check-updates').waitFor();
  await pet.waitForFunction(() => !document.body.classList.contains('controls-visible'), { timeout: 5000 });
  await pet.mouse.move(16, 156);
  assert.equal(await pet.evaluate(() => document.body.classList.contains('controls-visible')), false, 'transparent portrait padding keeps the toolbar hidden');
  await pet.locator('#pet').hover();
  await pet.waitForFunction(() => document.body.classList.contains('controls-visible'));
  await pet.mouse.move(16, 156);
  await pet.waitForFunction(() => !document.body.classList.contains('controls-visible'), { timeout: 5000 });
  assert.equal(await pet.locator('.pet-tools').evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'idle controls do not intercept clicks');
  await pet.locator('#pet').hover();
  await pet.locator('#open-settings').click();
  await pet.mouse.move(1, 1);
  await pet.waitForFunction(() => !document.body.classList.contains('controls-visible'), { timeout: 5000 });
  await settings.locator('[data-page=updates]').click();
  await pet.waitForFunction(() => Number(getComputedStyle(document.querySelector('.pet-tools')).opacity) === 0);
  await desktop.evaluate(({ net }) => {
    net.fetch = async () => new Response(JSON.stringify([{ tag_name: 'v0.1.0', name: 'v0.1.0', body: 'Current preview', prerelease: true,
      html_url: 'https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/tag/v0.1.0', assets: [] }]), { headers: { 'Content-Type': 'application/json' } });
  });
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('没有兼容当前系统的安装包'));
  assert.equal(await settings.locator('#install-update').isVisible(), false, 'source mode cannot self-replace');
  await settings.locator('#include-prereleases').uncheck();
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('没有发布版本'));
  await settings.locator('#include-prereleases').check();
  await desktop.evaluate(({ net }) => { net.fetch = async () => new Response('', { status: 403 }); });
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('过于频繁'));
  await desktop.evaluate(({ net }) => {
    net.fetch = async () => new Response(JSON.stringify([{ tag_name: 'v1.0.1', name: 'v1.0.1', body: 'Next preview', prerelease: true,
      html_url: 'https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/tag/v1.0.1', assets: [] }]), { headers: { 'Content-Type': 'application/json' } });
  });
  await settings.locator('#check-updates').click();
  await settings.waitForFunction(() => document.querySelector('#update-result').textContent.includes('没有兼容当前系统的安装包'));
  assert.equal(await settings.locator('#download-update').isVisible(), false, 'incomplete release cannot download');
  assert.match(await settings.locator('#voice-count').textContent(), /还没有语音/u);
  await pet.screenshot({ path: join(artifacts, 'pet.png'), omitBackground: true });
  await settings.screenshot({ path: join(artifacts, 'settings.png'), fullPage: true });

  await settings.locator('[data-page=preferences]').click();
  await pet.evaluate(() => window.petApp.savePreferences({ portraitMode: 'normal' }));
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await settings.locator('[data-page=home]').click();
  await settings.locator('[data-expression=happy]').click();
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-happy.png'));
  await settings.locator('[data-expression=shy]').click();
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-shy.png'));
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'greet' }));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-shy.png'));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-desktop.png'));
  await settings.locator('[data-action=jump]').click();
  await pet.waitForFunction(() => document.querySelector('#pet').classList.contains('action-jump'));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-happy.png'));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-blink.png'), { timeout: 10000 });
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-desktop.png'));
  await settings.locator('[data-action=sleep]').click();
  await pet.locator('#sleep').waitFor({ state: 'visible' });
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-blink.png'));
  assert.equal(await pet.locator('#pet img').evaluate(image => image.naturalWidth), 626);
  await settings.locator('[data-action=sway]').click();
  await settings.waitForFunction(() => document.querySelector('#action-result').textContent.includes('先叫醒'));
  await settings.locator('[data-action=wake]').click();
  await pet.locator('#sleep').waitFor({ state: 'hidden' });
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-desktop.png'));

  await settings.locator('[data-page=preferences]').click();
  await settings.locator('#scale').evaluate(input => { input.value = '0.8'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await settings.locator('#scale').inputValue(), '0.8', 'scale slider accepts the pending size');
  await settings.locator('#volume').fill('0.4');
  assert.equal(await settings.locator('#scale').inputValue(), '0.8', 'live volume changes preserve the pending size');
  await settings.locator('#muted').check();
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await settings.waitForFunction(async () => (await window.petApp.preferences()).scale === 0.8);
  await pet.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--pet-height') === '288px');
  const scaledPortrait = await pet.locator('#pet').boundingBox();
  const scaledTools = await pet.locator('.pet-tools').boundingBox();
  const scaledToolsTop = await pet.locator('.pet-tools').evaluate(toolbar => toolbar.offsetTop);
  assert.ok(Math.abs(scaledToolsTop - scaledPortrait.y - scaledPortrait.height - 10) <= 3, 'toolbar tracks the portrait after resizing');
  assert.ok(scaledTools.y + scaledTools.height < await pet.evaluate(() => innerHeight), 'toolbar remains inside the pet window');
  const saved = JSON.parse(await readFile(join(dataDir, 'preferences.json'), 'utf8'));
  assert.equal(saved.scale, 0.8);
  assert.equal(saved.volume, 0.4);
  assert.equal(saved.muted, true);

  // Basic mode blocks model calls while keeping the companion mode switch usable.
  await desktop.evaluate(() => { globalThis.fetch = () => { throw new Error('Unexpected network request'); }; });
  const basicError = await pet.evaluate(async () => { try { await window.petApp.sendMessage('hello'); return ''; } catch (error) { return error.message; } });
  assert.match(basicError, /AI 聊天尚未开启/u);
  const chat = await waitPage('chat', () => pet.evaluate(() => window.petApp.openChat()));
  await chat.locator('.memory-drawer summary').click();
  assert.equal(await chat.locator('#input').isDisabled(), true);
  await chat.locator('#memory-input').fill('喜欢蓝色');
  await chat.locator('#memory-form button').click();
  await chat.locator('.memory-row').waitFor();
  assert.equal(await chat.locator('#memory-count').textContent(), '1');
  await chat.locator('.memory-row button').click();
  await chat.waitForFunction(() => document.querySelector('#memory-count').textContent === '0');
  await settings.locator('[data-page=ai]').click();
  await settings.locator('#assistant-mode').selectOption('companion');
  await settings.locator('#save-model').click();
  await chat.waitForFunction(() => !document.querySelector('#input').disabled);
  const missingModel = await chat.evaluate(async () => { try { await window.petApp.sendMessage('hello'); return ''; } catch (error) { return error.message; } });
  assert.match(missingModel, /API 地址/u);
  await settings.locator('#assistant-mode').selectOption('basic');
  await settings.locator('#save-model').click();
  await chat.waitForFunction(() => document.querySelector('#input').disabled);
  assert.equal(await chat.locator('#speech-once').isDisabled(), true);
  await chat.screenshot({ path: join(artifacts, 'chat.png') });

  // Import with the native picker mocked; files go only into the temporary app.
  const sample = join(temp, '开心.png');
  await cp(join(fixture, 'assets', 'portraits', 'avatar.png'), sample);
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, sample);
  await settings.locator('[data-page=stickers]').click();
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
  await desktop.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = template => {
      if (template.some(item => item.label === '快速调整大小')) globalThis.latestPetMenuTemplate = template;
      return build(template);
    };
  });
  await pet.evaluate(() => window.petApp.contextMenu());
  await pet.evaluate(() => window.petApp.info()); // Flush the context-menu IPC before inspecting its template.
  const sizeMenu = await desktop.evaluate(() => {
    const menu = globalThis.latestPetMenuTemplate.find(item => item.label === '快速调整大小');
    return menu?.submenu.map(item => ({ label: item.label, type: item.type, checked: item.checked }));
  });
  assert.deepEqual(sizeMenu?.map(item => item.label), ['60%', '80%', '100%', '120%', '140%', '160%']);
  assert.ok(sizeMenu.every(item => item.type === 'checkbox'));
  await pet.keyboard.press('Escape');
  await desktop.evaluate(async () => {
    const menu = globalThis.latestPetMenuTemplate.find(item => item.label === '快速调整大小');
    menu.submenu.find(item => item.label === '120%').click();
  });
  await settings.waitForFunction(() => document.querySelector('#scale').value === '1.2');
  assert.equal((await pet.evaluate(() => window.petApp.preferences())).scale, 1.2);
  await pet.evaluate(() => window.petApp.savePreferences({ scale: .8 }));
  assert.ok(catalog.stickers.some(row => row.id === '开心.png'));
  for (const type of ['greet', 'jump', 'sway', 'sleep', 'wake', 'playVoice', 'stopVoice', 'showSticker', 'randomSticker', 'hideSticker', 'showExpression', 'setPreferences', 'resetPosition', 'moveTo']) {
    assert.ok(catalog.commands.some(command => command.id === type));
  }
  for (const command of [{ type: 'showSticker', id: '../outside.png' }, { type: 'showExpression', id: '../outside.png' }, { type: 'unknown' }, { type: 'moveTo', x: 'bad', y: 0 }]) {
    const error = await pet.evaluate(async command => {
      try { await window.petApp.executeInteraction(command); return ''; }
      catch (error) { return error.message; }
    }, command);
    assert.ok(error, 'invalid interaction must reject');
  }
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'moveTo', x: 100, y: 100 }));
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'resetPosition' }));
  await settings.locator('#import-stickers').click();
  await settings.waitForFunction(() => document.querySelectorAll('[data-sticker]').length === 57);
  assert.equal((await pet.evaluate(() => window.petApp.stickers())).stickers.length, 57, 'duplicate names never overwrite original');
  await settings.locator('[data-page=home]').click();
  await settings.locator('[data-action=sleep]').click();
  await settings.locator('[data-page=stickers]').click();
  await settings.locator('[data-sticker="开心.png"]').click();
  await settings.waitForFunction(() => document.querySelector('#sticker-result').textContent.includes('先叫醒'));
  await settings.locator('[data-page=home]').click();
  await settings.locator('[data-action=wake]').click();

  // A transient expression restores the chosen portrait; auto mode rotates independently of motion.
  await settings.locator('[data-page=preferences]').click();
  await pet.evaluate(() => window.petApp.savePreferences({ portraitMode: 'smile' }));
  await settings.locator('#idleActions').uncheck();
  await settings.locator('#clickVoice').uncheck();
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-smile.png'));
  await settings.locator('[data-page=home]').click();
  await settings.locator('[data-expression=teary]').click();
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-teary.png'));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-smile.png'));
  await pet.clock.install();
  await settings.locator('[data-page=preferences]').click();
  await pet.evaluate(() => window.petApp.savePreferences({ portraitMode: 'auto' }));
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await settings.waitForFunction(async () => (await window.petApp.preferences()).portraitMode === 'auto');
  const idleInfo = await pet.evaluate(() => window.petApp.info());
  const idleSources = idleInfo.idleExpressions.map(id => '../' + (id === 'normal' ? idleInfo.image : idleInfo.expressions[id]));
  await pet.clock.fastForward(61000);
  await pet.waitForFunction(sources => sources.includes(document.querySelector('#pet img').getAttribute('src')), idleSources);
  await pet.evaluate(() => window.petApp.savePreferences({ portraitMode: 'normal' }));
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-desktop.png'));

  // Add audio only to the copied temporary app, never to the actual voice pack.
  const voiceDir = join(fixture, 'assets', 'voices');
  await writeFile(join(voiceDir, 'test.wav'), testWav());
  await writeFile(join(voiceDir, 'test-two.wav'), testWav());
  await writeFile(join(voiceDir, 'manifest.json'), JSON.stringify({ clips: [
    { id: 'test', label: '测试音频一', file: 'test.wav', text: '本地播放测试' },
    { id: 'test-two', label: '测试音频二', file: 'test-two.wav', text: '第二条测试字幕' },
    { id: 'test-song', label: '测试歌曲', group: '唱歌', file: 'test.wav', random: false },
  ] }));
  await settings.locator('[data-page=voices]').click();
  await settings.locator('#refresh-voices').click();
  await settings.locator('[data-page=preferences]').click();
  await settings.locator('#clickVoice').check();
  await settings.locator('#clickSticker').uncheck();
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await settings.waitForFunction(() => document.querySelector('#result').textContent.includes('已保存'));
  await pet.evaluate(async () => {
    const preferences = await window.petApp.preferences();
    await window.petApp.savePreferences({ ...preferences, muted: false, clickVoice: true, clickSticker: false });
  });
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'greet' }));
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  const firstLabel = await settings.locator('#voice-result').textContent();
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'greet' }));
  await settings.waitForFunction(label => document.querySelector('#voice-result').textContent.includes('正在播放') && document.querySelector('#voice-result').textContent !== label, firstLabel);
  assert.ok(!(await pet.locator('#greeting').textContent()).includes('蓝小妹来啦'));
  await pet.locator('#bubble-dismiss').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已停止'));
  assert.equal(await pet.locator('#bubble').isVisible(), false);
  await pet.evaluate(async () => {
    const preferences = await window.petApp.preferences();
    await window.petApp.savePreferences({ ...preferences, muted: true, clickVoice: true, clickSticker: false });
  });
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'greet' }));
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-talk.png'), { timeout: 5000 });
  assert.ok(['本地播放测试', '第二条测试字幕'].includes(await pet.locator('#greeting').textContent()), 'muted click retains voice subtitles');
  await pet.locator('#bubble-dismiss').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已停止'));
  await pet.evaluate(async () => {
    const preferences = await window.petApp.preferences();
    await window.petApp.savePreferences({ ...preferences, muted: false, volume: 0 });
  });
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'greet' }));
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  assert.ok(['本地播放测试', '第二条测试字幕'].includes(await pet.locator('#greeting').textContent()), 'zero-volume click retains voice subtitles');
  await pet.evaluate(async () => {
    const preferences = await window.petApp.preferences();
    await window.petApp.savePreferences({ ...preferences, muted: true, volume: 0.4, clickVoice: false });
  });
  await settings.locator('[data-page=home]').click();
  await settings.locator('[data-action=sleep]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已停止'));
  await settings.locator('[data-page=voices]').click();
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('先叫醒'));
  await settings.locator('[data-page=home]').click();
  await settings.locator('[data-action=wake]').click();
  await settings.locator('[data-page=voices]').click();
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-talk.png'));
  await settings.locator('#stop-voice').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已停止'));
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('播放完成'), { timeout: 12000 });

  // Playlists use real UI selections, save immediately and apply to the shared interaction API.
  assert.equal(await settings.locator('[data-voice-playlist=test-song]').count(), 0, 'song checkboxes live in the music library');
  assert.equal(await settings.locator('[data-voice-selected=test-song]').count(), 0, 'songs start outside the interactive playlist');
  assert.equal(await settings.locator('[data-voice-playlist=test]').isChecked(), true);
  await settings.locator('#voice-playlist-all').click();
  await settings.waitForFunction(() => Boolean(document.querySelector('[data-voice-selected=test-song]')));
  await settings.locator('#voice-playlist-clear').click();
  await settings.waitForFunction(() => document.querySelector('#voice-playlist-status').textContent.includes('已选 0 /'));
  assert.equal((await pet.evaluate(() => window.petApp.executeInteraction({ type: 'nextVoice' }))).empty, true);
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'setPlaylist', kind: 'voice', playlist: { mode: 'random', ids: ['test-song'] } }));
  await settings.waitForFunction(async () => (await window.petApp.preferences()).voicePlaylist.ids?.includes('test-song'));
  assert.equal((await pet.evaluate(() => window.petApp.executeInteraction({ type: 'nextVoice' }))).id, 'test-song', 'a song can be explicitly selected');
  await settings.locator('#voice-playlist-default').click();
  await settings.waitForFunction(async () => (await window.petApp.preferences()).voicePlaylist.ids === null);
  await settings.locator('#voice-playlist-mode').selectOption('sequence');
  await settings.waitForFunction(async () => (await window.petApp.preferences()).voicePlaylist.mode === 'sequence');
  const voiceOrder = [];
  for (let i = 0; i < 3; i++) voiceOrder.push((await pet.evaluate(() => window.petApp.executeInteraction({ type: 'nextVoice' }))).id);
  assert.deepEqual(voiceOrder, ['test', 'test-two', 'test']);
  await settings.locator('#voice-playlist-mode').selectOption('repeat');
  await settings.waitForFunction(async () => (await window.petApp.preferences()).voicePlaylist.mode === 'repeat');
  for (let i = 0; i < 2; i++) assert.equal((await pet.evaluate(() => window.petApp.executeInteraction({ type: 'nextVoice' }))).id, 'test');
  await settings.locator('#stop-voice').click();

  await settings.locator('[data-page=stickers]').click();
  await settings.locator('#sticker-playlist-clear').click();
  await settings.waitForFunction(() => document.querySelector('#sticker-playlist-status').textContent.includes('已选 0 /'));
  assert.equal((await pet.evaluate(() => window.petApp.executeInteraction({ type: 'nextSticker' }))).empty, true);
  const stickerSelection = bundledStickers.slice(0, 2).map(row => row.id);
  for (const id of stickerSelection) await settings.locator('[data-sticker-playlist="' + id + '"]').check();
  await settings.locator('#sticker-playlist-mode').selectOption('sequence');
  await settings.waitForFunction(async () => {
    const p = (await window.petApp.preferences()).stickerPlaylist;
    return p.mode === 'sequence' && p.ids.length === 2;
  });
  for (let i = 0; i < 3; i++) {
    const selected = await pet.evaluate(() => window.petApp.executeInteraction({ type: 'nextSticker' }));
    assert.equal(selected.id, stickerSelection[i % 2]);
  }
  await settings.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await settings.waitForFunction(() => document.querySelector('#result').textContent.includes('已保存'));
  assert.deepEqual((await pet.evaluate(() => window.petApp.preferences())).stickerPlaylist.ids, stickerSelection, 'general settings save retains playlist selections');
  await settings.screenshot({ path: join(artifacts, 'playlist-settings.png'), fullPage: true });
  await pet.evaluate(() => window.petApp.hideSticker());

  // Game mode only passes mouse input through; hidden mode still suspends media.
  assert.ok((await pet.evaluate(() => window.petApp.desktopState())).shortcutErrors.length <= 3, 'shortcut failures are reported without preventing the pet from starting');
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html'));
    const original = window.setIgnoreMouseEvents.bind(window);
    window.setIgnoreMouseEvents = (ignore, options) => { globalThis.lastPetMouseIgnore = ignore; return original(ignore, options); };
  });
  await settings.locator('[data-page=voices]').click();
  await settings.locator('[data-voice=test]').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('正在播放'));
  const beforeGameAnimation = await pet.locator('#pet img').evaluate(image => getComputedStyle(image).animationName);
  await pet.evaluate(() => document.querySelector('#open-stickers').click());
  await pet.locator('#sticker-picker').waitFor({ state: 'visible' });
  await settings.locator('[data-page=home]').click();
  await settings.locator('#game-mode').check();
  await pet.waitForFunction(() => document.body.classList.contains('game-mode'));
  await pet.locator('#sticker-picker').waitFor({ state: 'hidden' });
  // Windows forwards mouse movement even while the native window is click-through.
  await pet.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 200 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  });
  assert.equal(await pet.evaluate(() => document.body.classList.contains('controls-visible')), false, 'game mode ignores toolbar reveal events');
  assert.equal(await pet.locator('.pet-tools').isVisible(), false, 'game toolbar stays visually hidden');
  assert.equal(await pet.locator('.pet-tools').evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  assert.match(await settings.locator('#voice-result').textContent(), /正在播放/u, 'game mode keeps the current voice playing');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), true);
  assert.equal(await settings.locator('#pet-hidden').isChecked(), false);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isFocusable()), false);
  await pet.evaluate(() => window.petApp.ignoreMouse(false));
  assert.equal(await desktop.evaluate(() => globalThis.lastPetMouseIgnore), true, 'renderer cannot undo game click-through');
  assert.equal(await pet.locator('#pet img').evaluate(image => getComputedStyle(image).animationName), beforeGameAnimation, 'game mode retains animation preferences');
  for (const command of [{ type: 'jump' }, { type: 'playVoice', id: 'test' }, { type: 'nextVoice' }, { type: 'nextSticker' }, { type: 'showSticker', id: '开心.png' }, { type: 'randomSticker' }, { type: 'showExpression', id: 'happy' }, { type: 'moveTo', x: 0, y: 0 }]) {
    const result = await pet.evaluate(command => window.petApp.executeInteraction(command), command);
    assert.equal(result.performed, true, 'game mode permits panel and API interactions: ' + command.type);
  }
  await pet.locator('#sticker').waitFor({ state: 'visible' });
  await settings.locator('#game-mode').uncheck();
  await pet.waitForFunction(() => !document.body.classList.contains('game-mode'));
  await pet.locator('#pet').hover();
  await pet.waitForFunction(() => document.body.classList.contains('controls-visible'));
  await pet.locator('.pet-tools').waitFor({ state: 'visible' });
  assert.equal(await pet.evaluate(() => document.body.classList.contains('controls-visible')), true, 'leaving game mode restores toolbar reveal');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), true,
    'leaving game mode keeps the desktop window visible');
  assert.equal(await desktop.evaluate(() => globalThis.lastPetMouseIgnore), false, 'leaving game mode restores mouse interaction');
  assert.ok(await pet.locator('#pet img').evaluate(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).visibility === 'visible'),
    'leaving game mode restores the portrait renderer');
  await desktop.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html'));
    window.minimize();
    Menu.getApplicationMenu();
  });
  // The tray's restore callback also handles a live but minimized native window.
  await settings.locator('#pet-hidden').check();
  await settings.locator('#pet-hidden').uncheck();
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isMinimized()), false);
  await settings.locator('#game-mode').check();
  await pet.waitForFunction(() => document.body.classList.contains('game-mode'));
  await settings.locator('#pet-hidden').check();
  assert.equal((await pet.evaluate(() => window.petApp.desktopState())).gameMode, true);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), false);
  await settings.locator('#game-mode').uncheck();
  assert.equal((await pet.evaluate(() => window.petApp.desktopState())).petHidden, true);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isVisible()), false);
  await settings.locator('#pet-hidden').uncheck();
  const dragArea = await desktop.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  await pet.evaluate(({ x, y }) => window.petApp.executeInteraction({ type: 'moveTo', x: x + 120, y: y + 80 }), dragArea);
  const beforeDrag = await desktop.evaluate(({ BrowserWindow, screen }) => {
    globalThis.originalPetCursor = screen.getCursorScreenPoint;
    const area = screen.getPrimaryDisplay().workArea;
    globalThis.petTestCursor = { x: area.x + 500, y: area.y + 400 };
    screen.getCursorScreenPoint = () => ({ ...globalThis.petTestCursor });
    return BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).getBounds();
  });
  await pet.evaluate(() => window.petApp.dragStart());
  await pet.evaluate(() => window.petApp.info()); // Flush ordered drag-start IPC.
  await desktop.evaluate(() => {
    globalThis.petTestCursor.x -= 25;
    globalThis.petTestCursor.y -= 15;
  });
  await pet.evaluate(() => window.petApp.dragMove());
  await pet.waitForTimeout(100);
  const afterDrag = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).getBounds());
  assert.equal(afterDrag.x - beforeDrag.x, -25, 'drag uses the absolute native cursor displacement');
  assert.equal(afterDrag.y - beforeDrag.y, -15);
  await pet.evaluate(() => window.petApp.dragEnd());
  await pet.evaluate(() => window.petApp.info());
  await desktop.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.originalPetCursor; });
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'resetPosition' }));
  const resetBounds = await desktop.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html'));
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = window.getBounds();
    return { x: bounds.x, y: bounds.y, expectedX: Math.max(area.x, area.x + area.width - bounds.width - 30), expectedY: Math.max(area.y, area.y + area.height - bounds.height - 20) };
  });
  assert.equal(resetBounds.x, resetBounds.expectedX, 'reset uses the primary monitor work area');
  assert.equal(resetBounds.y, resetBounds.expectedY);
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'jump' }));
  await pet.waitForFunction(() => document.querySelector('#pet').classList.contains('action-jump'));
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pet.html')).isFocusable()), true);

  await writeFile(join(voiceDir, 'manifest.json'), '{broken');
  await settings.locator('[data-page=voices]').click();
  await settings.locator('#refresh-voices').click();
  await settings.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('清单无法读取'));
  assert.match(await pet.title(), /蓝小妹/u, 'bad voice manifest does not stop the app');

  await settings.locator('[data-page=home]').click();
  await settings.locator('#game-mode').check();
  await settings.locator('#pet-hidden').check();
  await desktop.close();
  await writeFile(join(fixture, 'assets', 'voices', 'manifest.json'), JSON.stringify({ clips: [
    { id: 'startup', label: '入场测试', file: 'test.wav', group: '入场语音', text: '启动入场测试', random: false, duration: 5 },
  ] }));
  pet = await launch();
  await pet.waitForFunction(() => document.querySelector('#greeting').textContent === '启动入场测试');
  await pet.evaluate(() => window.petApp.stopVoice());
  await pet.evaluate(() => window.petApp.setPetHidden(true));
  await pet.evaluate(() => window.petApp.setPetHidden(false));
  await pet.waitForTimeout(300);
  assert.equal(await pet.locator('#bubble').isVisible(), false, 'restoring the pet does not replay the entrance');
  const modes = await pet.evaluate(() => window.petApp.desktopState());
  assert.equal(modes.gameMode, false, 'game mode resets on restart');
  assert.equal(modes.petHidden, false, 'hidden state resets on restart');
  const info = await pet.evaluate(() => window.petApp.info());
  assert.equal(info.preferences.scale, 0.8);
  assert.equal(info.preferences.muted, true);
  assert.equal(info.features.ai, false);
  assert.equal(info.preferences.voicePlaylist.mode, 'repeat', 'voice playlist mode survives restart');
  assert.equal(info.preferences.stickerPlaylist.mode, 'sequence');
  assert.deepEqual(info.preferences.stickerPlaylist.ids, stickerSelection, 'sticker selections survive restart');
  assert.deepEqual(errors, [], 'renderers have no unhandled errors');
  console.log('Desktop smoke passed: interactions, absolute-cursor drag and reset geometry, independent game/hide modes, shortcuts, local media, update UI/version channels/rate limits, AI downgrade, local memories and renderer sandbox.');
  console.log('Screenshots: ' + artifacts);
} finally {
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
