import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-audio-import-'));
const fixture = join(temp, 'app'), data = join(temp, 'data');
let desktop;
const errors = [];
function wav(amplitude) {
  const rate = 48000, size = rate * 2, bytes = Buffer.alloc(44 + size * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < size; i++) bytes.writeInt16LE(Math.round(32767 * amplitude * Math.sin(2 * Math.PI * 1000 * i / rate)), 44 + i * 2);
  return bytes;
}
try {
  await mkdir(fixture); await mkdir(data);
  for (const entry of ['src', 'assets', 'character', 'package.json']) await cp(join(root, entry), join(fixture, entry), { recursive: true });
  await writeFile(join(fixture, 'assets/voices/manifest.json'), JSON.stringify({ clips: [] }));
  await writeFile(join(data, 'preferences.json'), JSON.stringify({ muted: true, idleActions: false }));
  const env = { ...process.env, PET_STARTER_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  async function launch() {
    desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40000 });
    desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    const pet = await desktop.firstWindow(); await pet.locator('#pet').waitFor();
    const pending = desktop.waitForEvent('window', page => page.waitForURL('**/settings.html').then(() => true));
    await pet.evaluate(() => window.petApp.openSettings());
    const panel = await pending; await panel.locator('#voice-count').waitFor({ state: 'attached' });
    return { pet, panel };
  }
  let { pet, panel } = await launch();
  const quiet = join(temp, '轻声.wav'), loud = join(temp, '大声.wav'), song = join(temp, '清唱.wav');
  await writeFile(quiet, wav(0.1)); await writeFile(loud, wav(0.4)); await writeFile(song, wav(0.2));
  await desktop.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [quiet, loud]);
  await panel.locator('[data-page=voices]').click(); await panel.locator('#import-voices').click();
  await panel.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('已添加 2 条语音。音量分析完成 2 条。'));
  let catalog = (await pet.evaluate(() => window.petApp.voices())).clips;
  assert.equal(catalog.length, 2); assert.ok(catalog.every(clip => clip.normalized && clip.duration > 1.9 && !clip.music));
  assert.ok(Math.abs(catalog[0].gainDb - catalog[1].gainDb - 12.04) < 0.1);
  const before = await readFile(quiet); assert.deepEqual(before, wav(0.1));
  await panel.locator('#normalize-voices').click();
  await panel.waitForFunction(() => document.querySelector('#voice-result').textContent.includes('复用 2 条'));
  await panel.locator('[data-voice]').first().click();
  await panel.waitForFunction(() => document.querySelector('#voice-result').textContent.startsWith('正在播放'));
  await pet.evaluate(() => window.petApp.stopVoice());
  await desktop.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [song]);
  await panel.locator('[data-page=music]').click(); await panel.locator('#import-music').click();
  await panel.waitForFunction(() => document.querySelector('#music-result').textContent.includes('已添加 1 首歌曲。音量分析完成 1 条。'));
  catalog = (await pet.evaluate(() => window.petApp.voices())).clips;
  assert.equal(catalog.filter(clip => clip.music && clip.normalized).length, 1);
  assert.equal(await panel.locator('[data-voice]').count(), 2);
  assert.equal(await panel.locator('[data-song]').count(), 1);
  const cache = JSON.parse(await readFile(join(data, 'audio-loudness.json'), 'utf8'));
  assert.equal(cache.clips.length, 3);
  const windows = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.webContents.getURL()));
  assert.ok(!windows.some(url => url.includes('audio-analyzer')), 'analyzer closes after use');
  await panel.locator('[data-page=preferences]').click(); await panel.locator('#normalizeAudio').uncheck();
  await panel.locator('#preferences-form').evaluate(form => form.requestSubmit());
  await pet.waitForFunction(async () => (await window.petApp.preferences()).normalizeAudio === false);
  await desktop.close(); ({ pet, panel } = await launch());
  assert.equal((await pet.evaluate(() => window.petApp.preferences())).normalizeAudio, false);
  assert.ok((await pet.evaluate(() => window.petApp.voices())).clips.every(clip => clip.normalized));
  assert.equal((await stat(join(data, 'audio-loudness.json'))).size > 0, true);
  assert.deepEqual(errors, []);
  console.log('PASS: voice/music picker import, silent loudness analysis, level matching, original bytes, cache reuse, playback, durable gain/toggle, separate libraries, analyzer teardown.');
} finally {
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
