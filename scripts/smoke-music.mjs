import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { defaultVoiceSelection } from '../src/playlist.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-music-test-'));
const fixture = join(temp, 'app'), data = join(temp, 'data');
let desktop;
const errors = [];
async function waitAsync(page, predicate, arg) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await page.waitForTimeout(60);
  }
  throw new Error('Async condition timed out: ' + predicate.toString());
}
function wav() {
  const rate = 16000, bytes = Buffer.alloc(44 + rate * 30 * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
try {
  await mkdir(fixture);
  for (const entry of ['src', 'assets', 'character', 'package.json']) await cp(join(root, entry), join(fixture, entry), { recursive: true });
  await mkdir(data);
  await writeFile(join(data, 'preferences.json'), JSON.stringify({ muted: true, idleActions: false }));
  const env = { ...process.env, PET_STARTER_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40000 });
  desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const pet = await desktop.firstWindow();
  await pet.locator('#pet').waitFor();
  async function settings() {
    const opened = desktop.waitForEvent('window');
    await pet.evaluate(() => window.petApp.openSettings());
    const page = await opened;
    await page.locator('[data-page=music]').waitFor();
    await page.waitForFunction(() => document.querySelector('#voice-count').textContent.includes('已载入'));
    return page;
  }
  let panel = await settings();
  await panel.screenshot({ path: join(root, 'artifacts/settings-home-v2.png') });
  for (const section of ['voices', 'stickers', 'music', 'preferences', 'updates']) {
    await panel.locator('[data-page=' + section + ']').click();
    assert.equal(await panel.locator('[data-panel=' + section + ']').isVisible(), true);
    assert.equal(await panel.locator('[aria-current=page]').getAttribute('data-page'), section);
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
    await panel.waitForTimeout(180);
    await panel.screenshot({ path: join(root, 'artifacts/settings-' + section + '-v2.png') });
  }
  await panel.locator('[data-page=voices]').click();
  const selectedVoiceCount = (await pet.evaluate(() => window.petApp.voices())).clips.filter(defaultVoiceSelection).length;
  assert.equal(await panel.locator('[data-voice-selected]').count(), selectedVoiceCount);
  const first = await panel.locator('[data-voice-selected]').first().getAttribute('data-voice-selected');
  await panel.locator('[data-voice-remove="' + first + '"]').click();
  await panel.waitForFunction(count => document.querySelectorAll('[data-voice-selected]').length === count - 1, selectedVoiceCount);
  assert.equal(await panel.locator('[data-voice-playlist="' + first + '"]').isChecked(), false);
  await panel.locator('#voice-library > summary').click();
  assert.equal(await panel.locator('#voice-list').isVisible(), false);
  assert.equal(await panel.locator('#voice-selected').isVisible(), true);
  await panel.locator('[data-page=stickers]').click();
  assert.equal(await panel.locator('[data-sticker-selected]').count(), 55);
  await panel.locator('#sticker-library > summary').click();
  assert.equal(await panel.locator('#sticker-list').isVisible(), false);
  assert.equal(await panel.locator('#sticker-selected').isVisible(), true);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html')).setSize(760, 580));
  for (const section of ['voices', 'stickers', 'music']) {
    await panel.locator('[data-page=' + section + ']').click();
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  // Switch the copied catalog to known silent audio; never play the user's pack.
  const audio = join(fixture, 'assets/voices');
  await writeFile(join(audio, 'test.wav'), wav());
  await writeFile(join(audio, 'manifest.json'), JSON.stringify({ clips: [
    { id: 'song_a', label: '测试歌曲 A', file: 'test.wav', group: '唱歌', random: false },
    { id: 'song_b', label: '测试歌曲 B', file: 'test.wav', group: '歌曲', random: false },
    { id: 'voice', label: '测试语音', file: 'test.wav' },
  ] }));
  await panel.locator('#music-refresh').click();
  await panel.waitForFunction(() => document.querySelectorAll('[data-song]').length === 2);
  await pet.emulateMedia({ reducedMotion: 'no-preference' });
  await pet.evaluate(() => window.petApp.savePreferences({ portraitMode: 'normal', autoBlink: false, talkAnimation: true }));
  await panel.locator('[data-song=song_a]').click();
  await panel.waitForFunction(() => document.querySelector('#music-status').textContent === '正在播放');
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).position > .3);
  const animation = JSON.parse(await readFile(join(root, 'character/character.json'), 'utf8')).musicAnimation;
  let cycleDuration = 0;
  const frameSamples = animation.map(frame => {
    const sample = [cycleDuration / 1000 + .1, frame.file.match(/music-(\d)\.png$/u)[1]];
    cycleDuration += frame.duration;
    return sample;
  });
  frameSamples.push([cycleDuration / 1000 + .1, frameSamples[0][1]]);
  for (const [position, name] of frameSamples) {
    await pet.evaluate(position => window.petApp.executeInteraction({ type: 'music', action: 'seek', position }), position);
    await pet.waitForFunction(name => document.querySelector('#pet img').getAttribute('src').endsWith('/music-' + name + '.png'), name);
  }
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'music', action: 'seek', position: 0 }));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/music-1.png'));
  const singingExpressions = await pet.evaluate(duration => new Promise(resolve => {
    const portrait = document.querySelector('#pet img');
    const images = [portrait.getAttribute('src')];
    const observer = new MutationObserver(() => images.push(portrait.getAttribute('src')));
    observer.observe(portrait, { attributes: true, attributeFilter: ['src'] });
    setTimeout(() => { observer.disconnect(); resolve(images); }, duration + 150);
  }), cycleDuration);
  assert.deepEqual(singingExpressions.map(src => src.match(/music-(\d)\.png$/u)?.[1]), ['1', '3', '2', '3', '1'], 'music loops dedicated frames in order without voice/idle expressions');
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'music', action: 'pause' }));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-desktop.png'));
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'music', action: 'resume' }));
  await pet.waitForFunction(() => /\/music-[123]\.png$/u.test(document.querySelector('#pet img').getAttribute('src')));
  await pet.emulateMedia({ reducedMotion: 'reduce' });
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/music-1.png'));
  await pet.waitForTimeout(1100);
  assert.ok((await pet.locator('#pet img').getAttribute('src')).endsWith('/music-1.png'), 'reduced motion keeps a static singing pose');
  await pet.emulateMedia({ reducedMotion: 'no-preference' });
  await pet.evaluate(() => window.petApp.savePreferences({ lowResourceMode: true }));
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/music-1.png'));
  await pet.waitForTimeout(1100);
  assert.ok((await pet.locator('#pet img').getAttribute('src')).endsWith('/music-1.png'), 'low resource mode keeps a static singing pose');
  await pet.evaluate(() => window.petApp.savePreferences({ lowResourceMode: false }));
  const playingToken = (await pet.evaluate(() => window.petApp.musicStatus())).token;
  const beforeSingerClick = (await pet.evaluate(() => window.petApp.musicStatus())).position;
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'greet' }));
  await pet.locator('#sticker').waitFor({ state: 'visible' });
  const afterSingerClick = await pet.evaluate(() => window.petApp.musicStatus());
  assert.equal(afterSingerClick.state, 'playing', 'singer-mode interaction cannot stop its track');
  assert.equal(afterSingerClick.token, playingToken, 'singer-mode interaction cannot replace its track');
  assert.ok(afterSingerClick.position >= beforeSingerClick, 'song position continues during a sticker interaction');
  await pet.evaluate(() => window.petApp.hideSticker());
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).state === 'playing');
  await pet.locator('#pet').hover();
  await pet.waitForFunction(() => document.body.classList.contains('music-hover'));
  await pet.waitForFunction(() => document.querySelector('#music-widget').getAttribute('data-state') === 'playing');
  assert.equal(await pet.locator('#music-widget').isVisible(), true);
  await pet.screenshot({ path: join(root, 'artifacts', 'singer-mode-controls.png'), omitBackground: true });
  await pet.mouse.move(1, 1);
  await pet.waitForFunction(() => !document.body.classList.contains('music-hover'));
  await pet.waitForFunction(() => Number(getComputedStyle(document.querySelector('#music-widget')).opacity) === 0);
  await pet.locator('#pet').hover();
  await pet.waitForFunction(() => document.body.classList.contains('music-hover'));
  await pet.evaluate(() => window.petApp.savePreferences({ scale: 0.75 }));
  await pet.waitForFunction(() => document.querySelector('#music-widget').dataset.density === 'compact');
  assert.equal(await pet.locator('#music-widget-progress').isVisible(), false, 'compact singer mode hides only the seek bar');
  assert.equal(await pet.locator('#music-widget-previous').isVisible(), true);
  assert.equal(await pet.locator('#music-widget-toggle').isVisible(), true);
  assert.equal(await pet.locator('#music-widget-next').isVisible(), true);
  assert.equal(await pet.locator('#music-widget-stop').isVisible(), true);
  assert.equal(await pet.locator('#music-widget-mode').isVisible(), true);
  assert.equal(await pet.locator('#music-widget-volume').isVisible(), true);
  const compactLayout = await pet.locator('#music-widget').evaluate(widget => {
    const bounds = widget.getBoundingClientRect();
    const ids = ['music-widget-title', 'music-widget-mode', 'music-widget-previous', 'music-widget-toggle', 'music-widget-next', 'music-widget-stop', 'music-widget-volume'];
    return ids.map(id => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, widgetLeft: bounds.left, widgetRight: bounds.right };
    });
  });
  assert.ok(compactLayout.every(control => control.left >= control.widgetLeft && control.right <= control.widgetRight), 'compact singer controls fit inside the widget');
  await pet.screenshot({ path: join(root, 'artifacts', 'singer-mode-controls-compact.png'), omitBackground: true });
  await pet.evaluate(() => window.petApp.savePreferences({ scale: 1 }));
  await pet.waitForFunction(() => document.querySelector('#music-widget').dataset.density === 'standard');
  assert.equal(await pet.locator('#music-widget-progress').isVisible(), true);
  assert.equal(await pet.locator('#music-widget-next').isVisible(), true);
  assert.equal(await pet.locator('#music-widget-mode').isVisible(), true);
  await pet.evaluate(() => window.petApp.savePreferences({ scale: 1.3 }));
  await pet.waitForFunction(() => document.querySelector('#music-widget').dataset.density === 'full');
  assert.equal(await pet.locator('#music-widget-mode').isVisible(), true);
  await pet.locator('#music-widget-mode').click();
  await waitAsync(pet, async () => (await window.petApp.preferences()).musicPlaylist.mode === 'random');
  await pet.locator('#music-widget-mode').click();
  await waitAsync(pet, async () => (await window.petApp.preferences()).musicPlaylist.mode === 'repeat');
  await pet.locator('#music-widget-mode').click();
  await waitAsync(pet, async () => (await window.petApp.preferences()).musicPlaylist.mode === 'sequence');
  await pet.evaluate(() => document.querySelector('#open-music').click());
  await pet.waitForFunction(() => document.querySelector('#music-picker').hidden === false && document.querySelectorAll('#quick-music [data-song]').length === 2);
  await pet.locator('#quick-music [data-song="song_b"]').click();
  await waitAsync(pet, async () => (await window.petApp.musicStatus()).id === 'song_b' && (await window.petApp.musicStatus()).state === 'playing');
  assert.equal(await pet.locator('#music-picker').isHidden(), true, 'quick song selection closes the picker');
  await pet.evaluate(() => document.querySelector('#open-music').click());
  await pet.locator('#quick-music [data-song="song_a"]').click();
  await waitAsync(pet, async () => (await window.petApp.musicStatus()).id === 'song_a' && (await window.petApp.musicStatus()).state === 'playing');
  await pet.evaluate(() => document.querySelector('#open-music').click());
  await pet.locator('#music-widget-volume').evaluate(el => { el.value = '0.32'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitAsync(pet, async () => Math.abs((await window.petApp.preferences()).volume - 0.32) < 0.001);
  assert.equal(await pet.locator('#music-widget-volume-value').textContent(), '32%');
  await pet.locator('#music-widget-volume').dispatchEvent('change');
  await pet.locator('#music-widget-progress').evaluate(el => { el.value = '5'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitAsync(pet, async () => (await window.petApp.musicStatus()).position >= 4.9);
  await pet.locator('#music-widget-stop').click();
  await waitAsync(pet, async () => (await window.petApp.musicStatus()).state === 'stopped');
  await panel.locator('#music-toggle').click();
  await panel.waitForFunction(() => document.querySelector('#music-status').textContent === '正在播放');
  // Starting after stop advances the queue; reset the track before checking A → B.
  await panel.locator('[data-song=song_a]').click();
  await waitAsync(panel, async () => {
    const state = await window.petApp.musicStatus();
    return state.id === 'song_a' && state.state === 'playing';
  });
  await pet.evaluate(() => window.petApp.savePreferences({ scale: 1 }));
  await pet.waitForTimeout(120);
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).position > .3);
  await panel.locator('#music-toggle').click();
  await panel.waitForFunction(() => document.querySelector('#music-status').textContent.includes('已暂停'));
  const paused = await pet.evaluate(() => window.petApp.musicStatus());
  await panel.waitForTimeout(350);
  assert.ok(Math.abs((await pet.evaluate(() => window.petApp.musicStatus())).position - paused.position) < .1);
  await panel.locator('#music-seek').fill('12');
  await panel.locator('#music-seek').dispatchEvent('change');
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).position >= 11.9);
  await panel.locator('#music-toggle').click();
  await panel.waitForFunction(() => document.querySelector('#music-status').textContent === '正在播放');
  await panel.locator('#music-next').click();
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).id === 'song_b' && (await window.petApp.musicStatus()).state === 'playing');
  await panel.locator('#music-previous').click();
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).id === 'song_a' && (await window.petApp.musicStatus()).state === 'playing');
  await panel.locator('#music-seek').fill('29.8');
  await panel.locator('#music-seek').dispatchEvent('change');
  await waitAsync(panel, async () => {
    const state = await window.petApp.musicStatus();
    return state.id === 'song_b' && state.state === 'playing';
  });
  await panel.locator('#music-playlist-mode').selectOption('repeat');
  await waitAsync(panel, async () => (await window.petApp.preferences()).musicPlaylist.mode === 'repeat');
  await panel.waitForFunction(() => !document.querySelector('#music-seek').disabled);
  const oldToken = (await pet.evaluate(() => window.petApp.musicStatus())).token;
  await panel.locator('#music-seek').fill('29.8');
  await panel.locator('#music-seek').dispatchEvent('change');
  await waitAsync(panel, async token => (await window.petApp.musicStatus()).token > token && (await window.petApp.musicStatus()).state === 'playing', oldToken);
  assert.equal((await pet.evaluate(() => window.petApp.musicStatus())).id, 'song_b');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html')).close());
  assert.equal((await pet.evaluate(() => window.petApp.musicStatus())).state, 'playing');
  panel = await settings();
  await panel.locator('[data-page=music]').click();
  await panel.waitForFunction(() => document.querySelector('#music-title').textContent === '测试歌曲 B');
  await panel.locator('#music-volume').fill('0.25');
  await panel.locator('#music-volume').dispatchEvent('change');
  await waitAsync(panel, async () => (await window.petApp.preferences()).volume === .25);
  assert.equal(await panel.locator('#volume').inputValue(), '0.25');
  await pet.evaluate(() => window.petApp.playVoice('voice'));
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).state === 'stopped');
  await pet.evaluate(() => window.petApp.stopVoice());
  await pet.waitForFunction(() => document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-desktop.png'));
  await panel.locator('#music-toggle').click();
  await panel.waitForFunction(() => document.querySelector('#music-status').textContent === '正在播放');
  const beforeGame = await pet.evaluate(() => window.petApp.musicStatus());
  await pet.evaluate(() => window.petApp.setGameMode(true));
  await waitAsync(panel, async before => {
    const state = await window.petApp.musicStatus();
    return state.state === 'playing' && state.token === before.token && state.position > before.position;
  }, beforeGame);
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'music', action: 'pause' }));
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).state === 'paused');
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'music', action: 'resume' }));
  await waitAsync(panel, async () => (await window.petApp.musicStatus()).state === 'playing');
  await pet.evaluate(() => window.petApp.setGameMode(false));
  await panel.locator('#music-playlist-clear').click();
  await panel.waitForFunction(() => document.querySelectorAll('[data-music-selected]').length === 0);
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'music', action: 'stop' }));
  await panel.locator('#music-toggle').click();
  await panel.waitForFunction(() => document.querySelector('#music-result').textContent.includes('歌单为空'));
  const imported = join(temp, '新歌.wav');
  await writeFile(imported, wav());
  await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, imported);
  await panel.locator('#import-music').click();
  await panel.waitForFunction(() => document.querySelector('#music-result').textContent.includes('已添加 1 首'));
  assert.equal(await panel.locator('[data-song]').count(), 3);
  assert.equal((await pet.evaluate(() => window.petApp.voices())).clips.filter(clip => clip.music).length, 1);
  await desktop.close();
  desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40000 });
  const restartedPet = await desktop.firstWindow();
  await restartedPet.locator('#pet').waitFor();
  const persisted = await restartedPet.evaluate(() => window.petApp.preferences());
  assert.equal(persisted.musicPlaylist.mode, 'repeat');
  assert.deepEqual(persisted.musicPlaylist.ids, []);
  assert.equal((await restartedPet.evaluate(() => window.petApp.musicStatus())).state, 'idle', 'restart never starts audio automatically');
  assert.equal((await restartedPet.evaluate(() => window.petApp.voices())).clips.filter(clip => clip.music).length, 1);
  assert.deepEqual(errors, []);
  console.log('Music/UI smoke passed: navigation, selected-list removal, folding, compact/standard/full singer-mode controls, live volume, seek, separate stop, click-to-sticker without interrupting songs, play-mode cycling, pause/resume, next/previous, auto-advance/repeat, closing/reopening panel, shared volume, voice interruption, game-mode playback continuity, dedicated music-frame loop, reduced-motion/low-resource static pose, empty playlist and local import.');
} finally {
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
