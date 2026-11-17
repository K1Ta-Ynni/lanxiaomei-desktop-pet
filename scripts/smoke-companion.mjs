import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { _electron as electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-companion-test-'));
const fixture = join(temp, 'app'), data = join(temp, 'data');
const requests = [], errors = [];
let desktop;
const sockets = new Set();
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  requests.push(payload);
  const user = payload.messages.filter(row => row.role === 'user').at(-1).content;
  if (user === '等待取消') return;
  const last = payload.messages.at(-1);
  let message;
  if (last.role === 'tool') {
    const result = JSON.parse(last.content);
    message = { role: 'assistant', content: result.message || '已执行指定的本地互动。' };
  } else {
    let tool;
    if (user.includes('播放雨爱')) tool = ['play_song', { query: '雨爱' }];
    if (user.includes('播放早安')) tool = ['play_voice', { query: '早安' }];
    if (user.includes('随机发一个表情包')) tool = ['send_sticker', { query: '随机' }];
    if (user === '暂停歌曲') tool = ['control_music', { action: 'pause' }];
    if (user === '关闭') tool = ['control_music', { action: 'stop' }];
    if (user === '恶意模型尝试自动播放') tool = ['play_voice', { query: '早安' }];
    message = tool ? { role: 'assistant', content: null, tool_calls: [{ id: 'test-call', type: 'function', function: { name: tool[0], arguments: JSON.stringify(tool[1]) } }] }
      : { role: 'assistant', content: '你好，今天想聊些什么？' };
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message }] }));
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

async function launch() {
  const env = { ...process.env, PET_STARTER_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40000 });
  desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const pet = await desktop.firstWindow();
  await pet.locator('#pet').waitFor();
  return pet;
}
async function page(name, trigger) {
  const pending = desktop.waitForEvent('window', page => page.waitForURL('**/' + name + '.html').then(() => true));
  await trigger();
  return await pending;
}
async function send(chat, text) {
  const count = await chat.locator('.message.assistant').count();
  await chat.locator('#input').fill(text); await chat.locator('#send').click();
  await chat.waitForFunction(expected => document.querySelectorAll('.message.assistant').length > expected, count);
  await chat.waitForFunction(() => !document.querySelector('#send').disabled);
  return await chat.locator('.message.assistant').last().textContent();
}
async function waitHistory(pet, expected) {
  const deadline = Date.now() + 10000;
  let rows;
  do {
    rows = await pet.evaluate(() => window.petApp.history());
    if (rows.at(-2)?.content === expected) return rows;
    await new Promise(resolve => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  assert.equal(rows.at(-2)?.content, expected, 'speech turn must actually be committed');
}
try {
  await mkdir(fixture); await mkdir(data);
  for (const entry of ['src', 'assets', 'character', 'package.json']) await cp(join(root, entry), join(fixture, entry), { recursive: true });
  const samples = 16000 * 30;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  await writeFile(join(fixture, 'assets/voices/test.wav'), wav);
  await writeFile(join(fixture, 'assets/voices/manifest.json'), JSON.stringify({ clips: [
    { id: 'rain', label: '雨爱', group: '歌曲', music: true, file: 'test.wav' },
    { id: 'hello', label: '早安', text: '早安', group: '问候', file: 'test.wav' },
  ] }));
  await writeFile(join(data, 'settings.json'), JSON.stringify({ mode: 'basic', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', encryptedApiKey: '' }));
  await writeFile(join(data, 'preferences.json'), JSON.stringify({ muted: true, idleActions: false }));
  let pet = await launch();
  const settings = await page('settings', () => pet.evaluate(() => window.petApp.openSettings()));
  await settings.locator('[data-page=ai]').click();
  assert.equal(await settings.locator('#baseUrl').inputValue(), 'https://api.deepseek.com', 'old DeepSeek v1 base URLs migrate to the official canonical URL');
  assert.equal(await settings.locator('#model').inputValue(), 'deepseek-flash', 'the retired chat alias migrates to the current Flash model ID');
  await settings.locator('#deepseek-guide summary').click();
  assert.match(await settings.locator('#deepseek-guide').textContent(), /App-managed/u);
  await desktop.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.testOpenedExternal = url; }; });
  await settings.locator('[data-deepseek-link=platform]').click();
  assert.equal(await desktop.evaluate(() => globalThis.testOpenedExternal), 'https://platform.deepseek.com/');
  await settings.screenshot({ path: join(root, 'artifacts/deepseek-guide.png'), fullPage: true });
  await desktop.evaluate(({ shell }) => { delete shell.openExternal; });
  await settings.locator('#assistant-mode').selectOption('companion');
  await settings.locator('#baseUrl').fill(baseUrl);
  await settings.locator('#model').fill('test-model');
  await settings.locator('#apiKey').fill('fake-local-test-key');
  await settings.locator('#save-model').click();
  await settings.waitForFunction(() => document.querySelector('#key-status').textContent.includes('已保存'));
  const storedSettings = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8'));
  assert.equal(storedSettings.mode, 'companion');
  assert.ok(!JSON.stringify(storedSettings).includes('fake-local-test-key'), 'keys never persist as plaintext');
  let chat = await page('chat', () => settings.locator('#open-chat').click());
  await chat.waitForFunction(() => !document.querySelector('#input').disabled);
  await send(chat, '你好');
  assert.equal(requests.at(-1).tools, undefined, 'ordinary conversation exposes no media tools');
  assert.equal(await pet.locator('#greeting').textContent(), '你好，今天想聊些什么？', 'model responses also appear on the desktop pet');
  await send(chat, '记住我喜欢蓝色');
  assert.equal((await chat.evaluate(() => window.petApp.memories())).length, 1);
  await send(chat, '我最近常听雨爱');
  assert.equal((await pet.evaluate(() => window.petApp.musicStatus())).state, 'idle');
  assert.equal(requests.at(-1).tools, undefined);
  assert.match(await send(chat, '恶意模型尝试自动播放'), /没有明确要求/u, 'an unsolicited tool request is rejected locally');
  await send(chat, '蓝小妹，播放雨爱');
  await pet.waitForFunction(async () => (await window.petApp.musicStatus()).state === 'playing');
  await send(chat, '暂停歌曲');
  await pet.waitForFunction(async () => (await window.petApp.musicStatus()).state === 'paused');
  const requestsBeforeStop = requests.length;
  await send(chat, '关闭');
  await pet.waitForFunction(async () => (await window.petApp.musicStatus()).state === 'stopped');
  assert.equal(requests.length, requestsBeforeStop, 'short music stop commands execute locally without model ambiguity');
  await send(chat, '蓝小妹，播放雨爱');
  await pet.waitForFunction(async () => (await window.petApp.musicStatus()).state === 'playing');
  await send(chat, '随机发一个表情包');
  await pet.waitForFunction(() => !document.querySelector('#sticker').hidden);
  assert.equal((await pet.evaluate(() => window.petApp.musicStatus())).state, 'playing', 'stickers preserve music');
  await send(chat, '播放早安');
  await pet.waitForFunction(() => document.querySelector('#greeting').textContent === '早安');
  assert.equal((await pet.evaluate(() => window.petApp.musicStatus())).state, 'stopped');
  await chat.locator('#clear-chat').click();
  await chat.waitForFunction(() => !document.querySelectorAll('.message').length);
  assert.equal((await chat.evaluate(() => window.petApp.memories())).length, 1, 'clearing chat preserves explicit memory');
  await settings.locator('#assistant-mode').selectOption('basic');
  await settings.locator('#save-model').click();
  await chat.waitForFunction(() => document.querySelector('#input').disabled);
  const before = requests.length;
  assert.match(await chat.evaluate(async () => { try { await window.petApp.sendMessage('hello'); return ''; } catch (error) { return error.message; } }), /AI 聊天尚未开启/u);
  assert.equal(requests.length, before);
  assert.equal((await chat.evaluate(() => window.petApp.readSettings())).apiKeyConfigured, true);
  await settings.locator('#assistant-mode').selectOption('companion'); await settings.locator('#save-model').click();
  await chat.waitForFunction(() => !document.querySelector('#input').disabled);
  const pending = chat.evaluate(async () => { try { await window.petApp.sendMessage('等待取消'); return ''; } catch (error) { return error.message; } });
  const deadline = Date.now() + 10000;
  while (requests.at(-1)?.messages.at(-1)?.content !== '等待取消' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(requests.at(-1)?.messages.at(-1)?.content, '等待取消');
  await settings.locator('#assistant-mode').selectOption('basic'); await settings.locator('#save-model').click();
  assert.match(await pending, /停止/u, 'downgrade cancels the in-flight model request');
  await chat.close();
  await desktop.close();
  pet = await launch();
  assert.equal((await pet.evaluate(() => window.petApp.readSettings())).mode, 'basic');
  assert.equal((await pet.evaluate(() => window.petApp.memories())).length, 1, 'memory survives downgrade and restart');
  await pet.evaluate(baseUrl => window.petApp.saveSettings({ mode: 'companion', baseUrl, model: 'test-model' }), baseUrl);
  chat = await page('chat', () => pet.evaluate(() => window.petApp.openChat()));
  await chat.waitForFunction(() => !document.querySelector('#input').disabled);
  await send(chat, '你记得我喜欢什么颜色吗');
  assert.match(requests.at(-1).messages[0].content, /我喜欢蓝色/u);
  const memory = (await chat.evaluate(() => window.petApp.memories()))[0];
  await chat.evaluate(id => window.petApp.forget(id), memory.id);
  assert.equal((await chat.evaluate(() => window.petApp.memories())).length, 0);
  const languages = await chat.evaluate(() => window.petApp.speechLanguages());
  assert.ok(Array.isArray(languages));
  assert.equal((await chat.evaluate(() => window.petApp.pendingSpeech())).state.type, 'stopped', 'language probing never starts the microphone');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await chat.screenshot({ path: join(root, 'artifacts/companion-preview.png') });
  await chat.close();
  assert.ok(await pet.evaluate(() => window.petApp.info()), 'closing chat never crashes main process');
  await desktop.evaluate(({ ipcMain }) => { ipcMain.removeHandler('speech:languages'); ipcMain.handle('speech:languages', () => []); });
  chat = await page('chat', () => pet.evaluate(() => window.petApp.openChat()));
  await chat.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('没有可用组件'));
  assert.equal(await chat.locator('#speech-once').isDisabled(), true);
  assert.equal(await chat.locator('#send').isDisabled(), false, 'missing recognition components never disable text chat');
  await chat.close();
  await desktop.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('speech:languages');
    ipcMain.handle('speech:languages', () => [{ culture: 'zh-CN', name: '中文' }, { culture: 'en-US', name: 'English' }]);
  });
  chat = await page('chat', () => pet.evaluate(() => window.petApp.openChat()));
  await chat.waitForFunction(() => document.querySelectorAll('#speech-language option').length === 2);
  await chat.locator('.speech-options summary').click();
  await chat.locator('#speech-language').selectOption('en-US');
  await chat.locator('#wake-phrase').fill('Blue');
  assert.equal(await chat.locator('#speech-language').inputValue(), 'en-US');
  const spokenBefore = requests.length;
  // Replace only the isolated fixture's microphone source; exercise the real
  // child-process, main-process chat and renderer paths with text events.
  const eventFile = join(temp, 'speech-events.jsonl');
  const psPath = "'" + eventFile.replaceAll("'", "''") + "'";
  await writeFile(eventFile, '');
  await writeFile(join(fixture, 'src/speech-input.ps1'), '\uFEFF' + `param([string]$Mode,[string]$Culture,[string]$WakePhrase)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::WriteLine((@{ type='listening'; mode=$Mode } | ConvertTo-Json -Compress))
$seen = 0
while ($true) {
  $rows = @(Get-Content -Encoding UTF8 -LiteralPath ${psPath} -ErrorAction SilentlyContinue)
  while ($seen -lt $rows.Count) { [Console]::WriteLine($rows[$seen]); $seen++ }
  Start-Sleep -Milliseconds 40
}
`, 'utf8');
  let events = [];
  async function emitSpeech(event) { events.push(event); await writeFile(eventFile, events.map(row => JSON.stringify(row)).join('\n') + '\n'); }
  await chat.locator('#speech-continuous').check();
  await pet.waitForFunction(async () => (await window.petApp.speechStatus()).state.type === 'listening');
  await chat.close();
  await emitSpeech({ type: 'transcript', text: 'Hello from speech' });
  await waitHistory(pet, 'Hello from speech');
  const speechDeadline = Date.now() + 5000;
  while (!requests.some(payload => payload.messages.at(-1)?.content === 'Hello from speech') && Date.now() < speechDeadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(desktop.windows().filter(page => page.url().endsWith('/chat.html')).length, 0, 'background voice never opens the chat window');
  assert.equal(requests.length, spokenBefore + 1);
  assert.equal(await pet.locator('#speech-indicator').isVisible(), true);
  await pet.waitForFunction(() => !document.querySelector('#bubble').hidden && document.querySelector('#bubble').classList.contains('chat-reply'));
  await emitSpeech({ type: 'transcript', text: 'First queued sentence' });
  await emitSpeech({ type: 'transcript', text: 'Second queued sentence' });
  const speechHistory = await waitHistory(pet, 'Second queued sentence');
  assert.deepEqual(speechHistory.slice(-4).filter(row => row.role === 'user').map(row => row.content), ['First queued sentence', 'Second queued sentence'], 'consecutive speech is processed in order');
  const afterAutomaticSpeech = requests.length;
  chat = await page('chat', () => pet.evaluate(() => window.petApp.openChat()));
  await chat.waitForFunction(() => document.querySelector('#speech-continuous').checked);
  await chat.locator('.speech-options summary').click();
  assert.equal(await chat.locator('#speech-language').inputValue(), 'en-US');
  await chat.locator('#speech-send').uncheck();
  await emitSpeech({ type: 'transcript', text: 'Keep this as a draft' });
  await chat.waitForFunction(() => document.querySelector('#input').value === 'Keep this as a draft');
  assert.equal(requests.length, afterAutomaticSpeech, 'manual confirmation keeps speech local until sent');
  await pet.locator('#speech-indicator').click();
  await pet.waitForFunction(async () => !(await window.petApp.speechStatus()).running);
  await chat.locator('#speech-wake').check();
  await pet.waitForFunction(async () => (await window.petApp.speechStatus()).running);
  await pet.evaluate(() => window.petApp.setGameMode(true));
  assert.equal((await pet.evaluate(() => window.petApp.speechStatus())).running, true, 'game mode only enables click-through and preserves existing speech listening');
  await pet.evaluate(() => window.petApp.setGameMode(false));
  await chat.close();
  assert.deepEqual(errors, []);
  console.log('Companion smoke passed: text chat, encrypted key, explicit media tools, no unsolicited playback, local memories, downgrade and cancellation, restart, optional/multiple recognition languages, recognized-text delivery without microphone, chat close lifecycle.');
} finally {
  await desktop?.close().catch(() => {});
  for (const socket of sockets) socket.destroy();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
